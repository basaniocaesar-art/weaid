/**
 * Cancellations and refunds — one rulebook for the customer's button, the
 * owner's Ops buttons and the phone line.
 *
 * Agreed with the owner, 8 Oct 2026:
 *   before a pro is assigned, or assigned but not on the way → 100% refund
 *   pro on the way                                          → refund minus ₹99, which goes to the pro
 *   pro arrived / job done                                   → customer can't cancel; raise a complaint
 *   WeAid can't find a pro / pro no-show (owner cancels)    → 100%
 *   unhappy with work → owner decides (free redo, or a part refund from Ops)
 *
 * Razorpay payments are refunded through Razorpay. Money taken by UPI/cash
 * outside Razorpay can't be sent back automatically: the owner is emailed the
 * amount and number, and marks it sent in Ops.
 */
import { getBooking, updateBooking } from "./supabase.js";
import { processRefund, razorpayConfigured } from "./razorpay.js";
import { eventsFor, stageOf, logEvent, alertStep } from "./jobs.js";
import { sendAdminNotification } from "./email.js";
import { pushToProvider } from "./fcm.js";
import { isQuoteJob, money, VISIT_FEE } from "./quotes.js";

export const ON_THE_WAY_FEE = 99;

const paidAmount = (b, events = []) => (isQuoteJob(events) ? money(b, events).paid : b.paid_at ? Math.round(b.total || b.amount || 0) : 0);

/** What would happen if this booking were cancelled now. */
export function cancelQuote(booking, events, by = "customer") {
  const stage = stageOf(booking, events);
  const paid = paidAmount(booking, events);
  if (["cancelled", "refunded"].includes(stage)) return { allowed: false, reason: "Already cancelled.", stage };
  if (isQuoteJob(events)) {
    // Visit done → the ₹99 is the pro's. Advance is refundable until work starts.
    if (by === "customer" && ["working", "done"].includes(stage)) return { allowed: false, stage, reason: "Work has started, so this can't be cancelled here. Please report a problem or call WeAid." };
    const keep = ["visiting", "quoted", "awaiting_advance", "scheduled", "quote_declined", "working", "done"].includes(stage) || (by === "customer" && stage === "on_the_way") ? Math.min(VISIT_FEE, paid) : 0;
    const refund = Math.max(0, paid - keep);
    return { allowed: true, stage, paid, fee: keep, refund,
      words: !paid ? "Nothing has been paid, so there's nothing to refund."
        : keep && refund ? `The ₹${keep} site-visit fee goes to the pro who visited. You'll get ₹${refund} back.`
        : keep ? `The ₹${keep} site-visit fee goes to the pro${stage === "on_the_way" ? " who is on the way" : " who visited"}, so there's nothing to refund.`
        : `You'll get the full ₹${paid} back.` };
  }
  if (by === "customer" && ["arrived", "done"].includes(stage)) {
    return { allowed: false, stage, reason: "Your pro has already arrived, so this can't be cancelled here. If something's wrong, report a problem and WeAid will sort it out." };
  }
  const fee = by === "customer" && stage === "on_the_way" ? Math.min(ON_THE_WAY_FEE, paid) : 0;
  return {
    allowed: true, stage, paid, fee,
    refund: Math.max(0, paid - fee),
    words: !paid ? "Nothing has been paid, so there's nothing to refund."
      : fee ? `Your pro is already on the way, so ₹${fee} goes to them for their travel. You'll get ₹${paid - fee} back.`
      : `You'll get the full ₹${paid} back.`,
  };
}

/**
 * Give money back. amount in rupees. Returns { mode: "razorpay"|"manual"|"none" }.
 * Never refunds more than was paid, minus anything already refunded.
 */
export async function refund(booking, amount, reason, by) {
  const events = await eventsFor(booking.id);
  // Razorpay refunds AND ones owed/sent by UPI both count against what was paid.
  const already = events.filter((e) => e.event === "refunded" || e.event === "refund_due").reduce((n, e) => n + (Number(e.data?.amount) || 0), 0);
  const max = Math.max(0, paidAmount(booking, events) - already);
  const amt = Math.min(Math.round(Number(amount) || 0), max);
  if (amt <= 0) return { mode: "none", amount: 0 };

  if (booking.razorpay_payment_id && razorpayConfigured()) {
    const r = await processRefund(booking.razorpay_payment_id, amt, { booking_id: booking.id, reason: String(reason || "").slice(0, 200) });
    await logEvent(booking.id, "refunded", { amount: amt, mode: "razorpay", refundId: r.id, by, reason });
    await updateBooking(booking.id, { refund_id: r.id, refunded_at: new Date().toISOString(), refund_reason: String(reason || "").slice(0, 300) });
    return { mode: "razorpay", amount: amt, refundId: r.id };
  }
  await logEvent(booking.id, "refund_due", { amount: amt, mode: "manual", by, reason });
  await sendAdminNotification(`[WeAid] 💸 Send a refund — ₹${amt} to ${booking.customer_name || ""} ${booking.customer_phone || ""}`,
    `<p style="font-family:sans-serif">This booking was paid outside Razorpay (UPI/cash), so the refund can't go automatically.<br><br>
     Send <b>₹${amt}</b> by UPI to <b>${booking.customer_name || ""} ${booking.customer_phone || ""}</b>, then tap <b>Refund sent</b> on the job in Ops.<br>Reason: ${String(reason || "").replace(/</g, "&lt;")}</p>`).catch(() => {});
  return { mode: "manual", amount: amt };
}

/** Cancel a booking, refund per the rules, tell the pro. */
export async function cancelBooking(bookingId, { by = "customer", reason = "", refundAmount = null } = {}) {
  const booking = await getBooking(bookingId);
  if (!booking) throw new Error("No such booking.");
  const events = await eventsFor(bookingId);
  const q = cancelQuote(booking, events, by);
  if (!q.allowed) return { ok: false, ...q };

  const toRefund = refundAmount != null ? Number(refundAmount) : q.refund;
  const r = await refund(booking, toRefund, reason || `Cancelled by ${by}`, by);
  await updateBooking(bookingId, { status: r.mode === "razorpay" && r.amount >= q.paid ? "refunded" : "cancelled" });
  await logEvent(bookingId, "cancelled", { by, reason, fee: q.fee, refund: r.amount, refundMode: r.mode });
  if (q.fee && booking.provider_id) await logEvent(bookingId, "pro_travel_fee", { providerId: booking.provider_id, amount: q.fee });

  if (booking.provider_id) {
    pushToProvider(booking.provider_id, {
      title: "Job cancelled",
      body: `The ${booking.service} job${booking.address ? ` near ${booking.address.split(",").slice(-2, -1)[0] || ""}` : ""} was cancelled.${q.fee ? ` You get ₹${q.fee} for your travel.` : ""}`,
      data: { type: "cancelled", bookingId }, channel: "default",
    }).catch(() => {});
  }
  await alertStep({ ...booking, status: "cancelled" }, "cancelled",
    `Cancelled by ${by}${reason ? ` — "${reason}"` : ""}. Refund ₹${r.amount} (${r.mode === "razorpay" ? "sent via Razorpay" : r.mode === "manual" ? "SEND IT BY UPI" : "nothing paid"})${q.fee ? `; ₹${q.fee} travel fee to the pro` : ""}.`);
  return { ok: true, refund: r.amount, refundMode: r.mode, fee: q.fee };
}

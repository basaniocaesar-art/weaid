/**
 * Book first, pay after the job.
 *
 * Two real customers booked a repair in October 2026 and nobody was ever rung,
 * because every bit of provider outreach waited for paid_at, and neither of
 * them wanted to pay a stranger ₹1,300 up front for a fan that might be a
 * ten-minute fix. That is not an unreasonable position: it is how Urban
 * Company, Joboy and every electrician in Kochi already work. So (owner's
 * decisions, 20 Oct 2026):
 *
 *   repair & maintenance   pay after the job, no visit fee — AC, electrical,
 *                          plumbing, carpentry, CCTV and anything billed by the
 *                          hour
 *   fixed-price services   the customer chooses pay-now or pay-after; pay-after
 *                          is the default
 *   quote jobs             the ₹99 site visit stays exactly as it was
 *
 * A pay-after booking is dispatched the moment it is made (confirmed_at), and
 * the money is collected when the pro taps Done: a Razorpay link to the
 * customer's phone, or cash to the pro. Cash means the pro is holding WeAid's
 * commission, so it goes in provider_ledger, comes off their next payout, and
 * past PRO_OWED_LIMIT they get no new offers until it is settled.
 *
 * Anti-abuse. There is no working customer OTP here (Supabase phone login was
 * never switched on and jobportal.js notes DLT is still pending), and inventing
 * an SMS integration for this would be a bigger change than the feature. So a
 * number can have at most PAY_AFTER_OPEN_LIMIT pay-after bookings open or unpaid
 * at once, and the team is emailed on every one, so a fake booking costs at
 * most one wasted trip and is visible the moment it is made.
 */
import { supabase, getBooking, updateBooking } from "./supabase.js";
import { SERVICES } from "./pricing.js";
import { logEvent, eventsFor, alertStep, jobLinks } from "./jobs.js";
import { createPaymentLink, razorpayConfigured } from "./razorpay.js";
import { openTicket } from "./followup.js";
import { sendMessage } from "./whatsapp.js";
import { sendEmail } from "./email.js";
import { placeErrandCall, errandReady } from "./errand.js";
import { cancelBooking } from "./cancel.js";

// Kept local rather than imported from offers.js: offers → dispatch → here
// already, and one more edge on that cycle is one more thing to go wrong.
const NICE = { electrical: "Electrician", plumbing: "Plumber", ac: "AC service", cleaning: "Cleaning", painting: "Painting", carpentry: "Carpentry", movers: "Packers & movers", pest_control: "Pest control", cctv: "CCTV", cook: "Cook", maid: "Housemaid", babysit: "Babysitter", nursing: "Home nurse", eldercare: "Elder care", driver: "Driver" };
const niceService = (s) => NICE[s] || String(s || "").replace(/_/g, " ");

/** Owes WeAid more than this (cash commissions) and a pro is offered nothing new. */
export const PRO_OWED_LIMIT = Number(process.env.PRO_OWED_LIMIT) || 1000;
/** Pay-after bookings one phone number can have open (or done and unpaid) at once. */
export const PAY_AFTER_OPEN_LIMIT = Number(process.env.PAY_AFTER_OPEN_LIMIT) || 2;

/** Repair and maintenance: always pay after, no visit fee. Anything billed by the hour counts too. */
export const REPAIR_SERVICES = ["ac", "electrical", "plumbing", "carpentry", "cctv"];
export const isRepair = (service) => REPAIR_SERVICES.includes(service) || SERVICES[service]?.mode === "hours";

/**
 * How a service is paid for: "after" (no choice), "choice" (customer picks,
 * default after), "visit" (₹99 site visit, lib/quotes.js) or "prepaid"
 * (courier and rides, which are paid before a rider is sent).
 */
export function paymentChoice(service) {
  const svc = SERVICES[service];
  if (!svc) return "prepaid";
  if (svc.quoteOnly) return "visit";
  if (svc.mode === "distance") return "prepaid";
  if (isRepair(service)) return "after";
  return "choice";
}

/** The payment_mode a new booking gets, given what (if anything) the customer asked for. */
export function paymentModeFor(service, requested) {
  const c = paymentChoice(service);
  if (c === "after") return "pay_after";
  if (c === "visit") return "visit_fee";
  if (c === "prepaid") return "prepaid";
  return requested === "pay_now" || requested === "prepaid" ? "prepaid" : "pay_after";
}

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/** Pay-after bookings this number already has that are open, or finished and still unpaid. */
export async function openUnpaidCount(phone) {
  const d = ten(phone);
  if (d.length !== 10) return 0;
  const { count, error } = await supabase.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("payment_mode", "pay_after").is("paid_at", null)
    .in("status", ["pending", "accepted", "completed"])
    .or(`customer_phone.eq.+91${d},customer_phone.eq.${d},customer_phone.like.%${d}`);
  if (error) { console.warn("[payafter] open count", error.message); return 0; }
  return count || 0;
}

/** Money already received for the job itself (events "payment" with what "job"). */
export const jobPaid = (events) =>
  events.filter((e) => e.event === "payment" && e.data?.what === "job").reduce((n, e) => n + (Number(e.data?.amount) || 0), 0);

/** What the customer still owes on a pay-after job. Zero for anything else. */
export function amountDue(booking, events) {
  if (!booking || booking.payment_mode !== "pay_after") return 0;
  if (booking.paid_at) return 0;
  return Math.max(0, Math.round(booking.total || booking.amount || 0) - jobPaid(events));
}

/**
 * A Razorpay link for what is due, or a ticket for the team to collect it.
 * The link is kept on the payment_due event so every page shows the same one.
 */
export async function jobPayInfo(booking, events) {
  events = events || (await eventsFor(booking.id));
  const amount = amountDue(booking, events);
  if (amount <= 0) return { paid: true, amount: 0 };
  const prior = events.filter((e) => e.event === "payment_due").pop()?.data;
  if (prior?.payUrl && prior.amount === amount) return { payUrl: prior.payUrl, amount };
  if (razorpayConfigured()) {
    try {
      const link = await createPaymentLink({
        amountInr: amount, bookingId: booking.id, name: booking.customer_name, phone: booking.customer_phone,
        description: `WeAid ${niceService(booking.service)} — payment for the job`,
        callbackUrl: jobLinks(booking.id).track, what: "job",
      });
      if (link?.short_url) {
        await logEvent(booking.id, "payment_due", { amount, payUrl: link.short_url });
        return { payUrl: link.short_url, amount };
      }
    } catch (e) { console.error("[payafter] pay link", e.message); }
  }
  if (!prior) await logEvent(booking.id, "payment_due", { amount, payUrl: null });
  return { amount, cashOnly: true };
}

/**
 * The pro has tapped Done on a pay-after job: tell the customer what to pay and
 * how. Safe to call for any booking — it does nothing unless money is due — and
 * safe to call twice, because the message only goes once.
 */
export async function collectAfterJob(bookingOrId) {
  const booking = typeof bookingOrId === "string" ? await getBooking(bookingOrId) : bookingOrId;
  if (!booking || booking.payment_mode !== "pay_after" || booking.status !== "completed") return null;
  const events = await eventsFor(booking.id);
  const amount = amountDue(booking, events);
  if (amount <= 0) return { paid: true };
  const already = events.some((e) => e.event === "payment_due");
  const info = await jobPayInfo(booking, events);
  if (already) return info;

  const first = (booking.customer_name || "").split(" ")[0] || "there";
  const pro = booking.provider_name || "your pro";
  const text = `Hi ${first}, your WeAid ${niceService(booking.service)} job is done. ${inr(amount)} to pay: ` +
    (info.payUrl ? `pay online at ${info.payUrl}, or ` : "") +
    `pay ${pro} by cash or UPI and they will mark it received. Your job page: ${jobLinks(booking.id).track}`;
  await sendMessage(booking.customer_phone, text).catch((e) => console.error("[payafter] wa", e.message));
  if (booking.customer_email) {
    await sendEmail(booking.customer_email, `WeAid — ${inr(amount)} to pay for your ${niceService(booking.service)} job`,
      `<p style="font-family:sans-serif">${text.replace(/</g, "&lt;").replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).catch(() => {});
  }
  if (!info.payUrl) {
    await openTicket({ kind: "payment", phone: booking.customer_phone, name: booking.customer_name, bookingId: booking.id, source: "web",
      summary: `Job done, ${inr(amount)} due (pay-after, no Razorpay link). Collect it, then tap "Payment received" in Ops.` }).catch(() => {});
  }
  await alertStep(booking, "payment_due", `${inr(amount)} due from the customer${info.payUrl ? ` — link sent: ${info.payUrl}` : " — no payment link; cash/UPI to the pro"}.`);
  return info;
}

/** One row in the pro's ledger. Positive = the pro owes WeAid. */
export async function addLedger(providerId, kind, amount, { bookingId = null, note = "" } = {}) {
  const amt = Math.round(Number(amount) || 0);
  if (!providerId || !amt) return null;
  const { data, error } = await supabase.from("provider_ledger")
    .insert({ provider_id: providerId, booking_id: bookingId, kind, amount: amt, note: String(note || "").slice(0, 300) || null })
    .select("id").maybeSingle();
  if (error) { console.error("[payafter] ledger insert failed:", error.message); return null; }
  return data;
}

/** Owed balance per pro for a list of ids: { [providerId]: rupees }. Missing table → nobody owes anything. */
export async function owedBalances(providerIds) {
  const ids = [...new Set((providerIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase.from("provider_ledger").select("provider_id,amount").in("provider_id", ids);
  if (error) { console.warn("[payafter] ledger read failed:", error.message); return {}; }
  const out = {};
  for (const r of data || []) out[r.provider_id] = (out[r.provider_id] || 0) + (Number(r.amount) || 0);
  return out;
}

export async function owedBalance(providerId) {
  return (await owedBalances([providerId]))[providerId] || 0;
}

/**
 * Drop pros who owe WeAid more than the limit from a list of candidates.
 * Said in the log rather than silently: a pro who stops getting work should
 * be a line somebody can find.
 */
export async function withoutOverLimit(pros) {
  if (!pros?.length) return pros || [];
  const owed = await owedBalances(pros.map((p) => p.id));
  return pros.filter((p) => {
    const o = owed[p.id] || 0;
    if (o > PRO_OWED_LIMIT) console.warn(`[payafter] ${p.name || p.id} owes ₹${o} (limit ₹${PRO_OWED_LIMIT}) — not offered the job`);
    return o <= PRO_OWED_LIMIT;
  });
}

/**
 * Money received for a pay-after job. mode: "razorpay" | "cash" | "upi";
 * receivedBy: "pro" (they hold it — the commission goes in the ledger and the
 * job is marked paid out) or "weaid" (we hold it — the pro is paid as usual).
 * Idempotent on `ref`, and once the job is fully paid further calls do nothing.
 */
export async function recordJobPayment(bookingId, { amount, mode = "cash", ref = null, receivedBy = "pro", by = "pro", patch = {} } = {}) {
  const booking = await getBooking(bookingId);
  if (!booking) throw new Error("No such booking.");
  if (booking.payment_mode !== "pay_after") throw new Error("This isn't a pay-after job.");
  let events = await eventsFor(bookingId);
  if (ref && events.some((e) => e.event === "payment" && e.data?.ref === ref)) return { ok: true, already: true, due: amountDue(booking, events) };
  const due = amountDue(booking, events);
  if (due <= 0) return { ok: true, already: true, due: 0 };
  const amt = Math.min(due, Math.round(Number(amount) || due));
  if (amt <= 0) throw new Error("Amount?");

  await logEvent(bookingId, "payment", { what: "job", amount: amt, mode, ref, receivedBy, by });
  events = await eventsFor(bookingId);
  const left = amountDue(booking, events);
  const now = new Date().toISOString();
  const upd = { ...patch, payment_gateway: String(mode).slice(0, 20) };
  if (left <= 0) upd.paid_at = now;
  if (receivedBy === "pro" && booking.provider_id) {
    /*
     * The pro has the customer's money. Their share is theirs already, so the
     * job must not be paid out again on Monday; WeAid's share — everything
     * above provider_earnings — is what they now owe.
     */
    const share = Math.round((booking.total || booking.amount || 0) - (booking.provider_earnings || 0));
    const owed = Math.min(amt, share);
    if (owed > 0) await addLedger(booking.provider_id, "commission_due", owed, { bookingId, note: `${mode} taken by the pro for ${booking.service}` });
    if (left <= 0) Object.assign(upd, { provider_paid: true, paid_out_at: now });
  }
  const updated = await updateBooking(bookingId, upd);
  await alertStep(updated, left <= 0 ? "paid" : "payment_due",
    `${inr(amt)} received by ${mode}${receivedBy === "pro" ? ` (held by the pro${booking.provider_name ? ` ${booking.provider_name}` : ""})` : " (to WeAid)"}${left > 0 ? `; ${inr(left)} still due` : ""}.`);
  return { ok: true, due: left, received: amt };
}

/**
 * Nobody took an unpaid job. There is nothing to refund, so the honest thing
 * is to cancel it, tell the customer plainly, and put it in front of a person
 * — the same shape lib/errands.js uses when its ring-round comes up empty.
 */
export async function giveUpUnpaid(bookingOrId, reason = "Nobody was available to take this job") {
  const booking = typeof bookingOrId === "string" ? await getBooking(bookingOrId) : bookingOrId;
  if (!booking || booking.status !== "pending") return { skipped: "not open" };
  const r = await cancelBooking(booking.id, { by: "WeAid", reason, refundAmount: 0 });
  if (!r.ok) return { skipped: r.reason };

  const first = (booking.customer_name || "").split(" ")[0] || "there";
  const what = niceService(booking.service).toLowerCase();
  const text = `Hi ${first}, this is WeAid. We're sorry — we couldn't find a ${what} pro free for the time you asked, so nothing has been booked and nothing has been charged. ` +
    `Reply with another day or time and we'll try again, or call us on 080 6426 7771.`;
  await sendMessage(booking.customer_phone, text).catch((e) => console.error("[payafter] wa", e.message));
  if (booking.customer_email) await sendEmail(booking.customer_email, `WeAid — we couldn't find a ${what} pro this time`, `<p style="font-family:sans-serif">${text}</p>`).catch(() => {});
  if (errandReady()) {
    await placeErrandCall({
      phone: booking.customer_phone,
      task: `You are ringing ${booking.customer_name || "a customer"} about the ${what} job they booked with WeAid. Nobody was free to come at the time they wanted. Say that first, plainly, and apologise once. Nothing has been charged. Ask if another day or time would work; if so, say WeAid will try again then and message them. Do not ask for payment.`,
      onBehalfOf: "WeAid", callbackNumber: process.env.ERRAND_FROM_NUMBER || "",
      metadata: { booking: booking.id, kind: "no_pro" },
    }).catch((e) => console.error("[payafter] sorry call", e.message));
  }
  await openTicket({ kind: "callback", phone: booking.customer_phone, name: booking.customer_name, bookingId: booking.id, source: "web",
    summary: `No pro took this pay-after ${what} job within the time limit; it was cancelled and the customer told. Ring them to offer another time.` }).catch(() => {});
  return { cancelled: true };
}

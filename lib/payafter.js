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
 * the money is collected when the pro taps Done: a Razorpay UPI QR for the
 * exact amount (shown on the pro's phone, the customer's page and the bill),
 * a Razorpay link to the customer's phone, or — the fallback — cash to the
 * pro. The amount is whatever the pro's final bill said (lib/bill.js), or the
 * quoted price if no bill was entered. Cash means the pro is holding WeAid's
 * commission, so it goes in provider_ledger, comes off their next payout, and
 * past PRO_OWED_LIMIT they get no new offers until it is settled. QR and link
 * money lands with WeAid and the pro is paid in the weekly payout.
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
import { createPaymentLink, cancelPaymentLink, createUpiQr, closeUpiQr, razorpayConfigured } from "./razorpay.js";
import { openTicket } from "./followup.js";
import { sendMessage } from "./whatsapp.js";
import { sendEmail } from "./email.js";
import { pushToProvider } from "./fcm.js";
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
 * When the amount changes (the pro's final bill came in higher or lower) a
 * fresh link is made and the old one cancelled, so the customer can never pay
 * a stale figure.
 */
export async function jobPayInfo(booking, events) {
  events = events || (await eventsFor(booking.id));
  const amount = amountDue(booking, events);
  if (amount <= 0) return { paid: true, amount: 0 };
  const prior = events.filter((e) => e.event === "payment_due").pop()?.data;
  if (prior?.payUrl && prior.amount === amount) return { payUrl: prior.payUrl, amount };
  if (razorpayConfigured()) {
    try {
      if (prior?.linkId) await cancelPaymentLink(prior.linkId);
      const link = await createPaymentLink({
        amountInr: amount, bookingId: booking.id, name: booking.customer_name, phone: booking.customer_phone,
        description: `WeAid ${niceService(booking.service)} — payment for the job`,
        callbackUrl: jobLinks(booking.id).track, what: "job",
      });
      if (link?.short_url) {
        await logEvent(booking.id, "payment_due", { amount, payUrl: link.short_url, linkId: link.id || null });
        return { payUrl: link.short_url, amount };
      }
    } catch (e) { console.error("[payafter] pay link", e.message); }
  }
  if (!prior || prior.amount !== amount) await logEvent(booking.id, "payment_due", { amount, payUrl: null });
  return { amount, cashOnly: true };
}

/** The QR the customer should be scanning right now, if there is one: the latest, unclosed, unexpired, for exactly what is due. */
export function currentQr(events, amount) {
  const closed = new Set(events.filter((e) => e.event === "payment_qr_closed").map((e) => e.data?.id));
  const q = events.filter((e) => e.event === "payment_qr").pop()?.data;
  if (!q?.id || !q.imageUrl || closed.has(q.id)) return null;
  if (q.amount !== amount) return null;
  if (q.closeBy && q.closeBy * 1000 < Date.now()) return null;
  return { id: q.id, imageUrl: q.imageUrl, amount: q.amount };
}

/**
 * A Razorpay UPI QR for exactly what is due, or null when Razorpay is not set
 * up (the pro collects cash and taps Received; the bill still goes out). Kept
 * on a payment_qr event so the pro's page, the customer's page and the bill
 * all show the same code; a QR for an old amount is closed before a new one
 * is made.
 */
export async function jobQrInfo(booking, events) {
  events = events || (await eventsFor(booking.id));
  const amount = amountDue(booking, events);
  if (amount <= 0) return null;
  const have = currentQr(events, amount);
  if (have) return have;
  if (!razorpayConfigured()) return null;
  try {
    const stale = events.filter((e) => e.event === "payment_qr").pop()?.data;
    const closed = events.some((e) => e.event === "payment_qr_closed" && e.data?.id === stale?.id);
    if (stale?.id && !closed) { await closeUpiQr(stale.id); await logEvent(booking.id, "payment_qr_closed", { id: stale.id, why: "amount changed" }); }
    const qr = await createUpiQr({ amountInr: amount, bookingId: booking.id, description: `WeAid ${niceService(booking.service)} — ${inr(amount)}` });
    if (!qr?.id || !qr.image_url) return null;
    const data = { id: qr.id, imageUrl: qr.image_url, amount, closeBy: qr.close_by || null };
    await logEvent(booking.id, "payment_qr", data);
    return { id: data.id, imageUrl: data.imageUrl, amount };
  } catch (e) {
    console.error("[payafter] qr", e?.error?.description || e.message);
    return null;
  }
}

/** The latest final bill the pro reported (lib/bill.js writes it), or null. */
const latestBill = (events) => events.filter((e) => e.event === "final_bill").pop()?.data || null;

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * The job is done: tell the customer what to pay and how — the bill link, a
 * QR to scan, a Razorpay link, or cash to the pro. Safe to call for any
 * booking (it does nothing unless money is due) and safe to call twice: the
 * message goes once per amount. `force` re-sends it, which is what a final
 * bill that changed the amount needs.
 */
export async function collectAfterJob(bookingOrId, { force = false } = {}) {
  const booking = typeof bookingOrId === "string" ? await getBooking(bookingOrId) : bookingOrId;
  if (!booking || booking.payment_mode !== "pay_after" || booking.status !== "completed") return null;
  let events = await eventsFor(booking.id);
  const amount = amountDue(booking, events);
  if (amount <= 0) return { paid: true };
  const already = events.some((e) => e.event === "payment_due" && e.data?.amount === amount);
  const info = await jobPayInfo(booking, events);
  events = await eventsFor(booking.id);
  const qr = await jobQrInfo(booking, events);
  const out = { ...info, qr, billUrl: jobLinks(booking.id).bill };
  if (already && !force) return out;

  const first = (booking.customer_name || "").split(" ")[0] || "there";
  const pro = booking.provider_name || "your pro";
  const bill = latestBill(events);
  const items = (bill?.items || []).filter((i) => i.amount > 0);
  const lines = items.length ? items.map((i) => `${i.text} ${inr(i.amount)}`).join(", ") + ". " : "";
  const text = `Hi ${first}, your WeAid ${niceService(booking.service)} job is done. ${lines}Total ${inr(amount)} to pay WeAid. ` +
    `Your bill: ${out.billUrl} — ` +
    (qr ? "scan the QR on it with any UPI app" : "") +
    (qr && info.payUrl ? ", or " : "") +
    (info.payUrl ? `pay online at ${info.payUrl}` : "") +
    (qr || info.payUrl ? `. Or pay ${pro} by cash or UPI and they will mark it received.` : `pay ${pro} by cash or UPI and they will mark it received.`);
  await sendMessage(booking.customer_phone, text).catch((e) => console.error("[payafter] wa", e.message));
  if (booking.customer_email) {
    const rows = (items.length ? items : [{ text: `${niceService(booking.service)} job`, amount }])
      .map((i) => `<tr><td style="padding:6px 10px 6px 0">${escHtml(i.text)}</td><td style="padding:6px 0;text-align:right">${inr(i.amount)}</td></tr>`).join("");
    const html = `<div style="font-family:sans-serif;max-width:520px"><p>Hi ${escHtml(first)}, your WeAid ${escHtml(niceService(booking.service))} job is done${booking.provider_name ? ` — thank you for having ${escHtml(booking.provider_name)}` : ""}.</p>
      <table style="border-collapse:collapse">${rows}<tr><td style="padding:8px 10px 0 0;border-top:1px solid #ddd"><b>Total to pay WeAid</b></td><td style="padding:8px 0 0;border-top:1px solid #ddd;text-align:right"><b>${inr(amount)}</b></td></tr></table>
      <p><a href="${out.billUrl}">View or download your bill</a></p>
      ${qr ? `<p>Scan to pay ${inr(amount)} to WeAid with any UPI app:<br><img src="${escHtml(qr.imageUrl)}" alt="UPI QR" style="width:220px;height:220px"></p>` : ""}
      ${info.payUrl ? `<p>Or pay online: <a href="${escHtml(info.payUrl)}">${escHtml(info.payUrl)}</a></p>` : ""}
      <p style="color:#666">Or pay ${escHtml(pro)} by cash or UPI and they will mark it received.</p></div>`;
    await sendEmail(booking.customer_email, `WeAid bill — ${inr(amount)} for your ${niceService(booking.service)} job`, html).catch(() => {});
  }
  if (!info.payUrl && !qr) {
    await openTicket({ kind: "payment", phone: booking.customer_phone, name: booking.customer_name, bookingId: booking.id, source: "web",
      summary: `Job done, ${inr(amount)} due (pay-after, Razorpay not set up so no QR or link). The pro collects cash/UPI and taps Received; otherwise collect it and tap "Payment received" in Ops. Bill: ${out.billUrl}` }).catch(() => {});
  }
  await alertStep(booking, bill ? "billed" : "payment_due", `${inr(amount)} due from the customer${qr ? " — QR made" : ""}${info.payUrl ? ` — link: ${info.payUrl}` : ""}${!qr && !info.payUrl ? " — no QR or link (Razorpay not set up); cash/UPI to the pro" : ""}. Bill: ${out.billUrl}`);
  return out;
}

/**
 * The money came in one way; shut the other doors. A single-use QR closes
 * itself once paid and a paid link cannot be cancelled, so the calls that
 * fail are the harmless ones — and they never throw.
 */
async function closeCollectors(bookingId, events) {
  const qr = events.filter((e) => e.event === "payment_qr").pop()?.data;
  if (qr?.id && !events.some((e) => e.event === "payment_qr_closed" && e.data?.id === qr.id)) {
    if (razorpayConfigured()) await closeUpiQr(qr.id);
    await logEvent(bookingId, "payment_qr_closed", { id: qr.id, why: "paid" });
  }
  const link = events.filter((e) => e.event === "payment_due").pop()?.data;
  if (link?.linkId && razorpayConfigured()) await cancelPaymentLink(link.linkId);
}

/** Both sides hear that the job is paid: the pro on their phone, the customer with a receipt. */
async function tellBothPaid(booking, amt, mode, receivedBy) {
  const links = jobLinks(booking.id);
  const first = (booking.customer_name || "").split(" ")[0] || "the customer";
  if (receivedBy === "weaid") {
    const line = `${first} paid ${inr(amt)} for the ${niceService(booking.service)} job${mode === "cash" ? "" : " online"}. Your share, ${inr(booking.provider_earnings || 0)}, is in your next WeAid payout.`;
    if (booking.provider_id) await pushToProvider(booking.provider_id, { title: `Paid — ${inr(amt)} received`, body: line, data: { kind: "paid", bookingId: booking.id }, channel: "default" }).catch(() => {});
    if (booking.provider_phone) await sendMessage(booking.provider_phone, `WeAid: ${line} Job page: ${links.job}`).catch(() => {});
  }
  const receipt = `WeAid: received ${inr(amt)} for your ${niceService(booking.service)} job${receivedBy === "pro" ? ` (paid to ${booking.provider_name || "your pro"})` : ""}. Thank you! Your bill and receipt: ${links.bill}`;
  await sendMessage(booking.customer_phone, receipt).catch(() => {});
  if (booking.customer_email) {
    await sendEmail(booking.customer_email, `WeAid — receipt for ${inr(amt)}`,
      `<p style="font-family:sans-serif">${escHtml(receipt).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).catch(() => {});
  }
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
  if (left <= 0) {
    // Whichever way the money came — QR, link or cash — the other ways are shut
    // so the customer cannot pay twice, and both sides are told.
    await closeCollectors(bookingId, events).catch((e) => console.error("[payafter] close collectors", e.message));
    await tellBothPaid(updated, amt, mode, receivedBy).catch((e) => console.error("[payafter] tell paid", e.message));
  }
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

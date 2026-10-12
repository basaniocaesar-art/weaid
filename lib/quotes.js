/**
 * Quote jobs — roofing, waterproofing, tiling, flooring, renovation, painting
 * a whole home. Nobody can price these from a description, so (as Urban
 * Company does for painting and waterproofing):
 *
 *   1. ₹99 site visit, booked and paid like any small job. The visiting pro
 *      keeps the ₹99; if the customer goes ahead it is taken off the bill.
 *   2. At the site (after the arrival code) the pro writes an itemised quote,
 *      materials included, with days and a start date, plus photos.
 *   3. The customer accepts on their tracking page and pays a 35% advance
 *      (refundable until work starts), minus the ₹99 already paid.
 *   4. The pro starts work, posts progress photos, finishes with after photos.
 *   5. The customer confirms the work; the 65% balance is collected.
 *
 * Commission is on the whole quote (owner's decision, 8 Oct 2026). One booking
 * row carries the whole thing; every rupee is a "payment" event with `what`
 * (visit | advance | balance), so the money is always auditable.
 */
import { supabase, insertBooking, updateBooking, getBooking } from "./supabase.js";
import { SERVICES } from "./pricing.js";
import { logEvent, eventsFor, alertStep, jobLinks } from "./jobs.js";
import { createPaymentLink, razorpayConfigured } from "./razorpay.js";
import { openTicket, alertTeamBooking } from "./followup.js";

export const VISIT_FEE = 99;
export const ADVANCE_PCT = 0.35;
export const QUOTE_SERVICES = ["roofing", "waterproofing", "renovation", "tiling", "flooring"];

/** Does this job need a site visit rather than an instant price? */
export function needsVisit(service, { sqft, scope } = {}) {
  if (service === "event_cook") return false;   // planned on a call, not a site visit
  if (QUOTE_SERVICES.includes(service) || SERVICES[service]?.quoteOnly) return true;
  // One or two rooms of painting can be priced; a whole home needs a look.
  if (service === "painting") return scope === "large" || Number(sqft) >= 900;
  return false;
}

const isQuoteJob = (events) => events.some((e) => e.event === "quote_job");

/** Book the ₹99 site visit. Returns the booking. */
export async function createVisitBooking({ service, name, phone, address, area, description, when, lat, lng, source }) {
  const booking = await insertBooking({
    service, city: "kochi", scope: "quote", slot: "standard",
    customer_name: name || "Customer", customer_phone: phone, customer_email: null,
    subtotal: VISIT_FEE, platform_fee: 0, total: VISIT_FEE, commission: 0,   // the visit fee is the pro's
    amount: VISIT_FEE, commission_pct: 0, provider_earnings: VISIT_FEE,
    payment_gateway: "razorpay",
    timing_mode: when ? "scheduled" : "asap", scheduled_at: when || null,
    customer_lat: lat ?? null, customer_lng: lng ?? null,
    description: [description, `Site visit for a ${service} quote`, source === "phone" ? "Booked on the phone line" : ""].filter(Boolean).join(" — "),
    address: address || (area ? `${area}, Kochi` : null), workers: 1, status: "pending_payment",
  });
  await logEvent(booking.id, "quote_job", { service, source: source || "web" });
  await alertTeamBooking(booking, "new");
  return booking;
}

/** Everything about the money on a quote job. */
export function money(booking, events) {
  const pays = events.filter((e) => e.event === "payment");
  const sum = (w) => pays.filter((p) => p.data?.what === w).reduce((n, p) => n + (Number(p.data?.amount) || 0), 0);
  const visit = booking.paid_at ? VISIT_FEE : 0;
  const quote = events.filter((e) => e.event === "quote").pop()?.data || null;
  const total = quote ? quote.total : 0;
  const advanceDue = quote ? Math.max(0, Math.round(total * ADVANCE_PCT) - VISIT_FEE) : 0;
  const advance = sum("advance"), balance = sum("balance");
  const paid = visit + advance + balance;
  return {
    visit, advance, balance, paid, total,
    advanceDue: Math.max(0, advanceDue - advance),
    balanceDue: quote ? Math.max(0, total - paid) : 0,
    advanceTarget: advanceDue,
  };
}

/** The pro writes the quote at the site. */
export async function submitQuote(booking, events, { items, days, start, note }) {
  const clean = (items || []).map((i) => ({ text: String(i.text || "").trim().slice(0, 120), amount: Math.round(Number(i.amount) || 0) }))
    .filter((i) => i.text && i.amount > 0).slice(0, 25);
  if (!clean.length) throw new Error("Add at least one item with a price.");
  const total = clean.reduce((n, i) => n + i.amount, 0);
  if (total < VISIT_FEE * 2) throw new Error("That total looks too small for a quote job.");
  const d = Math.max(1, Math.min(120, Math.round(Number(days) || 1)));
  const quote = { items: clean, total, days: d, start: start || null, note: String(note || "").slice(0, 600), materialsIncluded: true, at: new Date().toISOString(), version: events.filter((e) => e.event === "quote").length + 1 };
  await logEvent(booking.id, "quote", quote);
  const rate = SERVICES[booking.service]?.commission ?? 0.1;
  await updateBooking(booking.id, { total, subtotal: total, amount: total, commission: Math.round(total * rate), commission_pct: rate, provider_earnings: Math.round(total * (1 - rate)) });
  await alertStep(booking, "quoted", `Quote ₹${total.toLocaleString("en-IN")} for ${d} day${d > 1 ? "s" : ""}. Customer's link: ${jobLinks(booking.id).track}`);
  return quote;
}

/** Customer accepts → advance due (Razorpay link if available, else the team collects). */
export async function acceptQuote(booking, events) {
  const m = money(booking, events);
  if (!m.total) throw new Error("There's no quote yet.");
  if (events.some((e) => e.event === "quote_accepted")) return { ok: true, already: true, ...(await payInfo(booking, "advance", m.advanceDue)) };
  await logEvent(booking.id, "quote_accepted", { total: m.total });
  await alertStep(booking, "awaiting_advance", `Customer accepted the ₹${m.total.toLocaleString("en-IN")} quote. Advance due: ₹${m.advanceDue}.`);
  if (m.advanceDue <= 0) { await logEvent(booking.id, "advance_paid", { amount: 0 }); return { ok: true, paid: true }; }
  return { ok: true, ...(await payInfo(booking, "advance", m.advanceDue)) };
}

export async function declineQuote(booking, reason) {
  await logEvent(booking.id, "quote_declined", { reason: String(reason || "").slice(0, 300) });
  await alertStep(booking, "quote_declined", reason ? `Reason: ${reason}` : "");
  return { ok: true };
}

/** A Razorpay link for the advance or balance, or a ticket for the team to collect it. */
export async function payInfo(booking, what, amount) {
  if (amount <= 0) return { paid: true };
  if (razorpayConfigured()) {
    try {
      const link = await createPaymentLink({
        amountInr: amount, bookingId: booking.id, name: booking.customer_name, phone: booking.customer_phone,
        description: `WeAid ${booking.service} — ${what === "advance" ? "35% advance" : "balance"}`,
        callbackUrl: jobLinks(booking.id).track, what,
      });
      if (link?.short_url) return { payUrl: link.short_url, amount };
    } catch (e) { console.error("[quotes] pay link", e.message); }
  }
  await openTicket({ kind: "payment", phone: booking.customer_phone, name: booking.customer_name, bookingId: booking.id, source: "web",
    summary: `Collect the ${what} for the ${booking.service} job: ₹${amount}. Then tap "${what === "advance" ? "Advance" : "Balance"} received" in Ops.` });
  return { teamWillCall: true, amount };
}

/** Record money received (webhook, or the owner's "received" button). */
export async function recordPayment(bookingId, what, amount, mode, ref) {
  const booking = await getBooking(bookingId);
  if (!booking) throw new Error("No such booking.");
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) throw new Error("Amount?");
  await logEvent(bookingId, "payment", { what, amount: amt, mode, ref: ref || null });
  const events = await eventsFor(bookingId);
  const m = money(booking, events);
  if (what === "advance" && m.advanceDue <= 0 && !events.some((e) => e.event === "advance_paid")) {
    await logEvent(bookingId, "advance_paid", { amount: m.advance });
    await alertStep(booking, "scheduled", `Advance received (₹${m.advance}). Work can start.`);
  }
  if (what === "balance" && m.balanceDue <= 0) await alertStep(booking, "done", "Balance received — fully paid.");
  return { ok: true, money: m };
}

export { isQuoteJob };

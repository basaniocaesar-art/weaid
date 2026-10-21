/**
 * The final bill on a pay-after job.
 *
 * A repair is quoted off a description — "fan not working", three hours — and
 * the real cost is only known when the pro has the ceiling open. So the pro
 * reports what it actually cost, two ways: on the /job page when they tap
 * Done, or by ringing the WeAid line and telling the agent (pages/api/
 * phone-line.js). Either way lands here, in reportFinalBill, and from here
 * WeAid does the collecting: the bill goes to the customer with a UPI QR for
 * exactly that amount, the money lands with WeAid, and the pro is paid their
 * share in the weekly payout (owner's decision, 21 Oct 2026).
 *
 * The bill is a `final_bill` event on the booking — items, total, and the
 * ORIGINAL quoted total, kept before the booking's own total is overwritten.
 * Commission is recomputed at the booking's own rate (the same percentage
 * lib/pricing.js used when it was quoted), so a ₹1,300 quote that becomes a
 * ₹2,100 bill still pays WeAid 12.5% and the pro the rest.
 *
 * Guard: a bill more than BILL_GUARD times the quote is not collected until
 * the customer has approved it on their page, and the team is told. Under
 * that, the QR goes out at once. Nothing here depends on Razorpay being set
 * up: without it the bill still goes out and the pro collects cash.
 */
import { getBooking, updateBooking } from "./supabase.js";
import { SERVICES } from "./pricing.js";
import { logEvent, eventsFor, alertStep, jobLinks } from "./jobs.js";
import { amountDue, jobPaid, collectAfterJob, currentQr } from "./payafter.js";
import { openTicket } from "./followup.js";
import { sendMessage } from "./whatsapp.js";
import { sendEmail } from "./email.js";

/** A final bill above this many times the quoted price waits for the customer's OK. */
export const BILL_GUARD = Number(process.env.BILL_GUARD_MULTIPLE) || 3;

const NICE = { electrical: "Electrician", plumbing: "Plumber", ac: "AC service", cleaning: "Cleaning", painting: "Painting", carpentry: "Carpentry", movers: "Packers & movers", pest_control: "Pest control", cctv: "CCTV", cook: "Cook", maid: "Housemaid", babysit: "Babysitter", nursing: "Home nurse", eldercare: "Elder care", driver: "Driver" };
export const niceService = (s) => NICE[s] || String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ── pure: amounts, shares, the guard ─────────────────────────────────── */

/** "₹1,250", "1250 rupees", " 1250.50 ", 1250 → 1251 (whole rupees). Anything unreadable → 0. */
export function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
  const s = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!s) return 0;
  return Math.round(Number(s[0]));
}

/**
 * The commission rate this booking was quoted at. commission_pct is written
 * at booking time (commission ÷ subtotal); older rows fall back to the
 * service's rate in lib/pricing.js, and a task-priced job (AC: ₹750 to the
 * customer, ₹500 to the pro) to its own numbers.
 */
export function effectiveRate(booking) {
  const pct = Number(booking?.commission_pct);
  if (pct > 0 && pct < 1) return pct;
  const sub = Number(booking?.subtotal || booking?.total || booking?.amount || 0), com = Number(booking?.commission || 0);
  if (sub > 0 && com > 0 && com < sub) return com / sub;
  const svc = SERVICES[booking?.service]?.commission;
  if (svc > 0) return svc;
  return 0.1;
}

/**
 * Split a final total the way the quote was split: the platform fee (if the
 * booking carried one) stays whole, the rest is subtotal, and WeAid takes the
 * same percentage of it as before. provider_earnings is what the pro is paid.
 */
export function shares(booking, total) {
  const t = Math.max(0, Math.round(Number(total) || 0));
  const fee = Math.min(t, Math.max(0, Math.round(Number(booking?.platform_fee) || 0)));
  const rate = effectiveRate(booking);
  const subtotal = t - fee;
  const commission = Math.round(subtotal * rate);
  return { total: t, subtotal, platform_fee: fee, commission, provider_earnings: subtotal - commission, rate };
}

/** More than BILL_GUARD × the quote (or any bill at all when there was no quote) needs the customer's OK first. */
export function needsApproval(total, original) {
  return Math.round(Number(total) || 0) > BILL_GUARD * Math.max(0, Math.round(Number(original) || 0));
}

/**
 * Tidy the pro's line items: text + whole rupees, zero lines dropped, 25 at
 * most. `total` is the figure the customer pays; if items were given they
 * must add up to it, because a bill whose lines disagree with its total is
 * not a bill anybody can read.
 */
export function cleanBill({ items, total, labour, parts } = {}) {
  const raw = Array.isArray(items) ? [...items] : [];
  if (parseAmount(labour) > 0) raw.push({ text: "Labour", amount: labour });
  if (parseAmount(parts) > 0) raw.push({ text: "Parts / materials", amount: parts });
  const clean = raw.map((i) => ({ text: String(i?.text ?? i?.label ?? "").trim().slice(0, 120), amount: parseAmount(i?.amount) }))
    .filter((i) => i.amount > 0).map((i) => ({ text: i.text || "Work", amount: i.amount })).slice(0, 25);
  const sum = clean.reduce((n, i) => n + i.amount, 0);
  let t = parseAmount(total);
  if (t <= 0 && sum > 0) t = sum;
  if (t <= 0) throw new Error("What is the total the customer should pay?");
  if (t > 500000) throw new Error("That total looks wrong — more than ₹5,00,000.");
  if (clean.length && sum !== t) throw new Error(`The items add up to ${inr(sum)} but the total says ${inr(t)}. Which is right?`);
  return { items: clean, total: t };
}

/** A stable bill number: WA-<yy><mm>-<first 8 of the booking id>. Same booking, same number, for ever. */
export function billNumber(booking) {
  const d = new Date(booking?.completed_at || booking?.created_at || Date.now());
  const yy = String(d.getFullYear()).slice(-2), mm = String(d.getMonth() + 1).padStart(2, "0");
  return `WA-${yy}${mm}-${String(booking?.id || "").replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** The part of an address people say out loud: "Kakkanad" from "12 Rose Villa, NH Bypass, Kakkanad, Kochi". */
export function areaOf(address) {
  const p = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!p.length) return "";
  const last = p[p.length - 1];
  return (/kochi|ernakulam|kerala|india|\d{6}/i.test(last) && p.length > 1 ? p[p.length - 2] : last).replace(/\s*\d{6}\s*$/, "");
}

/* ── reading the bill off the events ──────────────────────────────────── */

export const latestBill = (events) => events.filter((e) => e.event === "final_bill").pop()?.data || null;
export const hasBill = (events) => events.some((e) => e.event === "final_bill");

/** Where the latest bill stands: approved (collectable), waiting for the customer, or questioned. */
export function billState(events) {
  const bill = latestBill(events);
  if (!bill) return { bill: null, state: "none" };
  const after = (ev) => events.some((e) => e.event === ev && e.data?.version === bill.version);
  if (!bill.needs_approval) return { bill, state: "approved" };
  if (after("bill_approved")) return { bill, state: "approved" };
  if (after("bill_disputed")) return { bill, state: "disputed" };
  return { bill, state: "awaiting_approval" };
}

/** WeAid's own details for the bill, from env. Nothing is shown that is not set — and no tax is ever invented. */
export function billIssuer() {
  const gstin = String(process.env.WEAID_GSTIN || "").trim();
  return {
    name: String(process.env.WEAID_LEGAL_NAME || "").trim() || "WeAid",
    address: String(process.env.WEAID_ADDRESS || "").trim() || null,
    gstin: gstin || null,
    phone: "080 6426 7771",
    site: "weaid.in",
  };
}

/**
 * Everything the bill page, the customer's tracking page, the pro's job page
 * and Ops show about the bill — one shape, so they cannot disagree.
 */
export function billView(booking, events) {
  if (!booking || booking.payment_mode !== "pay_after") return null;
  const { bill, state } = billState(events);
  const done = booking.status === "completed";
  const total = bill && state !== "approved" ? bill.total : Math.round(booking.total || booking.amount || 0);
  const paid = jobPaid(events);
  const due = state === "approved" || !bill ? amountDue(booking, events) : Math.max(0, bill.total - paid);
  const items = bill?.items?.length ? bill.items : [{ text: `${niceService(booking.service)} job${bill ? "" : " — as quoted"}`, amount: total }];
  const links = jobLinks(booking.id);
  const shared = events.filter((e) => e.event === "bill_shared").map((e) => ({ by: e.data?.by || "", via: e.data?.via || "", at: e.created_at }));
  const qr = done && state !== "awaiting_approval" && state !== "disputed" ? currentQr(events, due) : null;
  const payUrl = done && state !== "awaiting_approval" && state !== "disputed" ? events.filter((e) => e.event === "payment_due").pop()?.data?.payUrl || null : null;
  return {
    number: billNumber(booking),
    date: booking.completed_at || bill?.at || null,
    ready: done,
    service: niceService(booking.service),
    description: booking.description || "",
    customer: { name: booking.customer_name || "Customer", area: areaOf(booking.address) },
    pro: booking.provider_name || "",
    items, total, paid, due,
    status: !done ? "not_ready" : booking.paid_at || due <= 0 ? "paid" : state === "awaiting_approval" ? "awaiting_approval" : state === "disputed" ? "disputed" : "unpaid",
    original: bill?.original_total ?? null,
    version: bill?.version ?? 0,
    note: bill?.note || "",
    reportedBy: bill?.by || null,
    qr, payUrl,
    link: links.bill,
    shared,
    issuer: billIssuer(),
    /*
     * TAX LINES — deliberately empty. When WeAid is GST-registered and has
     * decided how a marketplace bill is taxed (on the commission only, or on
     * the whole job), add the lines here — e.g. { label: "CGST 9%", amount }
     * — and the bill page prints them under the items. Until then nothing is
     * shown, because a made-up tax line is worse than none.
     */
    tax: [],
  };
}

/* ── click-to-chat: the bill goes out on people's own WhatsApp ───────── */

/** The short message a pro (or Ops) sends the customer with the bill. */
export function billMessage(booking, view, signedBy) {
  const first = (booking.customer_name || "").split(" ")[0] || "there";
  const pay = view.payUrl ? `Pay by scanning the QR or here: ${view.payUrl}.` : view.qr ? "Pay by scanning the QR on the bill." : `Pay by cash or UPI to ${booking.provider_name || "your pro"}, or on the bill page.`;
  return `Hi ${first}, your WeAid bill for ${view.service}: ${inr(view.total)}. View / download: ${view.link}. ${pay} Thank you — ${signedBy || "WeAid"}${signedBy && signedBy !== "WeAid" ? ", WeAid" : ""}`;
}

/** wa.me link to a number, or null when there is no usable Indian mobile. */
export function waLink(phone, text) {
  const d = ten(phone);
  if (!/^[6-9]\d{9}$/.test(d)) return null;
  return `https://wa.me/91${d}?text=${encodeURIComponent(text)}`;
}

/* ── the actions ──────────────────────────────────────────────────────── */

/**
 * The pro says what the job cost. `by` is who reported it ("pro", "phone",
 * "concierge", "ops"); `items` optional, `total` required (or labour/parts,
 * from which the total follows). Completes the job if it is still open — a
 * bill means the work is finished — then either collects (QR + link + bill
 * to the customer) or, over the guard, asks the customer to approve first.
 */
export async function reportFinalBill(bookingId, { items, total, labour, parts, note = "", by = "pro", source = "web" } = {}) {
  const clean = cleanBill({ items, total, labour, parts });
  let booking = await getBooking(bookingId);
  if (!booking) throw new Error("No such booking.");
  if (booking.payment_mode !== "pay_after") throw new Error("This isn't a pay-after job — the price was fixed when it was booked.");
  if (["cancelled", "refunded"].includes(booking.status)) throw new Error("This job was cancelled.");
  if (booking.paid_at) throw new Error("This job is already paid — the bill can't be changed now.");
  let events = await eventsFor(bookingId);
  if (!["accepted", "in_progress", "completed", "pending"].includes(booking.status)) throw new Error(`This job is ${booking.status}.`);
  if (booking.status !== "completed" && !events.some((e) => e.event === "arrived")) throw new Error("The pro hasn't checked in at the customer's yet.");

  const prior = events.filter((e) => e.event === "final_bill");
  const original = prior[0]?.data?.original_total ?? Math.round(booking.total || booking.amount || 0);

  if (booking.status !== "completed") {
    booking = await updateBooking(bookingId, { status: "completed", completed_at: new Date().toISOString() });
    await logEvent(bookingId, "done", { note: `Finished — final bill reported by ${by}${note ? `: ${String(note).slice(0, 300)}` : ""}` });
    await alertStep(booking, "done", `Marked done by the final bill (${by}).`);
  }

  const sh = shares(booking, clean.total);
  const approval = needsApproval(clean.total, original);
  const bill = {
    version: prior.length + 1, items: clean.items, total: clean.total, original_total: original,
    note: String(note || "").slice(0, 600), by, source, needs_approval: approval,
    commission: sh.commission, provider_earnings: sh.provider_earnings, rate: sh.rate, at: new Date().toISOString(),
  };
  await logEvent(bookingId, "final_bill", bill);

  if (!approval) {
    booking = await applyBill(booking, bill);
    const info = await collectAfterJob(booking, { force: true });
    return { ok: true, bill, needsApproval: false, total: clean.total, due: info?.amount ?? clean.total, payUrl: info?.payUrl || null, qr: info?.qr || null, billUrl: jobLinks(bookingId).bill, providerEarnings: sh.provider_earnings };
  }

  // Over the guard: the quote stays on the booking until the customer says yes.
  const links = jobLinks(bookingId);
  const first = (booking.customer_name || "").split(" ")[0] || "there";
  const lines = clean.items.map((i) => `${i.text} ${inr(i.amount)}`).join(", ");
  const text = `Hi ${first}, ${booking.provider_name || "your pro"} has finished your WeAid ${niceService(booking.service)} job and the final bill is ${inr(clean.total)}${lines ? ` (${lines})` : ""} — more than the ${inr(original)} quoted, so nothing is charged until you approve it. See the bill and approve or question it here: ${links.track}`;
  await sendMessage(booking.customer_phone, text).catch((e) => console.error("[bill] wa", e.message));
  if (booking.customer_email) await sendEmail(booking.customer_email, `WeAid — please approve the final bill (${inr(clean.total)})`, `<p style="font-family:sans-serif">${esc(text).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`).catch(() => {});
  await alertStep(booking, "bill_review", `Final bill ${inr(clean.total)} is ${(clean.total / Math.max(1, original)).toFixed(1)}× the quoted ${inr(original)}${lines ? ` (${lines})` : ""}. Reported by ${by}. The customer has been asked to approve on ${links.track}; no QR or link until they do.`);
  await openTicket({ kind: "payment", phone: booking.customer_phone, name: booking.customer_name, bookingId, source, summary: `Final bill ${inr(clean.total)} vs quoted ${inr(original)} (over ${BILL_GUARD}×) on the ${booking.service} job — reported by ${by}. Customer asked to approve on their page; ring both sides if nothing happens in an hour.`, details: { items: lines || "(no line items)", pro: `${booking.provider_name || ""} ${booking.provider_phone || ""}` } }).catch(() => {});
  return { ok: true, bill, needsApproval: true, total: clean.total, original, billUrl: links.bill, providerEarnings: sh.provider_earnings };
}

/** Put the bill's figures on the booking: total, commission and the pro's share, the way lib/quotes.js does for a quote. */
async function applyBill(booking, bill) {
  const sh = shares(booking, bill.total);
  return updateBooking(booking.id, { total: sh.total, amount: sh.total, subtotal: sh.subtotal, commission: sh.commission, provider_earnings: sh.provider_earnings });
}

/** The customer approves a bill that was over the guard: the figures go on the booking and collection starts. */
export async function approveBill(booking, events) {
  const { bill, state } = billState(events);
  if (!bill) throw new Error("There's no bill to approve.");
  if (state === "approved") return { ok: true, already: true };
  await logEvent(booking.id, "bill_approved", { version: bill.version, total: bill.total });
  const updated = await applyBill(booking, bill);
  const info = await collectAfterJob(updated, { force: true });
  await alertStep(updated, "bill_approved", `Customer approved ${inr(bill.total)} (quoted ${inr(bill.original_total)}).${info?.qr ? " QR made." : ""}${info?.payUrl ? ` Link: ${info.payUrl}` : ""}`);
  return { ok: true, total: bill.total, due: info?.amount ?? bill.total, payUrl: info?.payUrl || null, qr: info?.qr || null, billUrl: jobLinks(booking.id).bill };
}

/** The customer questions the bill: a person rings them, and nothing is collected until it is sorted. */
export async function disputeBill(booking, events, reason = "") {
  const { bill } = billState(events);
  if (!bill) throw new Error("There's no bill to question.");
  const why = String(reason || "").trim().slice(0, 500);
  await logEvent(booking.id, "bill_disputed", { version: bill.version, reason: why });
  const { ref } = await openTicket({ kind: "complaint", phone: booking.customer_phone, name: booking.customer_name, bookingId: booking.id, source: "web",
    summary: `Customer questioned the final bill of ${inr(bill.total)} (quoted ${inr(bill.original_total)}) on the ${booking.service} job${why ? `: "${why}"` : ""}. Ring them and the pro, then re-enter the bill from Ops or the pro's page.`,
    details: { pro: `${booking.provider_name || ""} ${booking.provider_phone || ""}` } });
  await alertStep(booking, "bill_disputed", `${why || "No reason given"}. Ticket ${ref}.`);
  return { ok: true, ref };
}

/** The pro's or Ops' finger on "Send bill on WhatsApp": remembered so Ops can see who has not been sent theirs. */
export async function noteBillShared(bookingId, { by = "pro", via = "whatsapp" } = {}) {
  await logEvent(bookingId, "bill_shared", { by: String(by).slice(0, 20), via: String(via).slice(0, 20) });
  return { ok: true };
}

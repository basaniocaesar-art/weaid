/**
 * Every promise to ring somebody back becomes a task a person actually sees.
 *
 * The concierge used to say "somebody will ring you within the hour" when card
 * payment failed, and nothing told anybody to make that call. The phone line
 * takes complaints and callback requests the same way. So each of those opens a
 * ticket: a row in support_tickets (when that table exists) and, always, an
 * email to the team, because an email lands even before the table is created.
 *
 * kind:  callback   — they asked us to ring them
 *        payment    — booking saved but payment could not be taken
 *        complaint  — something went wrong with a job
 *        site_visit — bigger job; someone must visit and quote
 *        provider   — a pro rang about their own work
 */
import { supabase } from "./supabase.js";
import { sendAdminNotification } from "./email.js";
import { jobLinks } from "./jobs.js";

const LABEL = {
  callback: "Call back",
  payment: "Payment not taken — call to arrange",
  complaint: "COMPLAINT",
  site_visit: "Site visit + quote",
  provider: "Provider call",
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Short reference a caller can read back: WA plus 4 digits (spoken as just the digits). */
function newRef() {
  return `WA${String(Math.floor(1000 + Math.random() * 9000))}`;
}

export async function openTicket({ kind, phone, name, bookingId, summary, details = {}, source = "web" }) {
  const ref = newRef();
  const row = {
    ref, kind, source,
    customer_phone: phone || null,
    customer_name: name || null,
    booking_id: bookingId || null,
    summary: String(summary || "").slice(0, 2000),
    details,
    status: "open",
  };

  // The table is optional: a missing table must never stop the email.
  const { error } = await supabase.from("support_tickets").insert(row);
  if (error) console.warn("[followup] support_tickets insert failed:", error.message);

  const urgent = kind === "complaint" || kind === "payment";
  const lines = [
    ["Reference", ref],
    ["Type", LABEL[kind] || kind],
    ["Name", name],
    ["Phone", phone],
    ["Booking", bookingId],
    ["Came in via", source === "phone" ? "Phone line (AI)" : "Website assistant"],
    ["What they said", summary],
    ...Object.entries(details).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k.replace(/_/g, " "), v]),
  ].filter(([, v]) => v != null && v !== "");
  const html =
    `<p><b>${urgent ? "Please call within the hour." : "Please follow up today."}</b></p>` +
    `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">${lines
      .map(([k, v]) => `<tr><td style="color:#64748b">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`)
      .join("")}</table><p style="font-family:sans-serif"><a href="${opsLink()}">Open WeAid Ops → Issues</a></p>`;
  try {
    await sendAdminNotification(`[WeAid ${ref}] ${LABEL[kind] || kind}${name ? ` — ${name}` : ""}${phone ? ` ${phone}` : ""}`, html);
  } catch (e) {
    console.error("[followup] email failed:", e.message);
  }
  return { ref };
}

/**
 * The owner hears about every booking the moment it happens, and again when it
 * is paid. Email to ADMIN_EMAIL; same channel as tickets.
 */
export async function alertTeamBooking(booking, event = "new") {
  if (!booking) return;
  const when = booking.scheduled_at
    ? new Date(booking.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "As soon as possible";
  const rows = [
    ["Status", event === "paid" ? "PAID — finding a pro now" : "Booked, waiting for payment"],
    ["Service", `${booking.service} (${booking.scope || ""})`],
    ["Amount", `₹${Math.round(booking.total || booking.amount || 0)}`],
    ["When", when],
    ["Customer", `${booking.customer_name || ""} ${booking.customer_phone || ""}`],
    ["Address", booking.address],
    ["Problem", booking.description],
    ["Booking id", booking.id],
  ].filter(([, v]) => v);
  const html = `<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">${rows
    .map(([k, v]) => `<tr><td style="color:#64748b">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>` +
    `<p style="font-family:sans-serif"><a href="${opsLink()}">Assign a pro in WeAid Ops</a> · <a href="${jobLinks(booking.id).track}">Customer's tracking page</a></p>`;
  try {
    await sendAdminNotification(`[WeAid] ${event === "paid" ? "💰 PAID" : "🆕 New booking"} — ${booking.service} ₹${Math.round(booking.total || 0)} — ${booking.customer_name || ""}`, html);
  } catch (e) {
    console.error("[followup] booking alert failed:", e.message);
  }
}

/** The ops board link, with the key in the #fragment (never sent to the server or logged). */
export function opsLink() {
  return `${process.env.NEXT_PUBLIC_URL || "https://weaid.in"}/ops${process.env.OPS_KEY ? `#k=${encodeURIComponent(process.env.OPS_KEY)}` : ""}`;
}

/**
 * Following a job from "paid" to "done" without anybody installing an app.
 *
 * Three people need to see the same job:
 *   the customer   → /track?b=<id>&k=<token>   status, arrival code, the pro's dot on a map
 *   the pro        → /job?b=<id>&k=<token>     address, "I'm on my way", enter code, done
 *   the owner      → /ops                      every job, assign a pro, share the links
 *
 * Links are signed (HMAC of the booking id), so nobody can guess another job's
 * page, and nothing new has to be stored: the arrival code is derived the same
 * way. Each step is a row in booking_events, the pro's live position goes in
 * driver_locations (keyed by provider id, trip_id = the booking id), and the
 * owner gets an email at every step.
 *
 * The bookings.status column only allows pending_payment / pending / accepted /
 * completed / cancelled / refunded, so "on the way" and "arrived" live in
 * booking_events rather than in status.
 */
import crypto from "crypto";
import { supabase } from "./supabase.js";
import { sendAdminNotification } from "./email.js";

const SECRET = () => process.env.JOB_LINK_SECRET || process.env.PHONE_LINE_KEY || "weaid-dev-only";
const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";

const mac = (s) => crypto.createHmac("sha256", SECRET()).update(s).digest();

/** 12-character token for a role ("pro" | "cust") on a booking. */
export function linkToken(role, bookingId) {
  return mac(`${role}:${bookingId}`).toString("base64url").slice(0, 12);
}
export function checkToken(role, bookingId, token) {
  if (!bookingId || !token) return false;
  const want = Buffer.from(linkToken(role, bookingId));
  const got = Buffer.from(String(token));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** The 4-digit code the customer gives the pro on arrival. */
export function arrivalCode(bookingId) {
  return String(mac(`otp:${bookingId}`).readUInt32BE(0) % 9000 + 1000);
}

export function jobLinks(bookingId) {
  return {
    track: `${SITE()}/track?b=${bookingId}&k=${linkToken("cust", bookingId)}`,
    job: `${SITE()}/job?b=${bookingId}&k=${linkToken("pro", bookingId)}`,
    ops: `${SITE()}/ops`,
  };
}

/** Owner key for /ops. */
export function checkOpsKey(req) {
  const want = process.env.OPS_KEY || "";
  const got = req.headers["x-ops-key"] || "";
  if (!want || !got || want.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

export async function logEvent(bookingId, event, data = {}) {
  const { error } = await supabase.from("booking_events").insert({ booking_id: bookingId, event, data });
  if (error) console.warn("[jobs] event insert failed:", error.message);
}

export async function eventsFor(bookingId) {
  const { data } = await supabase.from("booking_events").select("event,data,created_at")
    .eq("booking_id", bookingId).order("created_at", { ascending: true });
  return data || [];
}

/** Where the job really is, from status + events. */
export function stageOf(booking, events) {
  if (!booking) return "unknown";
  // Site-visit-and-quote jobs have their own path (lib/quotes.js).
  if (events.some((e) => e.event === "quote_job")) return quoteStage(booking, events);
  if (events.some((e) => e.event === "courier_job")) return courierStage(booking, events);
  if (["cancelled", "refunded"].includes(booking.status)) return booking.status;
  if (booking.status === "completed") return "done";
  const has = (e) => events.some((x) => x.event === e);
  if (has("arrived")) return "arrived";
  if (has("on_the_way")) return "on_the_way";
  if (booking.status === "accepted" || booking.provider_name) return "assigned";
  if (booking.status === "pending") return "finding";
  return "unpaid";
}

/** Courier / bike ride: pickup → drop (kept here to avoid a circular import). */
function courierStage(booking, events) {
  if (["cancelled", "refunded"].includes(booking.status)) return booking.status;
  if (booking.status === "completed") return "done";
  const has = (e) => events.some((x) => x.event === e);
  if (has("picked_up")) return "in_transit";
  if (has("on_the_way")) return "to_pickup";
  if (booking.status === "accepted" || booking.provider_name) return "assigned";
  if (booking.status === "pending") return "finding";
  return "unpaid";
}

/** Stages of a quote job: visit → quote → advance → work → done. */
export function quoteStage(booking, events) {
  if (["cancelled", "refunded"].includes(booking.status)) return booking.status;
  if (booking.status === "completed") return "done";
  const has = (e) => events.some((x) => x.event === e);
  if (has("quote_declined")) return "quote_declined";
  if (has("work_started")) return "working";
  if (has("advance_paid")) return "scheduled";
  if (has("quote_accepted")) return "awaiting_advance";
  if (has("quote")) return "quoted";
  if (has("arrived")) return "visiting";
  if (has("on_the_way")) return "on_the_way";
  if (booking.status === "accepted" || booking.provider_name) return "assigned";
  if (booking.status === "pending") return "finding";
  return "unpaid";
}

export const STAGE_WORDS = {
  to_pickup: "Rider is on the way to pick up",
  in_transit: "Picked up — on the way to drop",
  visiting: "Site visit in progress",
  quoted: "Quote ready — waiting for your OK",
  awaiting_advance: "Quote accepted — advance payment due",
  scheduled: "Advance paid — work scheduled",
  working: "Work in progress",
  quote_declined: "Quote declined",
  unpaid: "Booked — waiting for payment",
  finding: "Paid — finding the nearest pro",
  assigned: "A pro is assigned",
  on_the_way: "Your pro is on the way",
  arrived: "Your pro has arrived",
  done: "Job done",
  cancelled: "Cancelled",
  refunded: "Cancelled and refunded",
  unknown: "Unknown",
};

/**
 * driver_locations is keyed by a provider id. A pro assigned by hand from a
 * phone call may not have a providers row, so a stable pseudo-id is derived
 * from the booking — still unique per job, never colliding with a real pro.
 */
export function locationKey(booking) {
  if (booking.provider_id) return booking.provider_id;
  const h = mac(`loc:${booking.id}`).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function saveLocation(booking, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const { error } = await supabase.from("driver_locations").upsert(
    { driver_id: locationKey(booking), trip_id: booking.id, lat, lng, updated_at: new Date().toISOString() },
    { onConflict: "driver_id" },
  );
  if (error) console.warn("[jobs] location upsert failed:", error.message);
}

export async function latestLocation(booking) {
  const { data } = await supabase.from("driver_locations").select("lat,lng,updated_at,trip_id")
    .eq("driver_id", locationKey(booking)).maybeSingle();
  if (!data || data.trip_id !== booking.id) return null;
  if (Date.now() - Date.parse(data.updated_at) > 15 * 60e3) return null;
  return { lat: data.lat, lng: data.lng, at: data.updated_at };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** One-line email to the owner for each step. */
export async function alertStep(booking, stage, extra = "") {
  const links = jobLinks(booking.id);
  const html =
    `<p style="font-family:sans-serif"><b>${esc(STAGE_WORDS[stage] || stage)}</b> — ${esc(booking.service)} for ${esc(booking.customer_name || "")} ${esc(booking.customer_phone || "")}` +
    `${booking.provider_name ? `<br>Pro: <b>${esc(booking.provider_name)}</b> ${esc(booking.provider_phone || "")}` : ""}` +
    `${extra ? `<br>${esc(extra)}` : ""}` +
    `<br><br><a href="${links.track}">Customer's tracking page</a> · <a href="${links.ops}${process.env.OPS_KEY ? `#k=${encodeURIComponent(process.env.OPS_KEY)}` : ""}">Open WeAid Ops</a></p>`;
  try {
    await sendAdminNotification(`[WeAid] ${STAGE_WORDS[stage] || stage} — ${booking.service} — ${booking.customer_name || ""}`, html);
  } catch (e) {
    console.error("[jobs] step alert failed:", e.message);
  }
}

/** 6-digit code a pro types into the WeAid Pro app with their phone number. Shown to the owner in /ops. */
export function loginCode(providerId) {
  return String(mac(`login:${providerId}`).readUInt32BE(0) % 900000 + 100000);
}

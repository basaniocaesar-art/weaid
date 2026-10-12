/**
 * Courier (live) and bike rides (built, hidden) — pickup → drop on one booking.
 *
 * Proof of custody:
 *   pickup   the sender's 4-digit code + a photo of the item + the rider's GPS
 *   drop     the RECEIVER's own 4-digit code + a delivery photo + GPS
 * The receiver gets their own tracking link (live position after pickup).
 *
 * Booking row: service "courier" | "bike_ride", scope "delivery", address and
 * customer_lat/lng = PICKUP; the drop, receiver and item ride on the
 * "courier_job" event. Stages: unpaid → finding → assigned → to_pickup →
 * in_transit → done.
 */
import crypto from "crypto";
import { insertBooking } from "./supabase.js";
import { calculatePrice } from "./pricing.js";
import { roadDistanceKm, haversineKm, geocode } from "./geo.js";
import { logEvent, linkToken, arrivalCode } from "./jobs.js";
import { alertTeamBooking } from "./followup.js";

const SECRET = () => process.env.JOB_LINK_SECRET || "weaid-dev-only";
export const dropCode = (bookingId) => String(crypto.createHmac("sha256", SECRET()).update(`drop:${bookingId}`).digest().readUInt32BE(0) % 9000 + 1000);
export const pickupCode = arrivalCode;

export const isCourierJob = (events) => events.some((e) => e.event === "courier_job");
export const courierInfo = (events) => events.find((e) => e.event === "courier_job")?.data || null;

const pt = (o) => (o && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)) ? { name: String(o.name || o.address || "").slice(0, 200), lat: Number(o.lat), lng: Number(o.lng) } : null);

/** Price a delivery/ride between two places (text or pins). */
export async function quoteTrip({ service = "courier", pickup, drop }) {
  const a = pt(pickup) || (await geocode(typeof pickup === "string" ? pickup : pickup?.name));
  const b = pt(drop) || (await geocode(typeof drop === "string" ? drop : drop?.name));
  if (!a) throw new Error("Couldn't find the pickup place — ask for a landmark or area.");
  if (!b) throw new Error("Couldn't find the drop place — ask for a landmark or area.");
  if (typeof pickup === "string") a.name = pickup;
  if (typeof drop === "string") b.name = drop;
  const km = (await roadDistanceKm(a.lat, a.lng, b.lat, b.lng)) || haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.3;
  if (km > 60) throw new Error("That's more than 60 km — WeAid courier covers Kochi and nearby towns.");
  const price = calculatePrice({ service, city: "kochi", km });
  return { pickup: a, drop: b, km: Math.round(km * 10) / 10, price };
}

export async function createTrip({ service = "courier", pickup, drop, item, receiver, sender, when, notes, source }) {
  const q = await quoteTrip({ service, pickup, drop });
  const p = q.price;
  const booking = await insertBooking({
    service, city: "kochi", scope: "delivery", slot: "standard",
    customer_name: sender.name || "Customer", customer_phone: sender.phone, customer_email: null,
    subtotal: p.subtotal, platform_fee: 0, total: p.total, commission: p.commission,
    amount: p.total, commission_pct: p.subtotal ? Number((p.commission / p.subtotal).toFixed(4)) : 0, provider_earnings: p.providerEarnings,
    payment_gateway: "razorpay", timing_mode: when ? "scheduled" : "asap", scheduled_at: when || null,
    customer_lat: q.pickup.lat, customer_lng: q.pickup.lng, address: q.pickup.name,
    description: service === "courier" ? `${item || "Parcel"} → ${q.drop.name}${notes ? ` — ${notes}` : ""}` : `Ride to ${q.drop.name}`,
    workers: 1, status: "pending_payment",
  });
  await logEvent(booking.id, "courier_job", {
    kind: service, drop: q.drop, pickup: q.pickup, km: q.km, item: item || null, notes: notes || null,
    receiver: receiver?.phone ? { name: receiver.name || "", phone: receiver.phone } : null, source: source || "web",
  });
  await alertTeamBooking(booking, "new");
  return { booking, km: q.km, total: p.total };
}

/** Receiver's link (no money, no sender details). */
export const receiverLink = (bookingId) => `${process.env.NEXT_PUBLIC_URL || "https://weaid.in"}/track?b=${bookingId}&k=${linkToken("recv", bookingId)}`;

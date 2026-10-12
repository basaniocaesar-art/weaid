/**
 * Carpool v2 — cost-sharing rides (HIDDEN: not linked, not in Google, not
 * offered by the chat/phone until the owner switches it on after a legal check).
 *
 * Why it is built this way (Kerala Motor Vehicles rules, see memory):
 *   - Drivers are people already making the trip, in their own car. They are
 *     WeAid accounts with a checked driving licence.
 *   - WeAid SETS the seat price from the road distance (fuel & tolls share,
 *     ~₹2.5/km per seat) so nobody runs a for-profit taxi through it.
 *   - WeAid's income is the rider's booking fee, not a cut of a fare.
 *
 * Money: the rider pays seats × price + fee when booking (no payment, no seat).
 * WeAid holds it; the driver is paid the seat money after the trip, once the
 * rider's 4-digit ride code was entered at pickup. Rider cancels >2 h before →
 * seat money back (fee kept); later → nothing. Driver cancels → everyone gets
 * everything back.
 */
import crypto from "crypto";
import { supabase } from "./supabase.js";
import { roadDistanceKm, haversineKm } from "./geo.js";
import { createOrder, razorpayConfigured, razorpayKeyId, processRefund } from "./razorpay.js";
import { sendAdminNotification } from "./email.js";
import { opsLink } from "./followup.js";
import { pushToProvider } from "./fcm.js";

export const PER_KM = 2.5;
export const FEE_PER_SEAT = Number(process.env.CARPOOL_FEE || 25);
const PICKUP_KM = 6, DROP_KM = 10;
const SECRET = () => process.env.JOB_LINK_SECRET || "weaid-dev-only";
const mac = (s) => crypto.createHmac("sha256", SECRET()).update(s).digest();

export const seatToken = (seatId) => mac(`seat:${seatId}`).toString("base64url").slice(0, 12);
export const checkSeatToken = (seatId, k) => {
  if (!seatId || !k) return false;
  const a = Buffer.from(seatToken(seatId)), b = Buffer.from(String(k));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export const rideCode = (seatId) => String(mac(`ride:${seatId}`).readUInt32BE(0) % 9000 + 1000);
export const seatLink = (seatId) => `${process.env.NEXT_PUBLIC_URL || "https://weaid.in"}/carpool?s=${seatId}&k=${seatToken(seatId)}`;

/** Cost-share price per seat: ~₹2.5/km, rounded to ₹10, ₹50 minimum. */
export function seatPrice(km) {
  return Math.max(50, Math.round((Number(km) || 0) * PER_KM / 10) * 10);
}

const pt = (o) => (o && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)) ? { lat: Number(o.lat), lng: Number(o.lng) } : null);
const near = (a, b, km) => a && b && haversineKm(a.lat, a.lng, b.lat, b.lng) <= km;

/* ---------- driver ---------- */

export async function createRide(pro, body) {
  if (!pro.verified) throw new Error("Your account must be verified by WeAid (with your driving licence) before you can offer rides.");
  const from = pt(body.from), to = pt(body.to);
  if (!from || !to) throw new Error("Pick the start and destination from the suggestions.");
  const depart = Date.parse(body.departAt);
  if (!Number.isFinite(depart) || depart < Date.now() + 30 * 60e3) throw new Error("Choose a departure time at least 30 minutes from now.");
  if (depart > Date.now() + 30 * 86400e3) throw new Error("You can post rides up to 30 days ahead.");
  const seats = Math.max(1, Math.min(6, Math.round(Number(body.seats) || 0)));
  const carModel = String(body.carModel || "").trim().slice(0, 40);
  const carNumber = String(body.carNumber || "").toUpperCase().replace(/\s+/g, " ").trim().slice(0, 16);
  if (!carModel || carNumber.length < 6) throw new Error("Add your car model and number.");
  const km = (await roadDistanceKm(from.lat, from.lng, to.lat, to.lng)) || haversineKm(from.lat, from.lng, to.lat, to.lng) * 1.3;
  if (km < 10) throw new Error("Carpool is for trips of 10 km or more.");
  const stops = (Array.isArray(body.stops) ? body.stops : []).map((s) => ({ name: String(s.name || "").slice(0, 80), ...pt(s) })).filter((s) => s.name && s.lat).slice(0, 5);
  const price = seatPrice(km);
  const { data, error } = await supabase.from("carpools").insert({
    provider_id: pro.id, driver_name: pro.name, driver_phone: pro.phone,
    from_address: String(body.from.name || "").slice(0, 160), from_lat: from.lat, from_lng: from.lng,
    to_address: String(body.to.name || "").slice(0, 160), to_lat: to.lat, to_lng: to.lng,
    stops, depart_at: new Date(depart).toISOString(), seats_total: seats, seats_left: seats,
    price_per_seat: price, fee_per_seat: FEE_PER_SEAT, distance_km: Math.round(km * 10) / 10,
    car_model: carModel, car_number: carNumber, notes: String(body.notes || "").slice(0, 300) || null, status: "open",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function driverRides(pro) {
  const { data: rides } = await supabase.from("carpools").select("*").eq("provider_id", pro.id)
    .gte("depart_at", new Date(Date.now() - 3 * 86400e3).toISOString()).order("depart_at", { ascending: true }).limit(30);
  const ids = (rides || []).map((r) => r.id);
  const { data: seats } = ids.length ? await supabase.from("carpool_seats").select("*").in("carpool_id", ids).in("status", ["confirmed", "boarded", "no_show"]) : { data: [] };
  return (rides || []).map((r) => ({
    ...r,
    passengers: (seats || []).filter((s) => s.carpool_id === r.id).map((s) => ({ id: s.id, name: s.rider_name, phone: s.rider_phone, seats: s.seats, pickup: s.pickup, status: s.status })),
    earnings: (seats || []).filter((s) => s.carpool_id === r.id && s.status === "boarded").reduce((n, s) => n + s.seats * r.price_per_seat, 0),
  }));
}

/** Driver enters the rider's 4-digit code at pickup. */
export async function boardSeat(pro, seatId, code) {
  const { data: s } = await supabase.from("carpool_seats").select("*, carpools!inner(provider_id)").eq("id", seatId).maybeSingle();
  if (!s || s.carpools.provider_id !== pro.id) throw new Error("Not your passenger.");
  if (s.status !== "confirmed") throw new Error(s.status === "boarded" ? "Already on board." : "This seat isn't confirmed.");
  if (String(code || "").replace(/\D/g, "") !== rideCode(seatId)) throw new Error("That code doesn't match. Ask the passenger for the code on their WeAid page.");
  await supabase.from("carpool_seats").update({ status: "boarded", boarded_at: new Date().toISOString() }).eq("id", seatId);
  return { ok: true };
}

export async function completeRide(pro, rideId) {
  const { data: r } = await supabase.from("carpools").select("*").eq("id", rideId).eq("provider_id", pro.id).maybeSingle();
  if (!r) throw new Error("Not your ride.");
  if (Date.now() < Date.parse(r.depart_at)) throw new Error("You can finish the trip after it has started.");
  await supabase.from("carpool_seats").update({ status: "no_show" }).eq("carpool_id", rideId).eq("status", "confirmed");
  await supabase.from("carpools").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", rideId);
  const rides = await driverRides(pro);
  const owed = rides.find((x) => x.id === rideId)?.earnings || 0;
  await sendAdminNotification(`[WeAid] 🚗 Carpool done — pay ${pro.name} ₹${owed}`,
    `<p style="font-family:sans-serif">${r.from_address} → ${r.to_address}. Boarded seats earn the driver <b>₹${owed}</b> (booking fees are WeAid's). Pay by UPI to ${pro.phone}, then mark it paid in <a href="${opsLink()}">Ops → Carpool</a>.</p>`).catch(() => {});
  return { ok: true, owed };
}

/** Driver cancels: every paid rider gets everything back. */
export async function cancelRide(pro, rideId, reason) {
  const { data: r } = await supabase.from("carpools").select("*").eq("id", rideId).eq("provider_id", pro.id).maybeSingle();
  if (!r) throw new Error("Not your ride.");
  if (["done", "cancelled"].includes(r.status)) throw new Error("This ride is already closed.");
  const { data: seats } = await supabase.from("carpool_seats").select("*").eq("carpool_id", rideId).in("status", ["confirmed", "pending_payment"]);
  for (const s of seats || []) await refundSeat(s, s.amount, "driver_cancelled");
  await supabase.from("carpools").update({ status: "cancelled", cancel_reason: String(reason || "").slice(0, 200) }).eq("id", rideId);
  await sendAdminNotification(`[WeAid] Carpool cancelled by driver ${pro.name}`, `<p style="font-family:sans-serif">${r.from_address} → ${r.to_address}, ${new Date(r.depart_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. ${(seats || []).length} booking(s) refunded in full. Reason: ${String(reason || "-").replace(/</g, "&lt;")}</p>`).catch(() => {});
  return { ok: true, refunded: (seats || []).length };
}

/* ---------- rider ---------- */

export async function searchRides({ from, to, date }) {
  const a = pt(from), b = pt(to);
  if (!a || !b) throw new Error("Pick where you're starting and going from the suggestions.");
  const day = date ? Date.parse(`${date}T00:00:00+05:30`) : Date.now();
  const startWin = Math.max(Date.now() + 15 * 60e3, day), endWin = (date ? day : Date.now()) + 3 * 86400e3;
  const { data } = await supabase.from("carpools").select("*").eq("status", "open").gt("seats_left", 0)
    .gte("depart_at", new Date(startWin).toISOString()).lte("depart_at", new Date(endWin).toISOString()).order("depart_at").limit(200);
  const out = [];
  for (const r of data || []) {
    const points = [{ name: r.from_address, lat: r.from_lat, lng: r.from_lng }, ...(r.stops || []), { name: r.to_address, lat: r.to_lat, lng: r.to_lng }];
    const pi = points.findIndex((p, i) => i < points.length - 1 && near(a, p, PICKUP_KM));
    const di = points.findIndex((p, i) => i > pi && pi >= 0 && near(b, p, DROP_KM));
    if (pi < 0 || di < 0) continue;
    out.push({
      id: r.id, departAt: r.depart_at, from: r.from_address, to: r.to_address, pickupAt: points[pi].name, dropAt: points[di].name,
      price: r.price_per_seat, fee: r.fee_per_seat, seatsLeft: r.seats_left, car: r.car_model, km: r.distance_km,
      driver: r.driver_name.split(" ")[0], providerId: r.provider_id, notes: r.notes,
    });
  }
  return out.slice(0, 30);
}

export async function bookSeat({ rideId, name, phone, seats, pickup }) {
  const p10 = String(phone || "").replace(/\D/g, "").slice(-10);
  if (!String(name || "").trim() || p10.length !== 10) throw new Error("Add your name and 10-digit mobile.");
  const n = Math.max(1, Math.min(4, Math.round(Number(seats) || 1)));
  const { data: r } = await supabase.from("carpools").select("*").eq("id", rideId).maybeSingle();
  if (!r || r.status !== "open") throw new Error("This ride isn't available any more.");
  if (Date.parse(r.depart_at) < Date.now() + 15 * 60e3) throw new Error("This ride is leaving too soon to book.");
  if (r.seats_left < n) throw new Error(`Only ${r.seats_left} seat(s) left.`);
  // Hold the seats: conditional decrement, so two riders can't take the last seat.
  const { data: held } = await supabase.from("carpools").update({ seats_left: r.seats_left - n, status: r.seats_left - n === 0 ? "full" : "open" })
    .eq("id", rideId).eq("seats_left", r.seats_left).select("id").maybeSingle();
  if (!held) throw new Error("Someone just booked — please try again.");
  const fee = n * r.fee_per_seat, amount = n * r.price_per_seat + fee;
  const { data: s, error } = await supabase.from("carpool_seats").insert({
    carpool_id: rideId, rider_name: String(name).trim().slice(0, 60), rider_phone: `+91${p10}`, seats: n, amount, fee,
    pickup: String(pickup || "").slice(0, 120) || null, status: "pending_payment",
  }).select("*").single();
  if (error) { await releaseSeats(rideId, n); throw new Error(error.message); }
  let pay = null;
  if (razorpayConfigured()) {
    const order = await createOrder(amount, `carpool_${s.id}`.slice(0, 40), { carpool_seat_id: s.id });
    await supabase.from("carpool_seats").update({ razorpay_order_id: order.id }).eq("id", s.id);
    pay = { orderId: order.id, key: razorpayKeyId, amount: order.amount, currency: order.currency };
  } else {
    await sendAdminNotification(`[WeAid] Carpool booking — collect ₹${amount} from ${name} +91${p10}`,
      `<p style="font-family:sans-serif">${r.from_address} → ${r.to_address}, ${new Date(r.depart_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}, ${n} seat(s). Online payment isn't connected yet: collect by UPI, then mark it paid in <a href="${opsLink()}">Ops → Carpool</a>. The seats are held for 30 minutes.</p>`).catch(() => {});
  }
  return { seatId: s.id, link: seatLink(s.id), amount, fee, pay };
}

async function releaseSeats(rideId, n) {
  const { data: r } = await supabase.from("carpools").select("seats_left,seats_total,status").eq("id", rideId).maybeSingle();
  if (!r) return;
  const left = Math.min(r.seats_total, r.seats_left + n);
  await supabase.from("carpools").update({ seats_left: left, status: r.status === "full" ? "open" : r.status }).eq("id", rideId);
}

/** Payment received (Razorpay or owner's "paid" in Ops). */
export async function confirmSeat(seatId, { paymentId, how } = {}) {
  const { data: s } = await supabase.from("carpool_seats").select("*").eq("id", seatId).maybeSingle();
  if (!s) throw new Error("No such booking.");
  if (s.status !== "pending_payment") return s;
  const { data } = await supabase.from("carpool_seats").update({ status: "confirmed", paid_at: new Date().toISOString(), razorpay_payment_id: paymentId || null })
    .eq("id", seatId).eq("status", "pending_payment").select("*").maybeSingle();
  if (data) {
    const { data: r } = await supabase.from("carpools").select("provider_id,from_address,to_address,depart_at").eq("id", s.carpool_id).maybeSingle();
    if (r?.provider_id) pushToProvider(r.provider_id, { title: "New carpool passenger", body: `${s.rider_name} booked ${s.seats} seat(s) — ${r.from_address} → ${r.to_address}`, data: { type: "carpool", rideId: s.carpool_id }, channel: "default" }).catch(() => {});
  }
  return data || s;
}

/** Unpaid holds older than 30 minutes give their seats back. */
export async function expireHolds() {
  const cutoff = new Date(Date.now() - 30 * 60e3).toISOString();
  const { data } = await supabase.from("carpool_seats").select("id,carpool_id,seats").eq("status", "pending_payment").lt("created_at", cutoff).limit(50);
  for (const s of data || []) {
    const { data: x } = await supabase.from("carpool_seats").update({ status: "cancelled" }).eq("id", s.id).eq("status", "pending_payment").select("id").maybeSingle();
    if (x) await releaseSeats(s.carpool_id, s.seats);
  }
}

async function refundSeat(s, amount, why) {
  const amt = Math.max(0, Math.min(s.amount, Math.round(amount)));
  if (s.status === "pending_payment") {
    await supabase.from("carpool_seats").update({ status: "cancelled" }).eq("id", s.id);
    return { amount: 0, mode: "none" };
  }
  let mode = "manual";
  if (amt > 0 && s.razorpay_payment_id && razorpayConfigured()) {
    await processRefund(s.razorpay_payment_id, amt, { carpool_seat_id: s.id, reason: why });
    mode = "razorpay";
  } else if (amt > 0) {
    await sendAdminNotification(`[WeAid] 💸 Carpool refund — send ₹${amt} to ${s.rider_name} ${s.rider_phone}`, `<p style="font-family:sans-serif">Paid outside Razorpay, so send it by UPI. Reason: ${why}.</p>`).catch(() => {});
  }
  await supabase.from("carpool_seats").update({ status: amt > 0 ? "refunded" : "cancelled", refund_amount: amt, refunded_at: amt > 0 ? new Date().toISOString() : null }).eq("id", s.id);
  return { amount: amt, mode };
}

export function riderCancelQuote(s, ride) {
  if (!["confirmed", "pending_payment"].includes(s.status)) return { allowed: false, reason: "This booking can't be cancelled." };
  if (s.status === "pending_payment") return { allowed: true, refund: 0, words: "Nothing has been paid yet." };
  const early = Date.parse(ride.depart_at) - Date.now() > 2 * 3600e3;
  const refund = early ? s.amount - s.fee : 0;
  return { allowed: true, refund, words: early ? `You'll get ₹${refund} back (the ₹${s.fee} booking fee isn't refundable).` : "The ride leaves in less than 2 hours, so there's no refund." };
}

export async function riderCancel(seatId) {
  const { data: s } = await supabase.from("carpool_seats").select("*").eq("id", seatId).maybeSingle();
  const { data: ride } = s ? await supabase.from("carpools").select("*").eq("id", s.carpool_id).maybeSingle() : { data: null };
  if (!s || !ride) throw new Error("No such booking.");
  const q = riderCancelQuote(s, ride);
  if (!q.allowed) throw new Error(q.reason);
  const r = await refundSeat(s, q.refund, "rider_cancelled");
  await releaseSeats(ride.id, s.seats);
  return { ok: true, refund: r.amount, mode: r.mode };
}

export async function seatView(seatId) {
  const { data: s } = await supabase.from("carpool_seats").select("*").eq("id", seatId).maybeSingle();
  if (!s) return null;
  const { data: r } = await supabase.from("carpools").select("*").eq("id", s.carpool_id).maybeSingle();
  const paid = ["confirmed", "boarded"].includes(s.status);
  return {
    status: s.status, seats: s.seats, amount: s.amount, fee: s.fee, pickup: s.pickup,
    code: s.status === "confirmed" ? rideCode(s.id) : null,
    ride: r && {
      from: r.from_address, to: r.to_address, departAt: r.depart_at, status: r.status, km: r.distance_km,
      car: paid ? `${r.car_model} · ${r.car_number}` : r.car_model,
      driver: paid ? { name: r.driver_name, phone: r.driver_phone, providerId: r.provider_id } : { name: r.driver_name.split(" ")[0] },
      stops: r.stops || [],
    },
    cancel: r ? riderCancelQuote(s, r) : { allowed: false },
  };
}

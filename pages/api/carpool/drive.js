/**
 * Carpool — drivers (X-Pro-Token = their WeAid Pro login). Hidden until launch.
 *   GET                                   my rides + passengers
 *   POST { action: "create", from, to, departAt, seats, carModel, carNumber, stops, notes }
 *   POST { action: "quote", from, to }    price per seat before posting
 *   POST { action: "board", seatId, code }
 *   POST { action: "complete", rideId }
 *   POST { action: "cancel", rideId, reason }
 */
import { supabase } from "../../../lib/supabase.js";
import { createRide, driverRides, boardSeat, completeRide, cancelRide, seatPrice, FEE_PER_SEAT } from "../../../lib/carpool.js";
import { roadDistanceKm, haversineKm } from "../../../lib/geo.js";

async function me(req) {
  const t = String(req.headers["x-pro-token"] || "");
  if (t.length < 16) return null;
  const { data } = await supabase.from("providers").select("id,name,phone,verified,services").eq("edit_token", t).is("removed_at", null).maybeSingle();
  return data || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pro-Token");
  if (req.method === "OPTIONS") return res.status(204).end();
  const pro = await me(req);
  if (!pro) return res.status(401).json({ error: "Please log in to WeAid Pro again." });
  try {
    if (req.method === "GET") return res.status(200).json({ me: { name: pro.name, verified: Boolean(pro.verified) }, rides: await driverRides(pro) });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.action === "quote") {
      const f = b.from, t = b.to;
      if (!f?.lat || !t?.lat) return res.status(400).json({ error: "Pick both places." });
      const km = (await roadDistanceKm(f.lat, f.lng, t.lat, t.lng)) || haversineKm(f.lat, f.lng, t.lat, t.lng) * 1.3;
      return res.status(200).json({ km: Math.round(km), price: seatPrice(km), fee: FEE_PER_SEAT });
    }
    if (b.action === "create") return res.status(200).json({ ride: await createRide(pro, b) });
    if (b.action === "board") return res.status(200).json(await boardSeat(pro, b.seatId, b.code));
    if (b.action === "complete") return res.status(200).json(await completeRide(pro, b.rideId));
    if (b.action === "cancel") return res.status(200).json(await cancelRide(pro, b.rideId, b.reason));
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

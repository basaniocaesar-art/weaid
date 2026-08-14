import { calculateFare } from "../../../lib/pricing.js";
import { insertTrip, getAvailableDriversByType } from "../../../lib/supabase.js";
import { notifyDriverNewTrip } from "../../../lib/whatsapp.js";
import { roadDistanceKm, haversineKm } from "../../../lib/geo.js";

const otp = () => String(Math.floor(1000 + Math.random() * 9000));

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { type = "ride", vehicle = "car", pickup, drop, itemDescription, customer } = req.body;
    if (!pickup?.lat || !drop?.lat || !customer?.name || !customer?.phone) {
      return res.status(400).json({ error: "Missing pickup, drop, or customer details" });
    }

    const dist = await roadDistanceKm(pickup.lat, pickup.lng, drop.lat, drop.lng);
    const v = type === "courier" ? "courier" : vehicle;
    const fare = calculateFare({ vehicle: v, distanceKm: dist });

    const trip = await insertTrip({
      type,
      vehicle: v,
      pickup_address: pickup.address || null,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_address: drop.address || null,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
      distance_km: fare.distanceKm,
      fare: fare.total,
      commission: fare.commission,
      provider_earnings: fare.providerEarnings,
      item_description: type === "courier" ? itemDescription || null : null,
      customer_name: customer.name,
      customer_phone: customer.phone,
      status: "searching",
      pickup_token: type === "courier" ? otp() : null,
      delivery_token: type === "courier" ? otp() : null,
    });

    // Dispatch: notify available drivers offering this trip type, nearest first.
    const drivers = await getAvailableDriversByType(type).catch(() => []);
    drivers
      .map((d) => ({ d, dist: d.lat != null && d.lng != null ? haversineKm(pickup.lat, pickup.lng, d.lat, d.lng) : Infinity }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 15)
      .forEach(({ d }) => notifyDriverNewTrip(d.phone, trip).catch(() => {}));

    return res.status(201).json({ tripId: trip.id, fare: fare.total, distanceKm: fare.distanceKm });
  } catch (err) {
    console.error("[trip/create]", err);
    return res.status(500).json({ error: err.message });
  }
}

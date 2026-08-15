import {
  getDispatchableTrips, getDriverActiveTrips,
  acceptTripIfOpen, getTrip, updateTrip, upsertDriverLocation,
} from "../../../lib/supabase.js";
import { resolveProvider } from "../../../lib/auth.js";
import { createMaskedCall } from "../../../lib/masking.js";
import { notifyCustomerProviderAssigned } from "../../../lib/whatsapp.js";

const DRIVE_TYPES = ["ride", "courier"];

function shape(t, reveal) {
  const base = {
    id: t.id, type: t.type, vehicle: t.vehicle, status: t.status,
    pickup_address: t.pickup_address, pickup_lat: t.pickup_lat, pickup_lng: t.pickup_lng,
    drop_address: t.drop_address, drop_lat: t.drop_lat, drop_lng: t.drop_lng,
    distance_km: t.distance_km, fare: t.fare, provider_earnings: t.provider_earnings,
    item_description: t.item_description, created_at: t.created_at,
  };
  if (reveal) {
    base.customer_name = t.customer_name;
    base.customer_contact = t.mask_number || t.customer_phone;
    base.needs_pickup_token = t.type === "courier" && !t.pickup_verified;
    base.needs_delivery_token = t.type === "courier" && !t.delivery_verified;
  }
  return base;
}

export default async function handler(req, res) {
  try {
    const provider = await resolveProvider(req);
    if (!provider) return res.status(401).json({ error: "Sign in to view rides" });
    const types = (provider.services || []).filter((s) => DRIVE_TYPES.includes(s));

    if (req.method === "GET") {
      const [incoming, active] = await Promise.all([
        getDispatchableTrips(types),
        getDriverActiveTrips(provider.id),
      ]);
      return res.status(200).json({
        driving: types.length > 0,
        incoming: incoming.map((t) => shape(t, false)),
        active: active.map((t) => shape(t, true)),
      });
    }

    if (req.method === "POST") {
      const { action } = req.body;

      if (action === "location") {
        const { lat, lng, tripId } = req.body;
        if (lat == null || lng == null) return res.status(400).json({ error: "Missing lat/lng" });
        await upsertDriverLocation(provider.id, { lat, lng, tripId });
        return res.status(200).json({ ok: true });
      }

      const { tripId } = req.body;
      if (!tripId) return res.status(400).json({ error: "Missing tripId" });

      if (action === "accept") {
        const trip = await acceptTripIfOpen(tripId, { driverId: provider.id, driverName: provider.name, driverPhone: provider.phone });
        if (!trip) return res.status(409).json({ error: "Already taken", alreadyTaken: true });
        // Mask the driver <-> customer line
        const masked = await createMaskedCall({ customerPhone: trip.customer_phone, providerPhone: provider.phone, bookingId: trip.id }).catch(() => null);
        if (masked?.proxyNumber) await updateTrip(trip.id, { mask_number: masked.proxyNumber });
        await notifyCustomerProviderAssigned(trip.customer_phone, { ...trip, service: trip.type, mask_number: masked?.proxyNumber }, { name: provider.name }).catch(() => {});
        return res.status(200).json({ ok: true, status: "accepted" });
      }

      const trip = await getTrip(tripId);
      if (!trip || trip.driver_id !== provider.id) return res.status(403).json({ error: "Not your trip" });

      if (action === "status") {
        const { status } = req.body;
        const allowed = ["arrived", "picked_up", "in_transit", "completed"];
        if (!allowed.includes(status)) return res.status(400).json({ error: "Bad status" });
        // Courier gates: can't pick up / complete without the token verified
        if (trip.type === "courier" && status === "picked_up" && !trip.pickup_verified) return res.status(400).json({ error: "Verify pickup token first" });
        if (trip.type === "courier" && status === "completed" && !trip.delivery_verified) return res.status(400).json({ error: "Verify delivery token first" });
        const patch = { status };
        if (status === "completed") patch.completed_at = new Date().toISOString();
        await updateTrip(tripId, patch);
        return res.status(200).json({ ok: true, status });
      }

      if (action === "verify") {
        const { stage, code } = req.body; // stage: 'pickup' | 'delivery'
        const expected = stage === "delivery" ? trip.delivery_token : trip.pickup_token;
        if (!code || String(code) !== String(expected)) return res.status(400).json({ error: "Wrong code" });
        const patch = stage === "delivery"
          ? { delivery_verified: true, status: "completed", completed_at: new Date().toISOString() }
          : { pickup_verified: true, status: "picked_up" };
        await updateTrip(tripId, patch);
        return res.status(200).json({ ok: true, verified: stage });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[provider/trips]", err);
    return res.status(500).json({ error: err.message });
  }
}

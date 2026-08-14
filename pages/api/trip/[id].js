import { getTrip, getDriverLocation } from "../../../lib/supabase.js";

// Customer polls this to track the trip. Returns status + (once accepted) the
// driver's live position. Real number is masked; only the masked line is shared.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { id } = req.query;
    const t = await getTrip(id);
    if (!t) return res.status(404).json({ error: "Trip not found" });

    let driverLoc = null;
    if (t.driver_id && ["accepted", "arrived", "picked_up", "in_transit"].includes(t.status)) {
      const dl = await getDriverLocation(t.driver_id).catch(() => null);
      if (dl && dl.lat != null) driverLoc = { lat: dl.lat, lng: dl.lng, updated_at: dl.updated_at };
    }

    return res.status(200).json({
      trip: {
        id: t.id,
        type: t.type,
        vehicle: t.vehicle,
        status: t.status,
        pickup: { address: t.pickup_address, lat: t.pickup_lat, lng: t.pickup_lng },
        drop: { address: t.drop_address, lat: t.drop_lat, lng: t.drop_lng },
        distance_km: t.distance_km,
        fare: t.fare,
        item_description: t.item_description,
        driver_name: t.driver_name,
        // masked line if set, else the driver's number (so the rider can call)
        driver_contact: t.mask_number || t.driver_phone,
        // courier tokens shown to the CUSTOMER so they can hand them to the driver
        pickup_token: t.type === "courier" ? t.pickup_token : null,
        delivery_token: t.type === "courier" ? t.delivery_token : null,
        pickup_verified: t.pickup_verified,
        delivery_verified: t.delivery_verified,
      },
      driverLocation: driverLoc,
    });
  } catch (err) {
    console.error("[trip/[id]]", err);
    return res.status(500).json({ error: err.message });
  }
}

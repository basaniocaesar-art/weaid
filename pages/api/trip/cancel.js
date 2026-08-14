import { getTrip, updateTrip } from "../../../lib/supabase.js";

// Customer cancels a trip (before pickup). v1: possession of the trip id gates it.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { tripId } = req.body;
    if (!tripId) return res.status(400).json({ error: "Missing tripId" });
    const t = await getTrip(tripId);
    if (!t) return res.status(404).json({ error: "Trip not found" });
    if (["completed", "cancelled", "picked_up", "in_transit"].includes(t.status)) {
      return res.status(400).json({ error: "This trip can no longer be cancelled" });
    }
    await updateTrip(tripId, { status: "cancelled" });
    return res.status(200).json({ ok: true, status: "cancelled" });
  } catch (err) {
    console.error("[trip/cancel]", err);
    return res.status(500).json({ error: err.message });
  }
}

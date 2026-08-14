import { getTrip, insertReview, recomputeProviderRating } from "../../../lib/supabase.js";

// Rider rates the driver after a completed trip. Maps trip -> driver so the
// driver_id is never exposed to the client.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { tripId, rating, comment } = req.body;
    const r = Number(rating);
    if (!tripId || !(r >= 1 && r <= 5)) return res.status(400).json({ error: "Missing tripId or rating (1-5)" });
    const t = await getTrip(tripId);
    if (!t || !t.driver_id) return res.status(404).json({ error: "Trip or driver not found" });
    if (t.status !== "completed") return res.status(400).json({ error: "Trip not completed yet" });

    await insertReview({
      provider_id: t.driver_id,
      customer_name: t.customer_name || "Rider",
      customer_phone: t.customer_phone || null,
      rating: r,
      comment: comment || null,
    });
    await recomputeProviderRating(t.driver_id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[trip/rate]", err);
    return res.status(500).json({ error: err.message });
  }
}

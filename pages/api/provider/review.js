import { insertReview, getReviewsByProvider, recomputeProviderRating } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { providerId } = req.query;
      if (!providerId) return res.status(400).json({ error: "Missing providerId" });
      const reviews = await getReviewsByProvider(providerId);
      return res.status(200).json({ reviews });
    }

    if (req.method === "POST") {
      const { providerId, customerName, customerPhone, rating, comment } = req.body;
      if (!providerId || !customerName || !rating) {
        return res.status(400).json({ error: "Missing providerId, customerName, or rating" });
      }
      const r = Number(rating);
      if (!(r >= 1 && r <= 5)) return res.status(400).json({ error: "Rating must be 1-5" });

      await insertReview({
        provider_id: providerId,
        customer_name: customerName,
        customer_phone: customerPhone || null,
        rating: r,
        comment: comment || null,
      });
      const stats = await recomputeProviderRating(providerId);
      return res.status(201).json({ ok: true, ...stats });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[provider/review]", err);
    return res.status(500).json({ error: err.message });
  }
}

import { getProviderBySlug, getReviewsByProvider } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: "Missing slug" });

    const p = await getProviderBySlug(slug);
    if (!p) return res.status(404).json({ error: "Provider not found" });

    const reviews = await getReviewsByProvider(p.id, 20);

    return res.status(200).json({
      provider: {
        id: p.id,
        slug: p.slug,
        name: p.name,
        city: p.city,
        areas: p.areas || [],
        services: p.services || [],
        bio: p.bio,
        photo_url: p.photo_url,
        years_experience: p.years_experience,
        verified: p.verified,
        available: p.available,
        rating: p.rating,
        review_count: p.review_count,
        phone: p.phone,
        whatsapp: p.whatsapp || p.phone,
        lat: p.lat,
        lng: p.lng,
        featured: p.featured && (!p.featured_until || new Date(p.featured_until) > new Date()),
      },
      reviews,
    });
  } catch (err) {
    console.error("[providers/[slug]]", err);
    return res.status(500).json({ error: err.message });
  }
}

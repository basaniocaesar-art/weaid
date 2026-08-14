import { getFoodProviders } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const list = await getFoodProviders(req.query.city);
    const now = Date.now();
    const providers = list
      .map((p) => ({
        id: p.id, slug: p.slug, name: p.name, city: p.city,
        homefood: (p.services || []).includes("homefood"),
        bio: p.bio, photo_url: p.photo_url, rating: p.rating, review_count: p.review_count,
        verified: p.verified,
        featured: p.featured && (!p.featured_until || new Date(p.featured_until).getTime() > now),
      }))
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (b.rating || 0) - (a.rating || 0));
    return res.status(200).json({ count: providers.length, providers });
  } catch (err) {
    console.error("[food/providers]", err);
    return res.status(500).json({ error: err.message });
  }
}

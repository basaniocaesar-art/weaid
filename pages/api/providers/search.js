import { searchProviders } from "../../../lib/supabase.js";

// Front-of-search ranking tiers (higher = shown first):
//   3 = Featured (paid, still active)
//   2 = New signup inside free boost window
//   1 = Everyone else
// Within a tier: newest signup first, then higher rating.
function rankTier(p, now) {
  const featuredActive =
    p.featured && (!p.featured_until || new Date(p.featured_until).getTime() > now);
  if (featuredActive) return 3;
  const boosted = p.listing_boost_until && new Date(p.listing_boost_until).getTime() > now;
  if (boosted) return 2;
  return 1;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { q, service, city } = req.query;

    const providers = await searchProviders({ service, city, q });
    const now = Date.now();

    const ranked = providers
      .map((p) => ({ p, tier: rankTier(p, now) }))
      .sort((a, b) => {
        if (b.tier !== a.tier) return b.tier - a.tier;
        const at = new Date(a.p.created_at).getTime();
        const bt = new Date(b.p.created_at).getTime();
        if (bt !== at) return bt - at; // newest first
        return (b.p.rating || 0) - (a.p.rating || 0);
      })
      .map(({ p, tier }) => ({
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
        rating: p.rating,
        review_count: p.review_count,
        phone: p.phone,
        whatsapp: p.whatsapp || p.phone,
        featured: tier === 3,
        isNew: tier === 2,
      }));

    return res.status(200).json({ count: ranked.length, providers: ranked });
  } catch (err) {
    console.error("[providers/search]", err);
    return res.status(500).json({ error: err.message });
  }
}

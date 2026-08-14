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

// Haversine distance in km between two lat/lng points.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { q, service, city, lat, lng } = req.query;
    const uLat = lat != null && lat !== "" ? Number(lat) : null;
    const uLng = lng != null && lng !== "" ? Number(lng) : null;
    const hasLoc = uLat != null && uLng != null && !Number.isNaN(uLat) && !Number.isNaN(uLng);

    const providers = await searchProviders({ service, city, q });
    const now = Date.now();

    const ranked = providers
      .map((p) => {
        const dist =
          hasLoc && p.lat != null && p.lng != null ? distanceKm(uLat, uLng, p.lat, p.lng) : null;
        return { p, tier: rankTier(p, now), dist };
      })
      .sort((a, b) => {
        if (b.tier !== a.tier) return b.tier - a.tier;
        // With a customer location, sort each tier by nearest first
        // (pros with a known location rank ahead of those without).
        if (hasLoc) {
          const ad = a.dist == null ? Infinity : a.dist;
          const bd = b.dist == null ? Infinity : b.dist;
          if (ad !== bd) return ad - bd;
        }
        const at = new Date(a.p.created_at).getTime();
        const bt = new Date(b.p.created_at).getTime();
        if (bt !== at) return bt - at; // newest first
        return (b.p.rating || 0) - (a.p.rating || 0);
      })
      .map(({ p, tier, dist }) => ({
        distanceKm: dist,
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

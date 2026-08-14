import { getProviderByEditToken, updateProvider, getLeadsByProvider } from "../../../lib/supabase.js";

// Token-gated: the provider's private manage link carries their edit_token.
const EDITABLE = ["name", "phone", "whatsapp", "email", "city", "areas", "services", "bio", "photo_url", "years_experience", "available", "lat", "lng"];

export default async function handler(req, res) {
  try {
    const token = req.query.token || req.body?.token;
    if (!token) return res.status(401).json({ error: "Missing manage token" });

    const provider = await getProviderByEditToken(token);
    if (!provider) return res.status(404).json({ error: "Listing not found" });

    if (req.method === "GET") {
      const leads = await getLeadsByProvider(provider.id, 100);
      const now = Date.now();
      return res.status(200).json({
        provider: {
          id: provider.id,
          slug: provider.slug,
          name: provider.name,
          phone: provider.phone,
          whatsapp: provider.whatsapp,
          email: provider.email,
          city: provider.city,
          areas: provider.areas || [],
          services: provider.services || [],
          bio: provider.bio,
          photo_url: provider.photo_url,
          years_experience: provider.years_experience,
          available: provider.available,
          verified: provider.verified,
          rating: provider.rating,
          review_count: provider.review_count,
          plan_tier: provider.plan_tier,
          featured: provider.featured && (!provider.featured_until || new Date(provider.featured_until).getTime() > now),
          featured_until: provider.featured_until,
          boosted: provider.listing_boost_until && new Date(provider.listing_boost_until).getTime() > now,
          listing_boost_until: provider.listing_boost_until,
        },
        leads,
        stats: {
          leads_total: leads.length,
          leads_7d: leads.filter((l) => now - new Date(l.created_at).getTime() < 7 * 864e5).length,
        },
      });
    }

    if (req.method === "POST") {
      const updates = {};
      for (const k of EDITABLE) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      if (!Object.keys(updates).length) return res.status(400).json({ error: "No editable fields provided" });
      const updated = await updateProvider(provider.id, updates);
      return res.status(200).json({ ok: true, provider: { id: updated.id, available: updated.available } });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[provider/manage]", err);
    return res.status(500).json({ error: err.message });
  }
}

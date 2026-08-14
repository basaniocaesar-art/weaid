import { getSessionProvider } from "../../../lib/auth.js";
import { updateProvider } from "../../../lib/supabase.js";

// The logged-in provider views/edits their OWN listing (resolved by user_id).
const EDITABLE = ["name", "phone", "whatsapp", "email", "city", "areas", "services", "bio", "photo_url", "years_experience", "available", "team_size"];

export default async function handler(req, res) {
  try {
    const { user, provider } = await getSessionProvider(req);
    if (!user) return res.status(401).json({ error: "Not signed in" });

    if (req.method === "GET") {
      if (!provider) return res.status(200).json({ hasListing: false, provider: null });
      return res.status(200).json({
        hasListing: true,
        provider: {
          id: provider.id, slug: provider.slug, name: provider.name, phone: provider.phone,
          whatsapp: provider.whatsapp, email: provider.email, city: provider.city,
          areas: provider.areas || [], services: provider.services || [], bio: provider.bio,
          photo_url: provider.photo_url, years_experience: provider.years_experience,
          available: provider.available, team_size: provider.team_size,
          verified: provider.verified, kyc_status: provider.kyc_status || "none",
          rating: provider.rating, review_count: provider.review_count,
        },
      });
    }

    if (req.method === "POST") {
      if (!provider) return res.status(400).json({ error: "No listing found. Create your listing first." });
      const updates = {};
      for (const k of EDITABLE) if (req.body[k] !== undefined) updates[k] = req.body[k];
      if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update." });
      const updated = await updateProvider(provider.id, updates);
      return res.status(200).json({ ok: true, provider: { id: updated.id } });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[provider/self]", err);
    return res.status(500).json({ error: err.message });
  }
}

import { insertProvider, slugExists } from "../../../lib/supabase.js";

// Free 30-day "new signup" front-of-search boost window
const BOOST_DAYS = 30;

function baseSlug(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "provider";
}

async function uniqueSlug(name) {
  const base = baseSlug(name);
  let slug = base;
  let n = 1;
  // Try base, then base-2, base-3, ... until free
  while (await slugExists(slug)) {
    n += 1;
    slug = `${base}-${n}`;
    if (n > 50) {
      slug = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }
  return slug;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      name,
      phone,
      whatsapp,
      email,
      city,
      areas,
      services,
      bio,
      photoUrl,
      yearsExperience,
      lat,
      lng,
      userId,
    } = req.body;

    if (!name || !phone || !city || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        error: "Missing required fields: name, phone, city, and at least one service",
      });
    }

    const slug = await uniqueSlug(name);
    const boostUntil = new Date(Date.now() + BOOST_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const provider = await insertProvider({
      user_id: userId || null,
      name,
      slug,
      phone,
      whatsapp: whatsapp || phone,
      email: email || null,
      city,
      areas: Array.isArray(areas) ? areas : [],
      services,
      bio: bio || null,
      photo_url: photoUrl || null,
      years_experience: yearsExperience != null ? Number(yearsExperience) : null,
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      available: true,
      verified: false,
      featured: false,
      plan_tier: "free",
      source: "signup",
      claimed: true,
      // New signups ride the top of search for 30 days, free.
      listing_boost_until: boostUntil,
    });

    return res.status(201).json({
      id: provider.id,
      slug: provider.slug,
      listingUrl: `/p/${provider.slug}`,
      manageUrl: `/dashboard-pro?t=${provider.edit_token}`,
      editToken: provider.edit_token,
      boostedUntil: boostUntil,
    });
  } catch (err) {
    console.error("[provider/register]", err);
    return res.status(500).json({ error: err.message });
  }
}

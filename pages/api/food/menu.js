import { getProviderBySlug, getProviderById, listMenuItems } from "../../../lib/supabase.js";

// Public menu for a food provider (by slug or id).
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { slug, id } = req.query;
    const provider = slug ? await getProviderBySlug(slug) : id ? await getProviderById(id) : null;
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    const items = (await listMenuItems(provider.id, true)).map((i) => ({
      id: i.id, name: i.name, description: i.description, price: i.price, veg: i.veg, photo_url: i.photo_url,
    }));
    return res.status(200).json({
      provider: { id: provider.id, slug: provider.slug, name: provider.name, city: provider.city, rating: provider.rating, review_count: provider.review_count, homefood: (provider.services || []).includes("homefood") },
      items,
    });
  } catch (err) {
    console.error("[food/menu]", err);
    return res.status(500).json({ error: err.message });
  }
}

import { getProviderByEditToken, insertMenuItem, listMenuItems, updateMenuItem, deleteMenuItem } from "../../lib/supabase.js";

// Token-gated menu management for a food provider.
export default async function handler(req, res) {
  try {
    const token = req.query.token || req.body?.token;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const provider = await getProviderByEditToken(token);
    if (!provider) return res.status(404).json({ error: "Not found" });

    if (req.method === "GET") {
      return res.status(200).json({ items: await listMenuItems(provider.id) });
    }
    if (req.method === "POST") {
      const { id, name, description, price, veg, available } = req.body;
      if (id) {
        const updated = await updateMenuItem(id, provider.id, {
          ...(name != null ? { name } : {}),
          ...(description != null ? { description } : {}),
          ...(price != null ? { price: Number(price) } : {}),
          ...(veg != null ? { veg: !!veg } : {}),
          ...(available != null ? { available: !!available } : {}),
        });
        return res.status(200).json({ item: updated });
      }
      if (!name || price == null) return res.status(400).json({ error: "Missing name or price" });
      const item = await insertMenuItem({ provider_id: provider.id, name, description: description || null, price: Number(price), veg: veg !== false, available: true });
      return res.status(201).json({ item });
    }
    if (req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteMenuItem(id, provider.id);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[menu]", err);
    return res.status(500).json({ error: err.message });
  }
}

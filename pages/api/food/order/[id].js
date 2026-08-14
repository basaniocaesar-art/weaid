import { getFoodOrder } from "../../../../lib/supabase.js";

// Customer polls to track their food order.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const o = await getFoodOrder(req.query.id);
    if (!o) return res.status(404).json({ error: "Order not found" });
    return res.status(200).json({
      order: {
        id: o.id, provider_name: o.provider_name, status: o.status,
        items: o.items, subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total,
        created_at: o.created_at,
      },
    });
  } catch (err) {
    console.error("[food/order/[id]]", err);
    return res.status(500).json({ error: err.message });
  }
}

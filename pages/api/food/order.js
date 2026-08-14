import { getProviderById, insertFoodOrder } from "../../../lib/supabase.js";
import { sendMessage } from "../../../lib/whatsapp.js";

const DELIVERY_FEE = 30;
const COMMISSION_RATE = 0.18;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { providerId, items, customer, address, addressLat, addressLng } = req.body;
    if (!providerId || !Array.isArray(items) || !items.length || !customer?.name || !customer?.phone) {
      return res.status(400).json({ error: "Missing provider, items, or customer" });
    }
    const provider = await getProviderById(providerId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const clean = items.map((i) => ({ id: i.id, name: i.name, price: Number(i.price), qty: Math.max(1, Number(i.qty) || 1) }));
    const subtotal = clean.reduce((s, i) => s + i.price * i.qty, 0);
    const total = subtotal + DELIVERY_FEE;
    const commission = Math.round(subtotal * COMMISSION_RATE);

    const order = await insertFoodOrder({
      provider_id: providerId,
      provider_name: provider.name,
      customer_name: customer.name,
      customer_phone: customer.phone,
      address: address || null,
      address_lat: addressLat != null ? Number(addressLat) : null,
      address_lng: addressLng != null ? Number(addressLng) : null,
      items: clean,
      subtotal,
      delivery_fee: DELIVERY_FEE,
      total,
      commission,
      status: "placed",
    });

    const summary = clean.map((i) => `${i.qty}× ${i.name}`).join(", ");
    await sendMessage(provider.phone, `🍽️ New order! ${summary}. ₹${subtotal}. Accept in your dashboard.`).catch(() => {});

    return res.status(201).json({ orderId: order.id, total });
  } catch (err) {
    console.error("[food/order]", err);
    return res.status(500).json({ error: err.message });
  }
}

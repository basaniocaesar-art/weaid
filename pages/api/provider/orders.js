import {
  getFoodOrdersForProvider, getFoodOrder, updateFoodOrder,
  insertTrip, getAvailableDriversByType,
} from "../../../lib/supabase.js";
import { resolveProvider } from "../../../lib/auth.js";
import { notifyDriverNewTrip, sendMessage } from "../../../lib/whatsapp.js";

const otp = () => String(Math.floor(1000 + Math.random() * 9000));
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  try {
    const provider = await resolveProvider(req);
    if (!provider) return res.status(401).json({ error: "Sign in to view orders" });
    const isFood = (provider.services || []).some((s) => s === "food" || s === "homefood");

    if (req.method === "GET") {
      if (!isFood) return res.status(200).json({ isFood: false, orders: [] });
      const orders = await getFoodOrdersForProvider(provider.id, true);
      return res.status(200).json({ isFood: true, orders });
    }

    if (req.method === "POST") {
      const { orderId, status } = req.body;
      if (!orderId || !status) return res.status(400).json({ error: "Missing orderId or status" });
      const order = await getFoodOrder(orderId);
      if (!order || order.provider_id !== provider.id) return res.status(403).json({ error: "Not your order" });

      // When food is READY, create a courier delivery trip and dispatch a driver.
      if (status === "ready") {
        const dist = order.address_lat && provider.lat ? distanceKm(provider.lat, provider.lng, order.address_lat, order.address_lng) : 3;
        const deliveryToken = otp();
        const trip = await insertTrip({
          type: "courier", vehicle: "courier",
          pickup_address: `${provider.name} (kitchen)`, pickup_lat: provider.lat, pickup_lng: provider.lng,
          drop_address: order.address, drop_lat: order.address_lat, drop_lng: order.address_lng,
          distance_km: Math.round(dist * 10) / 10,
          fare: order.delivery_fee, commission: 0, provider_earnings: order.delivery_fee,
          item_description: `Food order from ${provider.name}`,
          customer_name: order.customer_name, customer_phone: order.customer_phone,
          status: "searching", pickup_token: otp(), delivery_token: deliveryToken,
        });
        await updateFoodOrder(orderId, { status: "out_for_delivery", trip_id: trip.id });
        const drivers = await getAvailableDriversByType("courier").catch(() => []);
        drivers.slice(0, 15).forEach((d) => notifyDriverNewTrip(d.phone, trip).catch(() => {}));
        await sendMessage(order.customer_phone, `🛵 Your order from ${provider.name} is on the way! Delivery code: ${deliveryToken}`).catch(() => {});
        return res.status(200).json({ ok: true, status: "out_for_delivery", tripId: trip.id });
      }

      const allowed = ["accepted", "preparing", "delivered", "cancelled"];
      if (!allowed.includes(status)) return res.status(400).json({ error: "Bad status" });
      await updateFoodOrder(orderId, { status });
      return res.status(200).json({ ok: true, status });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[provider/orders]", err);
    return res.status(500).json({ error: err.message });
  }
}

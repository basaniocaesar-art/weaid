import { createBooking, confirmPayment } from "../../../lib/orchestrator.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { service, city, scope, slot, customer } = req.body;

    if (!service || !city || !scope || !customer) {
      return res.status(400).json({ error: "Missing required fields: service, city, scope, customer" });
    }

    const result = await createBooking({ service, city, scope, slot, customer });

    return res.status(201).json({
      bookingId: result.booking.id,
      orderId: result.order.id,
      amount: result.price.total,
      breakdown: result.price,
    });
  } catch (err) {
    console.error("[booking/create]", err);
    return res.status(500).json({ error: err.message });
  }
}

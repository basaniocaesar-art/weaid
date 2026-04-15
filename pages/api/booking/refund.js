import { refundBooking } from "../../../lib/orchestrator.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bookingId, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: "Missing bookingId" });
    }

    const result = await refundBooking(bookingId, reason || "Customer requested refund");

    return res.status(200).json({
      bookingId: result.booking.id,
      refundId: result.refund.id,
      status: "refunded",
    });
  } catch (err) {
    console.error("[booking/refund]", err);
    return res.status(500).json({ error: err.message });
  }
}

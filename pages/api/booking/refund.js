import { getBooking, updateBooking } from "../../../lib/supabase.js";
import { processRefund as razorpayRefund } from "../../../lib/razorpay.js";
import { processRefund as stripeRefund } from "../../../lib/stripe.js";
import { sendRefundConfirmation } from "../../../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bookingId, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: "Missing bookingId" });
    }

    const booking = await getBooking(bookingId);

    let refund;

    if (booking.payment_gateway === "stripe" && booking.stripe_payment_intent) {
      refund = await stripeRefund(booking.stripe_payment_intent, booking.total);
    } else if (booking.razorpay_payment_id) {
      refund = await razorpayRefund(booking.razorpay_payment_id, booking.total, { reason });
    } else {
      return res.status(400).json({ error: "No payment found to refund" });
    }

    const updated = await updateBooking(bookingId, {
      status: "refunded",
      refund_id: refund.id,
      refund_reason: reason || "Customer requested refund",
      refunded_at: new Date().toISOString(),
    });

    await sendRefundConfirmation(booking.customer_email, updated, booking.total);

    return res.status(200).json({
      bookingId: updated.id,
      refundId: refund.id,
      status: "refunded",
    });
  } catch (err) {
    console.error("[booking/refund]", err);
    return res.status(500).json({ error: err.message });
  }
}

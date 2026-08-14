import { verifySignature } from "../../../lib/razorpay.js";
import { confirmPayment } from "../../../lib/orchestrator.js";

// Client-side confirmation after the Razorpay checkout succeeds. Verifies the
// signature server-side, then fulfils the booking (marks paid + dispatches to
// providers). The webhook does the same as a backstop if the browser closes.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing payment details" });
    }
    if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: "Payment could not be verified" });
    }
    await confirmPayment({
      bookingId,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[booking/verify-razorpay]", err);
    return res.status(500).json({ error: err.message });
  }
}

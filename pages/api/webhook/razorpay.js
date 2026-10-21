import crypto from "crypto";
import { confirmPayment } from "../../../lib/orchestrator.js";
import { recordPayment } from "../../../lib/quotes.js";
import { confirmSeat } from "../../../lib/carpool.js";
import { recordJobPayment } from "../../../lib/payafter.js";

export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const raw = await readBody(req);
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    // Verify webhook signature
    const expected = crypto
      .createHmac("sha256", secret)
      .update(raw)
      .digest("hex");

    if (expected !== signature) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }

    const event = JSON.parse(raw);
    const { event: eventType, payload } = event;

    if (eventType === "payment.authorized" || eventType === "payment.captured") {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;
      const bookingId = payment.notes?.booking_id;

      if (payment.notes?.carpool_seat_id) await confirmSeat(payment.notes.carpool_seat_id, { paymentId: payment.id });
      // Advance/balance payments are recorded by payment_link.paid below.
      if (bookingId && !payment.notes?.what) {
        await confirmPayment({
          bookingId,
          razorpayOrderId: orderId,
          razorpayPaymentId: payment.id,
          razorpaySignature: signature,
        });
      } else if (bookingId && payment.notes?.what === "job") {
        // "Pay now instead" on a pay-after job (/api/booking/pay-now): an order, not a link.
        await recordJobPayment(bookingId, { amount: payment.amount / 100, mode: "razorpay", ref: payment.id, receivedBy: "weaid", by: "customer",
          patch: { razorpay_order_id: orderId, razorpay_payment_id: payment.id } });
      }
    }

    // Bookings taken on the phone line are paid through a payment link.
    if (eventType === "payment_link.paid") {
      const link = payload.payment_link?.entity;
      const payment = payload.payment?.entity;
      const bookingId = link?.notes?.booking_id;
      const what = link?.notes?.what;
      if (bookingId && (what === "advance" || what === "balance")) {
        await recordPayment(bookingId, what, (payment?.amount || link?.amount_paid || 0) / 100, "razorpay", payment?.id);
      } else if (bookingId && what === "job") {
        // The link sent when the pro tapped Done on a pay-after job.
        await recordJobPayment(bookingId, { amount: (payment?.amount || link?.amount_paid || 0) / 100, mode: "razorpay", ref: payment?.id || link?.id, receivedBy: "weaid", by: "customer",
          patch: { razorpay_payment_id: payment?.id || null } });
      } else if (bookingId) {
        await confirmPayment({
          bookingId,
          razorpayOrderId: payment?.order_id || link?.order_id || null,
          razorpayPaymentId: payment?.id || null,
        });
      }
    }

    /*
     * The customer scanned the UPI QR for a pay-after job (lib/payafter.js
     * jobQrInfo). The QR's notes carry the booking id. payment.captured
     * arrives for the same money with the same payment id and the same
     * notes, and recordJobPayment is idempotent on that id, so whichever
     * event lands first records it and the other does nothing. Once fully
     * paid, recordJobPayment closes the QR and cancels the link itself.
     */
    if (eventType === "qr_code.credited") {
      const qr = payload.qr_code?.entity;
      const payment = payload.payment?.entity;
      const bookingId = qr?.notes?.booking_id || payment?.notes?.booking_id;
      if (bookingId) {
        await recordJobPayment(bookingId, { amount: (payment?.amount || qr?.payment_amount || 0) / 100, mode: "upi_qr", ref: payment?.id || qr?.id, receivedBy: "weaid", by: "customer",
          patch: { razorpay_payment_id: payment?.id || null } });
      }
    }

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[webhook/razorpay]", err);
    return res.status(500).json({ error: err.message });
  }
}

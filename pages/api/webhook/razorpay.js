import crypto from "crypto";
import { confirmPayment } from "../../../lib/orchestrator.js";

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

      if (bookingId) {
        await confirmPayment({
          bookingId,
          razorpayOrderId: orderId,
          razorpayPaymentId: payment.id,
          razorpaySignature: signature,
        });
      }
    }

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[webhook/razorpay]", err);
    return res.status(500).json({ error: err.message });
  }
}

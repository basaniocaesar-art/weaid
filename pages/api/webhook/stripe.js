import { constructWebhookEvent } from "../../../lib/stripe.js";
import { fulfillPaidBooking } from "../../../lib/orchestrator.js";

export const config = { api: { bodyParser: false } };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawBody = await readBody(req);
    const signature = req.headers["stripe-signature"];

    const event = constructWebhookEvent(rawBody, signature);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;

      if (bookingId && session.payment_status === "paid") {
        // Shared fulfillment: customer notice + NEAREST-FIRST provider dispatch
        await fulfillPaidBooking(bookingId, {
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent,
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[webhook/stripe]", err);
    return res.status(400).json({ error: err.message });
  }
}

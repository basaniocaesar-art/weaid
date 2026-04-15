import { constructWebhookEvent } from "../../../lib/stripe.js";
import { updateBooking } from "../../../lib/supabase.js";
import { notifyCustomerBookingConfirmed, notifyProviderNewJob } from "../../../lib/whatsapp.js";
import { sendBookingConfirmation } from "../../../lib/email.js";
import { getProvidersByService } from "../../../lib/supabase.js";

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
        const booking = await updateBooking(bookingId, {
          status: "pending",
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent,
          paid_at: new Date().toISOString(),
        });

        // Notify customer
        await notifyCustomerBookingConfirmed(booking.customer_phone, booking);
        await sendBookingConfirmation(booking.customer_email, booking);

        // Notify providers
        const providers = await getProvidersByService(booking.service, booking.city);
        for (const p of providers) {
          await notifyProviderNewJob(p.phone, booking);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[webhook/stripe]", err);
    return res.status(400).json({ error: err.message });
  }
}

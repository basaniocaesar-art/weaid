/* ── Stripe helpers ── */

import Stripe from "stripe";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;

let instance = null;

function getStripe() {
  if (!SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY env var");
  }
  if (!instance) {
    instance = new Stripe(SECRET_KEY, { apiVersion: "2024-06-20" });
  }
  return instance;
}

export async function createCheckoutSession({ amount, currency = "inr", bookingId, customerEmail, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card", "upi"],
    mode: "payment",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: "WeAid Service Booking",
            description: `Booking #${bookingId}`,
          },
          unit_amount: amount * 100, // Stripe expects paise
        },
        quantity: 1,
      },
    ],
    metadata: { booking_id: bookingId },
    success_url: successUrl || `${process.env.NEXT_PUBLIC_URL || ""}/dashboard?payment=success&booking=${bookingId}`,
    cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_URL || ""}/dashboard?payment=cancelled`,
  });
  return session;
}

export async function processRefund(paymentIntentId, amountInr) {
  const stripe = getStripe();
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amountInr ? amountInr * 100 : undefined, // full refund if no amount
  });
  return refund;
}

export async function retrieveSession(sessionId) {
  const stripe = getStripe();
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
}

export function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpointSecret) throw new Error("Missing STRIPE_WEBHOOK_SECRET env var");
  return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
}

export { SECRET_KEY as stripeKeyExists };

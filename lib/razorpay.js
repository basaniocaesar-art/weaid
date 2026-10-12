/* ── Razorpay helpers ── */

import Razorpay from "razorpay";
import crypto from "crypto";

const KEY_ID     = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

let instance = null;

function getRazorpay() {
  if (!KEY_ID || !KEY_SECRET) {
    throw new Error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET env vars");
  }
  if (!instance) {
    instance = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return instance;
}

export async function createOrder(amountInr, receipt, notes = {}) {
  const rz = getRazorpay();
  const order = await rz.orders.create({
    amount: amountInr * 100, // Razorpay expects paise
    currency: "INR",
    receipt,
    notes,
  });
  return order;
}

export function verifySignature(orderId, paymentId, signature) {
  const body = orderId + "|" + paymentId;
  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(body)
    .digest("hex");
  return expected === signature;
}

export async function fetchPayment(paymentId) {
  const rz = getRazorpay();
  return rz.payments.fetch(paymentId);
}

export async function processRefund(paymentId, amountInr, notes = {}) {
  const rz = getRazorpay();
  const refund = await rz.payments.refund(paymentId, {
    amount: amountInr * 100,
    notes,
  });
  return refund;
}

/**
 * A payment link for a booking taken over the phone. Razorpay itself texts the
 * link to the customer (its own registered SMS route), so this works without
 * WeAid having SMS or WhatsApp set up. Paid links arrive at the webhook as
 * payment_link.paid with notes.booking_id.
 */
export async function createPaymentLink({ amountInr, bookingId, name, phone, description, callbackUrl, what }) {
  const rz = getRazorpay();
  const ten = String(phone || "").replace(/\D/g, "").slice(-10);
  return rz.paymentLink.create({
    amount: Math.round(amountInr * 100),
    currency: "INR",
    description: String(description || "WeAid booking").slice(0, 255),
    customer: { name: name || "WeAid customer", contact: `+91${ten}` },
    notify: { sms: true, email: false },
    reminder_enable: true,
    expire_by: Math.floor(Date.now() / 1000) + 24 * 3600,
    // Razorpay caps reference_id at 40 chars and wants it unique; the booking id travels in notes.
    reference_id: what ? `${what.slice(0, 3)}${Date.now() % 1e7}_${bookingId.slice(0, 24)}` : `booking_${bookingId}`.slice(0, 40),
    notes: { booking_id: bookingId, ...(what ? { what } : {}) },
    ...(callbackUrl && { callback_url: callbackUrl, callback_method: "get" }),
  });
}

export const razorpayConfigured = () => Boolean(KEY_ID && KEY_SECRET);

export { KEY_ID as razorpayKeyId };

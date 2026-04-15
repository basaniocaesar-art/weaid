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

export { KEY_ID as razorpayKeyId };

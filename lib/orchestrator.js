/* ── Booking Orchestrator ── */
/* Coordinates pricing, payments, DB, and notifications */

import { calculatePrice } from "./pricing.js";
import { createOrder, processRefund, verifySignature } from "./razorpay.js";
import { insertBooking, updateBooking, getBooking, getProvidersByService } from "./supabase.js";
import { notifyCustomerBookingConfirmed, notifyProviderNewJob, notifyCustomerProviderAssigned, notifyCustomerJobComplete } from "./whatsapp.js";
import { sendBookingConfirmation, sendProviderAssigned, sendRefundConfirmation } from "./email.js";

export async function createBooking({ service, city, scope, slot, customer }) {
  // 1. Calculate price
  const price = calculatePrice({ service, city, scope, slot });

  // 2. Create Razorpay order
  const order = await createOrder(price.total, `booking_${Date.now()}`);

  // 3. Store booking in DB
  const booking = await insertBooking({
    service,
    city,
    scope,
    slot,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.phone,
    customer_email: customer.email,
    subtotal: price.subtotal,
    platform_fee: price.platformFee,
    total: price.total,
    commission: price.commission,
    provider_earnings: price.providerEarnings,
    razorpay_order_id: order.id,
    status: "pending_payment",
  });

  return { booking, order, price };
}

export async function confirmPayment({ bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  // 1. Verify signature
  const valid = verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!valid) throw new Error("Invalid payment signature");

  // 2. Update booking
  const booking = await updateBooking(bookingId, {
    status: "pending",
    razorpay_payment_id: razorpayPaymentId,
    paid_at: new Date().toISOString(),
  });

  // 3. Notify customer
  await notifyCustomerBookingConfirmed(booking.customer_phone, booking);
  await sendBookingConfirmation(booking.customer_email, booking);

  // 4. Find and notify nearby providers
  const providers = await getProvidersByService(booking.service, booking.city);
  for (const p of providers) {
    await notifyProviderNewJob(p.phone, booking);
  }

  return booking;
}

export async function providerAcceptJob(bookingId, providerId) {
  const booking = await updateBooking(bookingId, {
    status: "accepted",
    provider_id: providerId,
    accepted_at: new Date().toISOString(),
  });

  // Notify customer
  await notifyCustomerProviderAssigned(booking.customer_phone, booking, { name: booking.provider_name });
  await sendProviderAssigned(booking.customer_email, booking, { name: booking.provider_name });

  return booking;
}

export async function providerRejectJob(bookingId, providerId, reason) {
  return updateBooking(bookingId, {
    status: "pending",
    provider_id: null,
    rejection_log: reason,
  });
}

export async function completeJob(bookingId) {
  const booking = await updateBooking(bookingId, {
    status: "completed",
    completed_at: new Date().toISOString(),
  });

  await notifyCustomerJobComplete(booking.customer_phone, booking);
  return booking;
}

export async function refundBooking(bookingId, reason) {
  const booking = await getBooking(bookingId);
  if (!booking.razorpay_payment_id) throw new Error("No payment to refund");

  const refund = await processRefund(booking.razorpay_payment_id, booking.total, { reason });

  const updated = await updateBooking(bookingId, {
    status: "refunded",
    refund_id: refund.id,
    refund_reason: reason,
    refunded_at: new Date().toISOString(),
  });

  await sendRefundConfirmation(booking.customer_email, updated, booking.total);
  return { booking: updated, refund };
}

/* ── Booking Orchestrator ── */
/* Coordinates pricing, payments, DB, and notifications */

import { calculatePrice } from "./pricing.js";
import { createOrder, processRefund, verifySignature } from "./razorpay.js";
import { insertBooking, updateBooking, getBooking, getProvidersByService, acceptBookingIfOpen, getProviderById } from "./supabase.js";
import { notifyCustomerBookingConfirmed, notifyProviderNewJob, notifyCustomerProviderAssigned, notifyCustomerJobComplete } from "./whatsapp.js";
import { sendBookingConfirmation, sendProviderAssigned, sendRefundConfirmation } from "./email.js";
import { creditAffiliateCommission } from "./affiliate.js";

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

  // 4. Broadcast to available providers — NEAREST FIRST (Uber-style).
  const providers = await getProvidersByService(booking.service, booking.city);
  const ordered = orderByNearest(providers, booking.customer_lat, booking.customer_lng);
  // First-come-first-served: everyone is pinged, nearest pros first, and the
  // first to accept wins (guarded in providerAcceptJob).
  for (const p of ordered) {
    await notifyProviderNewJob(p.phone, booking).catch((e) =>
      console.error("[dispatch] notify failed for", p.id, e.message)
    );
  }

  return booking;
}

// Haversine distance (km) between two lat/lng points.
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sort providers nearest-first when we know the customer's location;
// pros with a known location come before those without.
function orderByNearest(providers, lat, lng) {
  if (lat == null || lng == null) return providers;
  return [...providers]
    .map((p) => ({
      p,
      d: p.lat != null && p.lng != null ? distanceKm(lat, lng, p.lat, p.lng) : Infinity,
    }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.p);
}

export async function providerAcceptJob(bookingId, providerId) {
  // Look up the accepting provider's details for the customer notification
  const provider = await getProviderById(providerId).catch(() => null);

  // First-accept-wins: atomic guard — only the first provider succeeds.
  const booking = await acceptBookingIfOpen(bookingId, {
    providerId,
    providerName: provider?.name,
    providerPhone: provider?.phone,
  });

  if (!booking) {
    const err = new Error("This job has already been accepted by another provider");
    err.code = "ALREADY_TAKEN";
    throw err;
  }

  // Notify customer who's coming
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

  // Credit affiliate commission if this was a referred booking
  if (booking.affiliate_id) {
    await creditAffiliateCommission(booking).catch((err) =>
      console.error("[affiliate] Failed to credit commission:", err)
    );
  }

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

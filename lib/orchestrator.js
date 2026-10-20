/* ── Booking Orchestrator ── */
/* Coordinates pricing, payments, DB, and notifications */

import { alertTeamBooking } from "./followup.js";
import { startOffers } from "./offers.js";
import { calculatePrice } from "./pricing.js";
import { createOrder, processRefund, verifySignature } from "./razorpay.js";
import { insertBooking, updateBooking, getBooking, getProvidersByService, acceptBookingIfOpen, getProviderById } from "./supabase.js";
import { notifyCustomerBookingConfirmed, notifyProviderNewJob, notifyCustomerProviderAssigned, notifyCustomerJobComplete, notifyProviderJobConfirmed } from "./whatsapp.js";
import { createMaskedCall } from "./masking.js";
import { sendBookingConfirmation, sendProviderAssigned, sendRefundConfirmation } from "./email.js";
import { creditAffiliateCommission } from "./affiliate.js";
import { callBothEnds } from "./dispatch.js";
import { eventsFor, logEvent } from "./jobs.js";
import { recordJobPayment, withoutOverLimit, collectAfterJob } from "./payafter.js";

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

/*
 * Getting the job in front of providers.
 *
 * This used to be the back half of fulfillPaidBooking, which meant the only
 * way a job could reach anybody was through a payment webhook — and two real
 * customers who did not want to pay first sat in pending_payment for days
 * while nobody was rung. Now outreach keys on confirmed_at ("somebody may be
 * contacted about this"), which payment sets for a prepaid job and the booking
 * itself sets for a pay-after one. The channels are unchanged: the WeAid Pro
 * app first (startOffers), which hands to the phone ring-round through
 * offers.js → noPros → dispatchRound when nobody in the app takes it, plus a
 * WhatsApp to pros who opted in.
 *
 * Idempotent: a "dispatch_started" event is written first, and a second call
 * for the same booking does nothing. Callers in a race are already guarded by
 * the status transition they made before calling this.
 */
export async function startDispatch(bookingOrId) {
  const booking = typeof bookingOrId === "string" ? await getBooking(bookingOrId) : bookingOrId;
  if (!booking) return { skipped: "no such booking" };
  if (booking.status !== "pending") return { skipped: `status is ${booking.status}` };
  if (!booking.confirmed_at && !booking.paid_at) return { skipped: "not confirmed" };
  const events = await eventsFor(booking.id);
  if (events.some((e) => e.event === "dispatch_started")) return { skipped: "already started" };
  await logEvent(booking.id, "dispatch_started", { mode: booking.payment_mode || "prepaid" });

  await alertTeamBooking(booking, booking.payment_mode === "pay_after" ? "pay_after" : "paid");
  // Ring nearby pros in the WeAid Pro app (first to accept gets it).
  await startOffers(booking).catch((e) => console.error("[offers] start failed", e.message));

  // Notify customer
  await notifyCustomerBookingConfirmed(booking.customer_phone, booking).catch((e) =>
    console.error("[fulfill] customer notify failed:", e.message)
  );
  await sendBookingConfirmation(booking.customer_email, booking).catch((e) =>
    console.error("[fulfill] email failed:", e.message)
  );

  /*
   * Tell somebody. This is the step that has never actually worked.
   *
   * It used to WhatsApp every provider in the city, one after another, through
   * a sender that has never been configured — so the loop ran, logged nothing
   * useful, and the job reached nobody. Two changes: providers who have signed
   * up still get the message (they opted in, it is free, and it is instant),
   * and the real work is the calls: when nobody in the WeAid Pro app takes it,
   * offers.js hands it to dispatchRound(), which rings the nearest few and
   * widens if none of them says yes.
   */
  const providers = await getProvidersByService(booking.service, booking.city);
  const ordered = orderByNearest(providers, booking.customer_lat, booking.customer_lng);
  // Only people who came to us themselves get a message: the imported listings
  // never gave anyone permission to message them. And nobody who is sitting on
  // more of WeAid's cash than the limit allows (lib/payafter.js).
  const optedIn = await withoutOverLimit(ordered.filter((p) => p.source === "signup" || p.claimed));
  await Promise.all(
    optedIn.slice(0, 20).map((p) =>
      notifyProviderNewJob(p.phone, booking).catch((e) =>
        console.error("[dispatch] notify failed for", p.id, e.message)
      )
    )
  );

  return { started: true };
}

/**
 * A pay-after booking is confirmed by being made: the row goes to "pending"
 * with confirmed_at set, and outreach starts at once. Returns the booking.
 */
export async function confirmBooking(bookingId) {
  const existing = await getBooking(bookingId);
  if (!existing) return null;
  if (existing.status !== "pending_payment") return existing;
  const booking = await updateBooking(bookingId, {
    status: "pending",
    payment_mode: "pay_after",
    confirmed_at: existing.confirmed_at || new Date().toISOString(),
  });
  await startDispatch(booking);
  return booking;
}

// Shared post-payment fulfillment used by BOTH payment webhooks (Stripe + Razorpay).
// The webhook has already verified its own signature before calling this, so we
// do not re-verify here. Idempotent: only dispatches on the first transition
// out of pending_payment.
export async function fulfillPaidBooking(bookingId, paymentPatch = {}) {
  const existing = await getBooking(bookingId);
  if (!existing) return null;

  if (existing.status === "pending_payment") {
    const booking = await updateBooking(bookingId, {
      status: "pending",
      paid_at: existing.paid_at || new Date().toISOString(),
      confirmed_at: existing.confirmed_at || new Date().toISOString(),
      ...paymentPatch,
    });
    await startDispatch(booking);
    return booking;
  }

  /*
   * A pay-after job paid online — "pay now instead" before anyone came, or the
   * link sent when the pro tapped Done. Money in, nothing to dispatch: the job
   * was dispatched when it was booked.
   */
  if (existing.payment_mode === "pay_after" && !existing.paid_at) {
    await recordJobPayment(bookingId, {
      amount: existing.total, mode: "razorpay", receivedBy: "weaid", by: "customer",
      ref: paymentPatch.razorpay_payment_id || paymentPatch.stripe_payment_intent || null,
      patch: paymentPatch,
    });
    return getBooking(bookingId);
  }

  // Already paid (a re-delivered webhook, or payment.captured AND payment_link.paid
  // for the same payment): change nothing. Writing status "pending" here used to
  // knock an accepted, in-progress job back to "finding a pro".
  return existing;
}

// Razorpay webhook entry: it has already verified the webhook HMAC upstream,
// so we just fulfill. (Kept for backwards compatibility.)
export async function confirmPayment({ bookingId, razorpayOrderId, razorpayPaymentId }) {
  return fulfillPaidBooking(bookingId, {
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
  });
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

export async function providerAcceptJob(bookingId, providerId, { agreedAt, etaMinutes } = {}) {
  // Look up the accepting provider's details for the customer notification
  const provider = await getProviderById(providerId).catch(() => null);

  // First-accept-wins: atomic guard — only the first provider succeeds.
  const booking = await acceptBookingIfOpen(bookingId, {
    providerId,
    providerName: provider?.name,
    providerPhone: provider?.phone,
    agreedAt,
    etaMinutes,
  });

  if (!booking) {
    const err = new Error("This job has already been accepted by another provider");
    err.code = "ALREADY_TAKEN";
    throw err;
  }

  // Number masking: create a proxy line so neither party sees the other's real
  // number (booked jobs only). Falls back to real numbers if not configured.
  const masked = await createMaskedCall({
    customerPhone: booking.customer_phone,
    providerPhone: provider?.phone || booking.provider_phone,
    bookingId: booking.id,
  }).catch(() => null);
  if (masked?.proxyNumber) {
    booking.mask_number = masked.proxyNumber;
    booking.mask_session_id = masked.sessionId;
    await updateBooking(booking.id, { mask_number: masked.proxyNumber, mask_session_id: masked.sessionId }).catch(() => {});
  }

  // Notify customer who's coming
  await notifyCustomerProviderAssigned(booking.customer_phone, booking, { name: booking.provider_name }).catch((e) => console.error("[accept] customer wa:", e.message));
  await sendProviderAssigned(booking.customer_email, booking, { name: booking.provider_name }).catch((e) => console.error("[accept] email:", e.message));

  // Provider now gets the job details + customer contact (they've committed)
  await notifyProviderJobConfirmed(provider?.phone || booking.provider_phone, booking).catch((e) => console.error("[accept] provider wa:", e.message));

  // Confirmation CALLS on BOTH ends, through the same agent the errands use.
  await callBothEnds(booking).catch((e) => console.error("[accept] calls:", e.message));

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
  // A pay-after job: now is when the money is asked for.
  await collectAfterJob(booking).catch((e) => console.error("[complete] collect failed:", e.message));
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

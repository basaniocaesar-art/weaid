import { calculatePrice } from "../../../lib/pricing.js";
import { insertBooking } from "../../../lib/supabase.js";
import { createOrder, razorpayKeyId } from "../../../lib/razorpay.js";
import { createCheckoutSession } from "../../../lib/stripe.js";
import { lookupAffiliateByRefCode } from "../../../lib/affiliate.js";
import { alertTeamBooking } from "../../../lib/followup.js";
import { startDispatch } from "../../../lib/orchestrator.js";
import { paymentModeFor, paymentChoice, openUnpaidCount, PAY_AFTER_OPEN_LIMIT } from "../../../lib/payafter.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { service, city, scope, slot, customer, gateway = "razorpay", refCode, scheduledAt, timingMode, lat, lng, description, address, workers, sqft, days, hours, months, paymentMode } = req.body;

    if (!service || !city || !scope || !customer) {
      return res.status(400).json({ error: "Missing required fields: service, city, scope, customer" });
    }

    const nWorkers = Math.max(1, Number(workers) || 1);

    // 1. Calculate price
    const pos = (v) => (Number(v) > 0 ? Number(v) : undefined);
    // Same size inputs the quote used, or the charge silently falls to the minimum.
    const price = calculatePrice({ service, city, scope, slot, workers: nWorkers, sqft: pos(sqft), days: pos(days), hours: pos(hours), months: pos(months) });

    // 2. Look up affiliate if ref code provided
    let affiliateId = null;
    if (refCode) {
      const affiliate = await lookupAffiliateByRefCode(refCode);
      if (affiliate) affiliateId = affiliate.id;
    }

    /*
     * 3. Pay now, or pay after the job?
     *
     * Repairs are always pay-after; fixed-price services are the customer's
     * choice, defaulting to pay-after (lib/payafter.js). The one guard: a
     * number that already has PAY_AFTER_OPEN_LIMIT pay-after jobs open or
     * unpaid gets this one as pay-now instead, and is told why, rather than a
     * flat refusal that would lose a real customer with a real leak.
     */
    let mode = paymentModeFor(service, paymentMode);
    let payAfterRefused = null;
    if (mode === "pay_after" && (await openUnpaidCount(customer.phone)) >= PAY_AFTER_OPEN_LIMIT) {
      mode = "prepaid";
      payAfterRefused = "open_limit";
    }
    const payAfter = mode === "pay_after";
    const now = new Date().toISOString();

    // 4. Store booking
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
      /*
       * The two columns an older schema still insists on.
       *
       * `amount` and `commission_pct` predate `total` and `commission` and are
       * NOT NULL, so every insert failed on them even after the missing columns
       * were added. Rather than relax the constraints and leave two money
       * columns permanently null, they are written with the same figures — one
       * place to change if the old columns are ever dropped.
       */
      amount: Math.round(price.total),
      commission_pct: price.subtotal > 0 ? Number((price.commission / price.subtotal).toFixed(4)) : 0,
      provider_earnings: price.providerEarnings,
      payment_gateway: gateway,
      ref_code: refCode || null,
      affiliate_id: affiliateId,
      timing_mode: timingMode === "scheduled" ? "scheduled" : "asap",
      scheduled_at: timingMode === "scheduled" && scheduledAt ? scheduledAt : null,
      customer_lat: lat != null ? Number(lat) : null,
      customer_lng: lng != null ? Number(lng) : null,
      description: description || null,
      address: address || null,
      workers: nWorkers,
      payment_mode: mode,
      // A pay-after job is confirmed by being booked: open for outreach at once.
      status: payAfter ? "pending" : "pending_payment",
      confirmed_at: payAfter ? now : null,
    });

    if (payAfter) {
      // The team hears about it inside startDispatch ("pay_after" alert), and
      // the pros hear about it now. Nothing to pay, so nothing to open.
      await startDispatch(booking).catch((e) => console.error("[booking/create] dispatch failed", booking.id, e.message));
      return res.status(201).json({
        bookingId: booking.id,
        amount: price.total,
        breakdown: price,
        payment: null,
        paymentMode: "pay_after",
        payChoice: paymentChoice(service),
      });
    }

    /*
     * 5. Open a payment session — but never at the cost of the booking.
     *
     * The row above is already written. This used to throw straight out of the
     * handler when a gateway key was missing or the gateway was down, so the
     * caller got a 500 and never learned the booking id: a customer who had
     * given their name, number and address vanished, and nobody could ring
     * them back. Now the booking is always returned and payment is reported as
     * unavailable, which is something the concierge and the ops screen can
     * both act on.
     */
    await alertTeamBooking(booking, "new");

    let payment = null;
    let paymentError = null;
    try {
      if (gateway === "stripe") {
        const session = await createCheckoutSession({
          amount: price.total,
          bookingId: booking.id,
          customerEmail: customer.email,
        });
        payment = { gateway: "stripe", sessionId: session.id, url: session.url };
      } else {
        const order = await createOrder(price.total, `booking_${booking.id}`, { booking_id: booking.id });
        payment = { gateway: "razorpay", orderId: order.id, key: razorpayKeyId, amount: order.amount, currency: order.currency };
      }
    } catch (err) {
      console.error("[booking/create] payment session failed", booking.id, err.message);
      paymentError = "payment_unavailable";
    }

    return res.status(201).json({
      bookingId: booking.id,
      amount: price.total,
      breakdown: price,
      payment,
      paymentMode: "prepaid",
      payChoice: paymentChoice(service),
      ...(payAfterRefused && { payAfterRefused }),
      ...(paymentError && { paymentError }),
    });
  } catch (err) {
    console.error("[booking/create]", err);
    return res.status(500).json({ error: err.message });
  }
}

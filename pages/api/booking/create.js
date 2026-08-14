import { calculatePrice } from "../../../lib/pricing.js";
import { insertBooking } from "../../../lib/supabase.js";
import { createOrder, razorpayKeyId } from "../../../lib/razorpay.js";
import { createCheckoutSession } from "../../../lib/stripe.js";
import { lookupAffiliateByRefCode } from "../../../lib/affiliate.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { service, city, scope, slot, customer, gateway = "razorpay", refCode, scheduledAt, timingMode, lat, lng, description, address, workers } = req.body;

    if (!service || !city || !scope || !customer) {
      return res.status(400).json({ error: "Missing required fields: service, city, scope, customer" });
    }

    const nWorkers = Math.max(1, Number(workers) || 1);

    // 1. Calculate price
    const price = calculatePrice({ service, city, scope, slot, workers: nWorkers });

    // 2. Look up affiliate if ref code provided
    let affiliateId = null;
    if (refCode) {
      const affiliate = await lookupAffiliateByRefCode(refCode);
      if (affiliate) affiliateId = affiliate.id;
    }

    // 3. Store booking
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
      status: "pending_payment",
    });

    // 3. Create payment session based on chosen gateway
    let payment;

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

    return res.status(201).json({
      bookingId: booking.id,
      amount: price.total,
      breakdown: price,
      payment,
    });
  } catch (err) {
    console.error("[booking/create]", err);
    return res.status(500).json({ error: err.message });
  }
}

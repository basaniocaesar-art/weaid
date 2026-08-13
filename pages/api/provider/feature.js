import { updateProvider } from "../../../lib/supabase.js";
import { verifySignature } from "../../../lib/razorpay.js";

// Featured placement = front-of-search (paid tier), 30 days per purchase.
const FEATURE_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { providerId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const adminSecret = req.headers["x-admin-secret"];
    const isAdmin = adminSecret && adminSecret === process.env.ADMIN_SECRET;

    if (!providerId) {
      return res.status(400).json({ error: "Missing providerId" });
    }

    // Payment gate: founder/admin can grant Featured free (bypass);
    // everyone else must present a verified Razorpay payment.
    if (!isAdmin) {
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res.status(402).json({
          error: "Payment required to activate Featured placement",
          paymentRequired: true,
        });
      }
      const valid = verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!valid) {
        return res.status(402).json({ error: "Invalid payment signature" });
      }
    }

    const featuredUntil = new Date(Date.now() + FEATURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const updated = await updateProvider(providerId, {
      plan_tier: "featured",
      featured: true,
      featured_until: featuredUntil,
    });

    return res.status(200).json({
      id: updated.id,
      plan_tier: updated.plan_tier,
      featured_until: featuredUntil,
      grantedBy: isAdmin ? "admin" : "payment",
    });
  } catch (err) {
    console.error("[provider/feature]", err);
    return res.status(500).json({ error: err.message });
  }
}

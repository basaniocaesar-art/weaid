import { createOrder, razorpayKeyId } from "../../../lib/razorpay.js";
import { getProviderById } from "../../../lib/supabase.js";

// Monthly price for Featured (front-of-search) placement.
export const FEATURED_PRICE_INR = 499;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { providerId } = req.body;
    if (!providerId) return res.status(400).json({ error: "Missing providerId" });

    const provider = await getProviderById(providerId);
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const order = await createOrder(FEATURED_PRICE_INR, `feature_${providerId}_${Date.now()}`, {
      purpose: "featured_placement",
      provider_id: providerId,
    });

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount, // paise
      currency: order.currency,
      keyId: razorpayKeyId,
      priceInr: FEATURED_PRICE_INR,
      providerName: provider.name,
    });
  } catch (err) {
    console.error("[provider/feature-order]", err);
    return res.status(500).json({ error: err.message });
  }
}

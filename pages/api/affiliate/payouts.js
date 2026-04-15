import { getAffiliatePayouts } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { affiliateId } = req.query;

    if (!affiliateId) {
      return res.status(400).json({ error: "Missing affiliateId" });
    }

    const payouts = await getAffiliatePayouts(affiliateId);

    return res.status(200).json({ payouts });
  } catch (err) {
    console.error("[affiliate/payouts]", err);
    return res.status(500).json({ error: err.message });
  }
}

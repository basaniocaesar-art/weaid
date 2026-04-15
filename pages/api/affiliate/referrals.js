import { getAffiliateReferrals } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { affiliateId, page = 1, limit = 20 } = req.query;

    if (!affiliateId) {
      return res.status(400).json({ error: "Missing affiliateId" });
    }

    const result = await getAffiliateReferrals(affiliateId, parseInt(page), parseInt(limit));

    return res.status(200).json({
      referrals: result.referrals,
      total: result.total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error("[affiliate/referrals]", err);
    return res.status(500).json({ error: err.message });
  }
}

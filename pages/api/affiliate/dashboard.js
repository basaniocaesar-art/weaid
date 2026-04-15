import { getAffiliateById, getAffiliateReferrals, getMonthlyStats, getLeaderboard } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { affiliateId } = req.query;

    if (!affiliateId) {
      return res.status(400).json({ error: "Missing affiliateId" });
    }

    const affiliate = await getAffiliateById(affiliateId);
    if (!affiliate) {
      return res.status(404).json({ error: "Affiliate not found" });
    }

    const currentMonth = new Date().toISOString().slice(0, 7);

    const [recentReferrals, monthlyStats, leaderboard] = await Promise.all([
      getAffiliateReferrals(affiliateId, 1, 10),
      getMonthlyStats(affiliateId, currentMonth),
      getLeaderboard(currentMonth),
    ]);

    // Find rank in leaderboard
    const rank = leaderboard.findIndex((e) => e.affiliate_id === affiliateId) + 1;

    return res.status(200).json({
      affiliate: {
        id: affiliate.id,
        name: affiliate.name,
        email: affiliate.email,
        refCode: affiliate.ref_code,
        tier: affiliate.tier,
        status: affiliate.status,
      },
      stats: {
        totalEarnings: affiliate.total_earnings,
        pendingPayout: affiliate.pending_payout,
        totalReferrals: affiliate.total_referrals,
        thisMonthReferrals: monthlyStats?.referral_count || 0,
        thisMonthEarnings: monthlyStats?.total_value || 0,
      },
      recentReferrals: recentReferrals.referrals,
      leaderboardRank: rank || null,
      shareUrl: `${process.env.NEXT_PUBLIC_URL || "https://weaid.in"}/?ref=${affiliate.ref_code}`,
    });
  } catch (err) {
    console.error("[affiliate/dashboard]", err);
    return res.status(500).json({ error: err.message });
  }
}

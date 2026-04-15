import { getLeaderboard } from "../../../lib/supabase.js";
import { COMPETITION_PRIZES, TIER_BONUSES } from "../../../lib/affiliate.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const entries = await getLeaderboard(month);

    const leaderboard = entries.map((entry, idx) => ({
      rank: idx + 1,
      name: maskName(entry.affiliates?.name || "Unknown"),
      referralCount: entry.referral_count,
      totalValue: entry.total_value,
      tier: entry.affiliates?.tier || "bronze",
      affiliateId: entry.affiliate_id,
    }));

    return res.status(200).json({
      leaderboard,
      currentMonth: month,
      prizes: COMPETITION_PRIZES,
      tierBonuses: TIER_BONUSES,
    });
  } catch (err) {
    console.error("[affiliate/leaderboard]", err);
    return res.status(500).json({ error: err.message });
  }
}

function maskName(name) {
  const parts = name.split(" ");
  if (parts.length < 2) return name.slice(0, 2) + "***";
  const first = parts[0].slice(0, 2) + "**" + parts[0].slice(-1);
  const last = parts[1][0] + ".";
  return first + " " + last;
}

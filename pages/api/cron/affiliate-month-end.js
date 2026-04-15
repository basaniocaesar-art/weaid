import { getAllCompetitionEntries, updateAffiliateTier, insertAffiliatePayout } from "../../../lib/supabase.js";
import { calculateAffiliateTier, TIER_BONUSES, COMPETITION_PRIZES } from "../../../lib/affiliate.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Process previous month
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = prevMonth.toISOString().slice(0, 7);

    const entries = await getAllCompetitionEntries(month);
    if (!entries.length) {
      return res.status(200).json({ message: "No entries for " + month });
    }

    let processed = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rank = i + 1;
      const newTier = calculateAffiliateTier(entry.referral_count);

      // Update rank on competition entry
      await supabase
        .from("affiliate_competitions")
        .update({ rank })
        .eq("id", entry.id);

      // Update affiliate tier
      await updateAffiliateTier(entry.affiliate_id, newTier);

      // Calculate bonuses
      let bonus = TIER_BONUSES[newTier] || 0;
      if (rank <= COMPETITION_PRIZES.length) {
        bonus += COMPETITION_PRIZES[rank - 1];
      }

      // Award bonus if any
      if (bonus > 0) {
        await supabase
          .from("affiliate_competitions")
          .update({ bonus_awarded: bonus })
          .eq("id", entry.id);

        // Add bonus to pending payout
        await supabase
          .from("affiliates")
          .update({
            pending_payout: (entry.affiliates?.total_earnings || 0) + bonus,
            total_earnings: (entry.affiliates?.total_earnings || 0) + bonus,
          })
          .eq("id", entry.affiliate_id);

        // Create payout record for the bonus
        await insertAffiliatePayout({
          affiliate_id: entry.affiliate_id,
          amount: bonus,
          referral_ids: [],
          method: "bonus",
          status: "initiated",
        });
      }

      processed++;
    }

    return res.status(200).json({
      month,
      processed,
      topThree: entries.slice(0, 3).map((e, i) => ({
        rank: i + 1,
        name: e.affiliates?.name,
        referrals: e.referral_count,
        prize: COMPETITION_PRIZES[i] || 0,
      })),
    });
  } catch (err) {
    console.error("[cron/affiliate-month-end]", err);
    return res.status(500).json({ error: err.message });
  }
}

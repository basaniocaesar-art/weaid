import { getCompletedPayouts, updateBooking, getAffiliatesForPayout, getEarnedReferrals, markReferralsPaid, insertAffiliatePayout, resetAffiliatePendingPayout } from "../../../lib/supabase.js";
import { notifyProviderPayout, notifyAffiliatePayout } from "../../../lib/whatsapp.js";
import { sendPayoutNotification, sendAffiliatePayoutNotification } from "../../../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify cron secret in production
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const bookings = await getCompletedPayouts(oneWeekAgo);

    // Group by provider
    const byProvider = {};
    for (const b of bookings) {
      const pid = b.provider_id;
      if (!byProvider[pid]) {
        byProvider[pid] = { provider: b.providers, total: 0, bookingIds: [] };
      }
      byProvider[pid].total += b.provider_earnings;
      byProvider[pid].bookingIds.push(b.id);
    }

    let payoutsProcessed = 0;

    for (const [providerId, data] of Object.entries(byProvider)) {
      // Mark bookings as paid
      for (const bid of data.bookingIds) {
        await updateBooking(bid, { provider_paid: true, paid_out_at: new Date().toISOString() });
      }

      // Notify provider
      if (data.provider?.phone) {
        await notifyProviderPayout(data.provider.phone, data.total);
      }
      if (data.provider?.email) {
        await sendPayoutNotification(data.provider.email, data.provider, data.total);
      }

      payoutsProcessed++;
    }

    // ── Affiliate Payouts (min ₹100) ──
    let affiliatePayoutsProcessed = 0;
    const affiliates = await getAffiliatesForPayout(100);

    for (const affiliate of affiliates) {
      const earned = await getEarnedReferrals(affiliate.id);
      if (!earned.length) continue;

      const referralIds = earned.map((r) => r.id);
      const amount = affiliate.pending_payout;

      await insertAffiliatePayout({
        affiliate_id: affiliate.id,
        amount,
        referral_ids: referralIds,
        method: affiliate.upi_id ? "upi" : "bank_transfer",
        status: "initiated",
      });

      await markReferralsPaid(referralIds);
      await resetAffiliatePendingPayout(affiliate.id);

      if (affiliate.phone) await notifyAffiliatePayout(affiliate.phone, amount).catch(() => {});
      if (affiliate.email) await sendAffiliatePayoutNotification(affiliate.email, affiliate, amount).catch(() => {});

      affiliatePayoutsProcessed++;
    }

    return res.status(200).json({
      providers: payoutsProcessed,
      totalBookings: bookings.length,
      affiliatePayouts: affiliatePayoutsProcessed,
    });
  } catch (err) {
    console.error("[cron/weekly-payout]", err);
    return res.status(500).json({ error: err.message });
  }
}

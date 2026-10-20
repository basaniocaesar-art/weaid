import { getCompletedPayouts, updateBooking, getAffiliatesForPayout, getEarnedReferrals, markReferralsPaid, insertAffiliatePayout, resetAffiliatePendingPayout } from "../../../lib/supabase.js";
import { notifyProviderPayout, notifyAffiliatePayout } from "../../../lib/whatsapp.js";
import { sendPayoutNotification, sendAffiliatePayoutNotification } from "../../../lib/email.js";
import { owedBalances, addLedger } from "../../../lib/payafter.js";

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
    /*
     * Only money WeAid is actually holding goes out. A pay-after job the
     * customer has not paid yet is not ours to pay from; one the pro took in
     * cash is already marked provider_paid when it was recorded (lib/payafter.js)
     * and never reaches here.
     */
    const bookings = (await getCompletedPayouts(oneWeekAgo)).filter((b) => b.payment_mode !== "pay_after" || b.paid_at);

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
    let netted = 0;
    const owed = await owedBalances(Object.keys(byProvider));

    for (const [providerId, data] of Object.entries(byProvider)) {
      // Mark bookings as paid
      for (const bid of data.bookingIds) {
        await updateBooking(bid, { provider_paid: true, paid_out_at: new Date().toISOString() });
      }

      /*
       * Cash commissions the pro is holding come off the top. The ledger row
       * is written before anybody is told a number, so the balance they see in
       * the app and the amount in the message agree.
       */
      const deduct = Math.min(Math.max(0, owed[providerId] || 0), Math.round(data.total));
      if (deduct > 0) {
        await addLedger(providerId, "netted", -deduct, { note: `Taken off the weekly payout of ₹${Math.round(data.total)}` });
        netted += deduct;
      }
      const net = Math.round(data.total) - deduct;

      // Notify provider
      if (net > 0 && data.provider?.phone) {
        await notifyProviderPayout(data.provider.phone, net);
      }
      if (net > 0 && data.provider?.email) {
        await sendPayoutNotification(data.provider.email, data.provider, net);
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
      nettedAgainstOwed: netted,
      affiliatePayouts: affiliatePayoutsProcessed,
    });
  } catch (err) {
    console.error("[cron/weekly-payout]", err);
    return res.status(500).json({ error: err.message });
  }
}

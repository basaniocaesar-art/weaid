import { getCompletedPayouts, updateBooking } from "../../../lib/supabase.js";
import { notifyProviderPayout } from "../../../lib/whatsapp.js";
import { sendPayoutNotification } from "../../../lib/email.js";

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

    return res.status(200).json({
      providers: payoutsProcessed,
      totalBookings: bookings.length,
    });
  } catch (err) {
    console.error("[cron/weekly-payout]", err);
    return res.status(500).json({ error: err.message });
  }
}

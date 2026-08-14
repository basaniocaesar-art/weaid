import { getUpcomingScheduledBookings, updateBooking } from "../../../lib/supabase.js";
import { notifyBookingReminder } from "../../../lib/whatsapp.js";

// Runs frequently (e.g. every 15 min). Sends a WhatsApp reminder to both the
// customer and the assigned provider for scheduled jobs starting within 2 hours.
export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const upcoming = await getUpcomingScheduledBookings(120);
    let sent = 0;
    for (const b of upcoming) {
      await notifyBookingReminder(b.customer_phone, b, "customer").catch((e) => console.error("[reminder] cust:", e.message));
      if (b.provider_phone) {
        await notifyBookingReminder(b.provider_phone, b, "provider").catch((e) => console.error("[reminder] prov:", e.message));
      }
      await updateBooking(b.id, { reminded_at: new Date().toISOString() });
      sent++;
    }
    return res.status(200).json({ upcoming: upcoming.length, reminded: sent });
  } catch (err) {
    console.error("[cron/booking-reminders]", err);
    return res.status(500).json({ error: err.message });
  }
}

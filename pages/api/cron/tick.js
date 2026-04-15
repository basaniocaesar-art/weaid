import { getPendingBookings, updateBooking } from "../../../lib/supabase.js";
import { notifyProviderNewJob } from "../../../lib/whatsapp.js";
import { getProvidersByService } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify cron secret in production
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const bookings = await getPendingBookings();
    let reminders = 0;
    let escalations = 0;

    for (const booking of bookings) {
      const ageMs = Date.now() - new Date(booking.created_at).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      // Re-notify providers for bookings pending > 1 hour with no provider
      if (booking.status === "pending" && !booking.provider_id && ageHours > 1) {
        const providers = await getProvidersByService(booking.service, booking.city);
        for (const p of providers) {
          await notifyProviderNewJob(p.phone, booking);
        }
        reminders++;
      }

      // Escalate bookings pending > 24 hours
      if (booking.status === "pending" && ageHours > 24) {
        await updateBooking(booking.id, { escalated: true });
        escalations++;
      }
    }

    return res.status(200).json({
      checked: bookings.length,
      reminders,
      escalations,
    });
  } catch (err) {
    console.error("[cron/tick]", err);
    return res.status(500).json({ error: err.message });
  }
}

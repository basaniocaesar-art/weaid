import { providerAcceptJob, providerRejectJob } from "../../../lib/orchestrator.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bookingId, providerId, action, reason } = req.body;

    if (!bookingId || !providerId || !action) {
      return res.status(400).json({ error: "Missing bookingId, providerId, or action" });
    }

    let booking;
    if (action === "accept") {
      booking = await providerAcceptJob(bookingId, providerId);
    } else if (action === "reject") {
      booking = await providerRejectJob(bookingId, providerId, reason);
    } else {
      return res.status(400).json({ error: "action must be 'accept' or 'reject'" });
    }

    return res.status(200).json({ bookingId: booking.id, status: booking.status });
  } catch (err) {
    console.error("[provider/respond]", err);
    return res.status(500).json({ error: err.message });
  }
}

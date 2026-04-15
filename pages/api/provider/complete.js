import { completeJob } from "../../../lib/orchestrator.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: "Missing bookingId" });
    }

    const booking = await completeJob(bookingId);

    return res.status(200).json({ bookingId: booking.id, status: "completed" });
  } catch (err) {
    console.error("[provider/complete]", err);
    return res.status(500).json({ error: err.message });
  }
}

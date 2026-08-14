import { updateBooking } from "../../../lib/supabase.js";

// Called BY the voice service (Lenz AI / Maya) to report a confirmation result.
// Secured with the shared VOICE_API_KEY. Body: { bookingId, role, confirmed }.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const secret = req.headers["x-voice-secret"];
    if (!process.env.VOICE_API_KEY || secret !== process.env.VOICE_API_KEY) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { bookingId, role, confirmed } = req.body;
    if (!bookingId || !role) return res.status(400).json({ error: "Missing bookingId or role" });

    const patch = role === "provider"
      ? { provider_confirmed: !!confirmed }
      : { customer_confirmed: !!confirmed };
    await updateBooking(bookingId, patch);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[booking/confirm-callback]", err);
    return res.status(500).json({ error: err.message });
  }
}

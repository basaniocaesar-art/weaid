// Receives outcome pings from the voice agent after a signup call
// (interested / not-interested / callback-requested / voicemail, etc.).
// Minimal for now: log it. Extend later to store leads + auto-send the link.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    console.log("[outreach/callback]", JSON.stringify(req.body || {}).slice(0, 500));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true }); // never fail the agent's webhook
  }
}

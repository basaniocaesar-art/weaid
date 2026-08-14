// Receives call events from the masking provider (Exotel/Edesy) — e.g. call
// connected/ended/failed. We just log for now; extend to record call outcomes.
export default async function handler(req, res) {
  try {
    console.log("[masking/callback]", JSON.stringify(req.body || req.query || {}).slice(0, 500));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[masking/callback]", err);
    return res.status(200).json({ ok: true }); // always 200 so the provider doesn't retry-storm
  }
}

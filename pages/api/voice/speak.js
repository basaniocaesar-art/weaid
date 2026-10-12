/**
 * Reads a concierge reply aloud in Sarvam's Indian voice (Bulbul v3).
 * POST { text, lang: "en-IN" | "ml-IN" } → audio/wav. The page falls back to the
 * browser's own voice whenever this fails (e.g. Sarvam out of credits).
 */
const SPEAKER = process.env.SARVAM_SPEAKER || "kavitha";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const key = process.env.SARVAM_API_KEY;
  if (!key) return res.status(503).json({ error: "voice off" });
  const body = typeof req.body === "object" && req.body ? req.body : {};
  const text = String(body.text || "").trim().slice(0, 600);
  /*
   * Every language Sarvam's bulbul:v3 speaks, not two of them.
   *
   * This used to be `ml-IN or else en-IN`, so asking for Hindi got an English
   * voice reading Devanagari, and Tamil, Telugu and Kannada were impossible.
   * AtmaSathi has handled the full set since September; this is the same list.
   */
  const SPOKEN = new Set(["en-IN", "hi-IN", "ml-IN", "ta-IN", "te-IN", "kn-IN", "bn-IN", "gu-IN", "mr-IN", "pa-IN", "od-IN"]);
  const lang = SPOKEN.has(body.lang) ? body.lang : "en-IN";
  if (!text) return res.status(400).json({ error: "no text" });
  try {
    const r = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_language_code: lang, speaker: SPEAKER, model: "bulbul:v3", pace: 1.05 }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.audios?.[0]) {
      console.warn("[voice-speak]", r.status, JSON.stringify(data).slice(0, 160));
      return res.status(502).json({ error: "voice unavailable" });
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(data.audios[0], "base64"));
  } catch (e) {
    console.warn("[voice-speak]", e.message);
    return res.status(502).json({ error: "voice unavailable" });
  }
}


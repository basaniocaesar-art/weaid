/**
 * Recorded speech → text with Sarvam saarika:v2.5 (POST raw audio, Content-Type audio/*).
 * Used where the browser's own speech recognition is missing or unreliable (iPhone Safari).
 * No language hint on purpose: with one, Sarvam translates instead of transcribing
 * (verified for AtmaSathi, 2 Sep 2026). The detected language comes back with the text.
 */
const MAX_BYTES = 8 * 1024 * 1024;

async function rawBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BYTES) throw new Error("too_large"); chunks.push(typeof c === "string" ? Buffer.from(c) : c); }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const key = process.env.SARVAM_API_KEY;
  if (!key) return res.status(503).json({ error: "unavailable" });
  let audio;
  try { audio = await rawBody(req); } catch { return res.status(413).json({ error: "too_large" }); }
  if (audio.length < 1500) return res.status(200).json({ transcript: "", error: "no_speech" });
  const type = String(req.headers["content-type"] || "audio/webm").split(";")[0];
  const ext = type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  try {
    const form = new FormData();
    form.append("file", new Blob([audio], { type }), `speech.${ext}`);
    form.append("model", "saarika:v2.5");
    form.append("language_code", "unknown");
    const r = await fetch("https://api.sarvam.ai/speech-to-text", { method: "POST", headers: { "api-subscription-key": key }, body: form });
    if (!r.ok) {
      console.error("[voice-listen]", r.status, (await r.text()).slice(0, 300));
      return res.status(503).json({ error: "unavailable" });
    }
    const d = await r.json();
    return res.status(200).json({ transcript: String(d.transcript || "").trim(), language: d.language_code || "en-IN" });
  } catch (e) {
    console.error("[voice-listen]", e.message);
    return res.status(503).json({ error: "unavailable" });
  }
}

export const config = { api: { bodyParser: false } };

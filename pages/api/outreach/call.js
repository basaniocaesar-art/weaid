import { placeSignupCall } from "../../../lib/voice.js";

// Admin-only: launch an outbound AI-voice signup campaign to a list of numbers.
// Gate with the same ADMIN_SECRET used elsewhere (sent as x-admin-secret).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = req.headers["x-admin-secret"];
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { numbers, language = "auto" } = req.body || {};
    if (!Array.isArray(numbers) || !numbers.length) {
      return res.status(400).json({ error: "Provide a list of phone numbers" });
    }

    // Clean, dedupe, keep valid 10+ digit numbers, cap the batch.
    const clean = [
      ...new Set(
        numbers
          .map((n) => String(n).replace(/[^\d+]/g, ""))
          .filter((n) => n.replace(/\D/g, "").length >= 10)
      ),
    ].slice(0, 200);

    if (!clean.length) return res.status(400).json({ error: "No valid phone numbers found" });

    const results = [];
    for (const raw of clean) {
      // Normalise to +91 for bare 10-digit Indian numbers.
      const digits = raw.replace(/\D/g, "");
      const to = raw.startsWith("+") ? raw : "+91" + digits.slice(-10);
      const r = await placeSignupCall({ to, language });
      results.push({ to, ok: !!r?.ok, error: r?.ok ? null : r?.error || r?.reason || "failed" });
    }

    const started = results.filter((r) => r.ok).length;
    return res.status(200).json({ requested: clean.length, started, failed: clean.length - started, results });
  } catch (err) {
    console.error("[outreach/call]", err);
    return res.status(500).json({ error: err.message });
  }
}

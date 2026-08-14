/* ── Voice confirmation calls ──
 * Provider-agnostic adapter. Points at your Lenz AI / "Maya" voice service
 * (ElevenLabs Conv AI + Sarvam Malayalam TTS) via a webhook you configure.
 *
 * Set VOICE_API_URL (+ optional VOICE_API_KEY). The voice service receives a
 * job context + which script to run, places the outbound call, confirms with
 * the person (press 1 / say yes), and calls our /api/booking/confirm-callback
 * to record the outcome. Without VOICE_API_URL it no-ops (logs + skips).
 */

const VOICE_API_URL = process.env.VOICE_API_URL;
const VOICE_API_KEY = process.env.VOICE_API_KEY;

// Kerala-first: default to Malayalam for Kerala cities, else English.
const ML_CITIES = ["kochi", "kozhikode", "calicut", "thrissur", "trivandrum", "thiruvananthapuram", "kollam", "kannur", "kottayam", "palakkad", "malappuram", "alappuzha"];
function pickLanguage(city) {
  return ML_CITIES.includes(String(city || "").toLowerCase()) ? "ml" : "en";
}

/**
 * Place a confirmation call.
 * @param {object} o
 * @param {string} o.to        phone number to call
 * @param {"customer"|"provider"} o.role
 * @param {object} o.booking   the booking record
 * @param {string} [o.language]
 */
export async function placeConfirmationCall({ to, role, booking, language }) {
  if (!VOICE_API_URL) {
    console.warn("[voice] VOICE_API_URL not set — skipping confirmation call to", to);
    return null;
  }
  if (!to) return null;

  const lang = language || pickLanguage(booking?.city);
  const when = booking?.timing_mode === "scheduled" && booking?.scheduled_at
    ? new Date(booking.scheduled_at).toISOString()
    : "asap";

  const payload = {
    to,
    role,                       // which script the agent runs
    language: lang,             // 'ml' | 'en'
    script: role === "provider" ? "confirm_provider_job" : "confirm_customer_booking",
    booking: {
      id: booking?.id,
      service: booking?.service,
      city: booking?.city,
      description: booking?.description || null,
      when,
      provider_name: booking?.provider_name || null,
      customer_name: role === "provider" ? booking?.customer_name : null,
      earnings: role === "provider" ? booking?.provider_earnings : null,
      total: role === "customer" ? booking?.total : null,
    },
    // The voice agent posts the yes/no result here.
    callback_url: `${process.env.NEXT_PUBLIC_URL || ""}/api/booking/confirm-callback`,
  };

  try {
    const res = await fetch(VOICE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(VOICE_API_KEY ? { Authorization: `Bearer ${VOICE_API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[voice] call request failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    return res.json().catch(() => ({ ok: true }));
  } catch (e) {
    console.error("[voice] call error:", e.message);
    return null;
  }
}

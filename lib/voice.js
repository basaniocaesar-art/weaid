/* ── Voice confirmation calls ──
 * Places an AI-agent call (your Lenz AI / "Maya") to confirm a job on both ends.
 *
 * Two modes via VOICE_PROVIDER:
 *   "sarvam"  → Sarvam Voice Agents (agent-based outbound call, variable payload)
 *   "generic" → POST the payload to any VOICE_API_URL you point at
 *
 * SARVAM setup (from the Sarvam dashboard → Deploy → "Deploy with code"):
 *   VOICE_PROVIDER=sarvam
 *   SARVAM_API_KEY=sk_...           (your key — env only, never in the repo)
 *   SARVAM_AGENT_ID=<your Maya agent id>
 *   SARVAM_OUTBOUND_URL=<the outbound-call endpoint shown in Deploy-with-code>
 *   SARVAM_FROM_NUMBER=<the number you rented (₹159/mo)>
 * Sarvam auth header is `api-subscription-key`. The dynamic job context is passed
 * as `variables` so the agent's script can read {service}, {when}, {description}…
 *
 * No-ops (returns null) if unconfigured, so nothing breaks before you plug it in.
 */

const PROVIDER = (process.env.VOICE_PROVIDER || (process.env.SARVAM_API_KEY ? "sarvam" : "generic")).toLowerCase();

// Kerala-first: Malayalam for Kerala cities, else English.
const ML_CITIES = ["kochi", "kozhikode", "calicut", "thrissur", "trivandrum", "thiruvananthapuram", "kollam", "kannur", "kottayam", "palakkad", "malappuram", "alappuzha"];
function pickLanguage(city) {
  return ML_CITIES.includes(String(city || "").toLowerCase()) ? "ml" : "en";
}

function buildVariables({ role, booking }) {
  const when = booking?.timing_mode === "scheduled" && booking?.scheduled_at
    ? new Date(booking.scheduled_at).toISOString()
    : "asap";
  return {
    role,
    booking_id: booking?.id,
    service: booking?.service,
    city: booking?.city,
    description: booking?.description || "",
    when,
    provider_name: booking?.provider_name || "",
    customer_name: role === "provider" ? booking?.customer_name || "" : "",
    earnings: role === "provider" ? booking?.provider_earnings || "" : "",
    total: role === "customer" ? booking?.total || "" : "",
  };
}

async function callSarvam({ to, role, booking, language }) {
  const url = process.env.SARVAM_OUTBOUND_URL;
  const key = process.env.SARVAM_API_KEY || process.env.VOICE_API_KEY;
  const agentId = process.env.SARVAM_AGENT_ID;
  if (!url || !key || !agentId) {
    console.warn("[voice] Sarvam not fully configured (SARVAM_OUTBOUND_URL/API_KEY/AGENT_ID) — skipping call to", to);
    return null;
  }
  const body = {
    agent_id: agentId,
    to,
    from: process.env.SARVAM_FROM_NUMBER || undefined,
    language,
    variables: buildVariables({ role, booking }),
    callback_url: `${process.env.NEXT_PUBLIC_URL || ""}/api/booking/confirm-callback`,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("[voice] Sarvam call failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.json().catch(() => ({ ok: true }));
}

async function callGeneric({ to, role, booking, language }) {
  const url = process.env.VOICE_API_URL;
  const key = process.env.VOICE_API_KEY;
  if (!url) {
    console.warn("[voice] VOICE_API_URL not set — skipping call to", to);
    return null;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      to,
      role,
      language,
      script: role === "provider" ? "confirm_provider_job" : role === "sales" ? "qualify_big_job" : "confirm_customer_booking",
      booking: buildVariables({ role, booking }),
      callback_url: `${process.env.NEXT_PUBLIC_URL || ""}/api/booking/confirm-callback`,
    }),
  });
  if (!res.ok) {
    console.error("[voice] generic call failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.json().catch(() => ({ ok: true }));
}

/**
 * Place a confirmation call. role: "customer" | "provider".
 */
export async function placeConfirmationCall({ to, role, booking, language }) {
  if (!to) return null;
  const lang = language || pickLanguage(booking?.city);
  try {
    return PROVIDER === "sarvam"
      ? await callSarvam({ to, role, booking, language: lang })
      : await callGeneric({ to, role, booking, language: lang });
  } catch (e) {
    console.error("[voice] call error:", e.message);
    return null;
  }
}

/* ── Outbound SIGNUP calls (AI cold-caller "Maya" → recruit providers) ──
 * Uses a SEPARATE Sarvam agent whose script is the signup pitch. Its behaviour
 * (what Maya says, objection handling) lives in the Sarvam dashboard; here we
 * only pass variables the script can read: {name}, {signup_url}, {brand}.
 *   SARVAM_SIGNUP_AGENT_ID=<the provider-signup agent id>  (falls back to SARVAM_AGENT_ID)
 * No-ops (returns skipped) if unconfigured.
 */
export async function placeSignupCall({ to, name, language = "auto", audience = "provider" }) {
  if (!to) return { ok: false, reason: "no_number" };
  const url = process.env.SARVAM_OUTBOUND_URL;
  const key = process.env.SARVAM_API_KEY || process.env.VOICE_API_KEY;
  const agentId = process.env.SARVAM_SIGNUP_AGENT_ID || process.env.SARVAM_AGENT_ID;
  if (!url || !key || !agentId) {
    console.warn("[voice] signup caller not configured (SARVAM_OUTBOUND_URL/API_KEY/SIGNUP_AGENT_ID) — skipping", to);
    return { ok: false, reason: "voice_not_configured", skipped: true };
  }
  const base = process.env.NEXT_PUBLIC_URL || "https://weaid.in";
  const body = {
    agent_id: agentId,
    to,
    from: process.env.SARVAM_FROM_NUMBER || undefined,
    language, // "auto" | "ml" | "en"
    variables: {
      audience,
      name: name || "",
      brand: "WeAid",
      signup_url: `${base}/provider-signup`,
    },
    callback_url: `${base}/api/outreach/callback`,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("[voice] signup call failed:", res.status, t);
      return { ok: false, status: res.status, error: t.slice(0, 200) };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

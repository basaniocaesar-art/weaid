/* ── Number masking (call privacy) ──
 * Provider-agnostic. Works with Exotel, Edesy, or any masking API via config:
 *   MASKING_API_URL   — the provider's create-session endpoint
 *   MASKING_API_KEY   — bearer token / api key
 *   MASKING_TTL_MIN   — how long the proxy stays live (default 720 = 12h)
 *
 * We request a proxy number that bridges the customer and the provider so
 * neither sees the other's real number (Uber-style). Used for BOOKED jobs only
 * (the directory stays direct-contact). No-ops (returns null) if unconfigured —
 * callers then fall back to the real number.
 */

const MASKING_API_URL = process.env.MASKING_API_URL;
const MASKING_API_KEY = process.env.MASKING_API_KEY;
const TTL_MIN = Number(process.env.MASKING_TTL_MIN || 720);

/**
 * Create a masked call session bridging two numbers.
 * @returns {Promise<{proxyNumber:string, sessionId:string}|null>}
 */
export async function createMaskedCall({ customerPhone, providerPhone, bookingId }) {
  if (!MASKING_API_URL) {
    console.warn("[masking] MASKING_API_URL not set — skipping (will use real number)");
    return null;
  }
  if (!customerPhone || !providerPhone) return null;

  try {
    const res = await fetch(MASKING_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MASKING_API_KEY ? { Authorization: `Bearer ${MASKING_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        // common field names across providers — send both stylings
        customer_number: customerPhone,
        provider_number: providerPhone,
        first_party: customerPhone,
        second_party: providerPhone,
        reference_id: bookingId,
        ttl_minutes: TTL_MIN,
        callback_url: `${process.env.NEXT_PUBLIC_URL || ""}/api/masking/callback`,
      }),
    });
    if (!res.ok) {
      console.error("[masking] create failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const d = await res.json().catch(() => ({}));
    const proxyNumber = d.proxy_number || d.virtual_number || d.number || d.masked_number || d.did || null;
    const sessionId = d.session_id || d.sid || d.id || null;
    if (!proxyNumber) {
      console.error("[masking] no proxy number in response:", JSON.stringify(d).slice(0, 200));
      return null;
    }
    return { proxyNumber, sessionId };
  } catch (e) {
    console.error("[masking] error:", e.message);
    return null;
  }
}

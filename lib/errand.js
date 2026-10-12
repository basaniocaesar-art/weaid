/**
 * Errand calls: ringing a business on a customer's behalf.
 *
 * WeAid makes these, not Lenz AI. A plumber in Kakkanad should hear from the
 * service brand that is actually arranging his work, not from a B2B umbrella
 * he has never heard of — and WeAid is where the job, the provider and the
 * money already live.
 *
 * Deliberately NOT lib/voice.js. That speaks the older "deploy with code"
 * shape (SARVAM_OUTBOUND_URL + SARVAM_AGENT_ID), which production has never
 * had the variables for, so every dispatch call has been skipping silently.
 * This is the same request that runs Maya's campaigns, verified 2026-09-30:
 *
 *   POST apps.sarvam.ai/api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds
 *
 * One agent serves every errand. It takes the job as a variable, so WeAid and
 * anything else that needs a call share it rather than each getting their own.
 */
const OUTBOUND = "https://apps.sarvam.ai/api/outbounds/v1";
const ANALYTICS = "https://apps.sarvam.ai/api/analytics/v1";

function cfg() {
  const key = process.env.SARVAM_VOICE_API_KEY;
  const org = process.env.SARVAM_ORG_ID;
  const ws = process.env.SARVAM_WORKSPACE_ID;
  const conn = process.env.SARVAM_CONNECTION_ID;
  if (!key || !org || !ws || !conn) return null;
  return { key, org, ws, conn };
}

function agent() {
  const id = process.env.ERRAND_AGENT_ID;
  const version = process.env.ERRAND_AGENT_VERSION;
  const from = process.env.ERRAND_FROM_NUMBER || process.env.SARVAM_FROM_NUMBER;
  if (!id || !version || !from) return null;
  return { id, version: Number(version), from };
}

export const errandReady = () => Boolean(cfg() && agent());

/**
 * Indian numbers only: "98470 12345", "098470 12345", "+91 98470 12345".
 * Anything else is refused rather than guessed, because a wrong guess rings a
 * stranger.
 */
export function indianMobile(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten =
    d.length === 10 ? d
    : d.length === 11 && d[0] === "0" ? d.slice(1)
    : d.length === 12 && d.startsWith("91") ? d.slice(2)
    : "";
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

/** Landlines too — a shop's listed number is often one. */
export function anyIndianNumber(raw) {
  const mobile = indianMobile(raw);
  if (mobile) return mobile;
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length >= 10 && d.length <= 13) return `+${d.startsWith("91") ? d : "91" + d.slice(-10)}`;
  return null;
}

/**
 * Ring somebody and have the agent do the talking.
 *
 * Every variable sent must be declared on the agent or Sarvam refuses the call
 * with a 422 naming it, which is why these three names are not negotiable.
 */
export async function placeErrandCall({ phone, task, onBehalfOf, callbackNumber, metadata }) {
  const c = cfg();
  const a = agent();
  if (!c || !a) {
    return {
      ok: false,
      error: "Calling is not switched on yet.",
      needs: [
        ...(!c ? ["SARVAM_VOICE_API_KEY", "SARVAM_ORG_ID", "SARVAM_WORKSPACE_ID", "SARVAM_CONNECTION_ID"] : []),
        ...(!a ? ["ERRAND_AGENT_ID", "ERRAND_AGENT_VERSION", "ERRAND_FROM_NUMBER"] : []),
      ],
    };
  }

  const to = anyIndianNumber(phone);
  if (!to) return { ok: false, error: `${phone} is not a number we can ring.` };
  if (!String(task || "").trim()) return { ok: false, error: "Nothing was said about what the call is for." };

  const body = {
    app_config: {
      app_id: a.id,
      app_version: a.version,
      connection_config: { connection_id: c.conn, agent_phone_number: a.from },
      agent_variables: {
        task: String(task).slice(0, 900),
        caller_name: String(onBehalfOf || "").slice(0, 80),
        callback_number: String(callbackNumber || "").slice(0, 20),
      },
    },
    user_config: { user_phone_number: to },
  };
  const hook = process.env.ERRAND_WEBHOOK_URL;
  if (hook) body.webhook_config = { url: hook, ...(metadata ? { metadata } : {}) };

  const res = await fetch(`${OUTBOUND}/orgs/${c.org}/workspaces/${c.ws}/outbounds`, {
    method: "POST",
    headers: { "X-API-Key": c.key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Said in full: a 422 names the variable the agent has not declared, and
    // that sentence is the whole diagnosis.
    return { ok: false, error: `Sarvam refused the call (${res.status}): ${text.slice(0, 300)}` };
  }
  return { ok: true, calling: to, attemptId: JSON.parse(text || "{}").attempt_id || "" };
}

/** What happened on a call, matched by the number that was rung. */
export async function errandOutcome({ phone, attemptId, hours = 6 }) {
  const c = cfg();
  const a = agent();
  if (!c || !a) return { ok: false, error: "Calling is not switched on yet." };

  const to = new Date();
  const from = new Date(to.getTime() - Math.min(72, Math.max(1, hours)) * 3600_000);
  const q = new URLSearchParams({
    start_datetime: from.toISOString().slice(0, 19) + "Z",
    end_datetime: to.toISOString().slice(0, 19) + "Z",
    limit: "200",
    offset: "0",
  });

  const res = await fetch(`${ANALYTICS}/${c.org}/${c.ws}/${a.id}/attempts?${q}`, {
    headers: { "X-API-Key": c.key },
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, error: `Could not read the call log (${res.status}).` };
  const items = (await res.json()).items || [];

  const ten = (v) => String(v || "").replace(/\D/g, "").slice(-10);
  const wantPhone = ten(phone);
  const wantId = String(attemptId || "");
  const hit =
    items.find(
      (x) =>
        (wantPhone && ten(x.user_contact || x.user_phone_number) === wantPhone) ||
        (wantId && [x.attempt_id, x.interaction_id, x.id].some((v) => String(v || "") === wantId)),
    ) || null;

  if (!hit) return { ok: true, found: false, looked_at: items.length };

  return {
    ok: true,
    found: true,
    rang: hit.user_contact || phone || null,
    outcome: hit.call_disposition || hit.status || "unknown",
    summary: hit.call_summary || null,
    agreed_time: hit.agreed_time || null,
    agreed_price: hit.agreed_price || null,
    seconds: hit.duration_seconds ?? hit.duration ?? null,
  };
}

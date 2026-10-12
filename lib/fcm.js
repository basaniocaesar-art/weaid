/**
 * Firebase Cloud Messaging (HTTP v1) — rings the WeAid Pro app with a job offer
 * even when the app is closed.
 *
 * Needs FCM_SERVICE_ACCOUNT: the Firebase service-account JSON, base64-encoded
 * (Firebase console → Project settings → Service accounts → Generate new key).
 * Without it every send is a no-op and pros still see offers by polling while
 * the app is open.
 */
import crypto from "crypto";
import { supabase } from "./supabase.js";

let cached = null; // { token, exp }

function account() {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    console.error("[fcm] FCM_SERVICE_ACCOUNT is not valid JSON/base64");
    return null;
  }
}
export const fcmConfigured = () => Boolean(account());

async function accessToken(sa) {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`token ${r.status}: ${d.error_description || d.error}`);
  cached = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return cached.token;
}

/**
 * Push to every device a provider has. `data` values must be strings.
 * Dead tokens (uninstalled app) are removed.
 */
export async function pushToProvider(providerId, { title, body, data = {}, channel = "offers" }) {
  const sa = account();
  if (!sa) return { sent: 0, skipped: "fcm_not_configured" };
  const { data: devices } = await supabase.from("provider_devices").select("fcm_token").eq("provider_id", providerId);
  if (!devices?.length) return { sent: 0, skipped: "no_devices" };
  const token = await accessToken(sa);
  let sent = 0;
  for (const d of devices) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: d.fcm_token,
          notification: { title, body },
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? "")])),
          android: {
            priority: "HIGH",
            ttl: "60s",
            notification: { channel_id: channel, sound: channel === "offers" ? "offer" : "default", default_vibrate_timings: true, visibility: "PUBLIC" },
          },
        },
      }),
    });
    if (r.ok) sent++;
    else {
      const t = await r.text();
      if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(t)) await supabase.from("provider_devices").delete().eq("fcm_token", d.fcm_token);
      else console.error("[fcm] send failed", r.status, t.slice(0, 200));
    }
  }
  return { sent };
}

/**
 * WeAid Pro app API. Auth = header X-Pro-Token (the provider's edit_token).
 *
 *   POST /api/pro/login   { phone, code }        6-digit code from the owner (Ops → Pros)
 *   POST /api/pro/signup  { name, phone, services[], area }   → waits for approval
 *   GET  /api/pro/me                             profile, ringing offers, my jobs, earnings
 *   POST /api/pro/state   { online, lat, lng }   heartbeat (every ~20 s while online)
 *   POST /api/pro/device  { token, platform }    FCM token for job pop-ups
 *   POST /api/pro/offer   { bookingId, accept }
 */
import crypto from "crypto";
import { supabase } from "../../../lib/supabase.js";
import { loginCode, linkToken, saveLocation, eventsFor, stageOf, STAGE_WORDS } from "../../../lib/jobs.js";
import { offersFor, acceptOffer, declineOffer, advanceOffers, niceService, areaOf, ONLINE_MINUTES } from "../../../lib/offers.js";
import { SERVICE_SLUGS, canonicalArea } from "../../../lib/concierge-tools.js";
import { sendAdminNotification } from "../../../lib/email.js";
import { opsLink } from "../../../lib/followup.js";
import { submitUpload, readCheck, statusFor, trustCard } from "../../../lib/verify.js";
import { owedBalance, PRO_OWED_LIMIT } from "../../../lib/payafter.js";

export const config = { api: { bodyParser: { sizeLimit: "4.5mb" } } };

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const FIELDS = "id,name,phone,services,areas,verified,available,lat,lng,last_seen_at,edit_token,source,claimed,kyc_status";

async function me(req) {
  const t = String(req.headers["x-pro-token"] || "");
  if (t.length < 16) return null;
  const { data } = await supabase.from("providers").select(FIELDS).eq("edit_token", t).is("removed_at", null).maybeSingle();
  return data || null;
}

const sameCode = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // The WeAid Pro app runs at https://localhost (Capacitor) and calls this
  // cross-origin. Auth is the X-Pro-Token header, never cookies, so * is safe.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pro-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  const action = req.query.action;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    if (action === "login") {
      const phone = ten(body.phone);
      const code = String(body.code || "").replace(/\D/g, "");
      if (phone.length !== 10 || code.length !== 6) return res.status(400).json({ error: "Enter your 10-digit mobile and the 6-digit code from WeAid." });
      const { data: rows } = await supabase.from("providers").select(FIELDS)
        .or(`phone.eq.+91${phone},phone.eq.${phone},whatsapp.eq.+91${phone}`).is("removed_at", null).limit(5);
      const p = (rows || []).find((r) => sameCode(loginCode(r.id), code));
      if (!p) return res.status(401).json({ error: "That number and code don't match. Ask WeAid for your app code." });
      let token = p.edit_token;
      if (!token) {
        token = crypto.randomUUID();
        await supabase.from("providers").update({ edit_token: token }).eq("id", p.id);
      }
      return res.status(200).json({ token, name: p.name });
    }

    if (action === "signup") {
      const phone = ten(body.phone);
      const services = (body.services || []).filter((s) => SERVICE_SLUGS.includes(s));
      if (!String(body.name || "").trim() || phone.length !== 10 || !services.length) return res.status(400).json({ error: "Add your name, 10-digit mobile and at least one service." });
      const { data: existing } = await supabase.from("providers").select("id").or(`phone.eq.+91${phone},phone.eq.${phone}`).is("removed_at", null).limit(1);
      if (existing?.length) return res.status(409).json({ error: "This number is already on WeAid. Ask WeAid for your app code to log in." });
      const token = crypto.randomUUID();
      const area = canonicalArea(body.area) || String(body.area || "").trim();
      const { data, error } = await supabase.from("providers").insert({
        name: String(body.name).trim().slice(0, 80), phone: `+91${phone}`, whatsapp: `+91${phone}`, city: "kochi",
        services, areas: area ? [area] : [], source: "signup", claimed: true, verified: false, available: false, edit_token: token,
      }).select("id,name").single();
      if (error) return res.status(500).json({ error: error.message });
      await sendAdminNotification(`[WeAid] New pro signed up in the app — ${data.name}`,
        `<p style="font-family:sans-serif"><b>${data.name}</b> +91${phone} — ${services.join(", ")}${area ? `, ${area}` : ""}.<br>Review their ID and approve them in <a href="${opsLink()}">WeAid Ops → Pros</a> before they get jobs.</p>`).catch(() => {});
      return res.status(200).json({ token, name: data.name, pending: true });
    }

    const pro = await me(req);
    if (!pro) return res.status(401).json({ error: "Please log in again." });

    if (action === "state") {
      const lat = Number(body.lat), lng = Number(body.lng);
      const patch = { available: Boolean(body.online), last_seen_at: new Date().toISOString() };
      if (Number.isFinite(lat) && Number.isFinite(lng)) Object.assign(patch, { lat, lng });
      await supabase.from("providers").update(patch).eq("id", pro.id);
      // Live position for any job they're on the way to.
      if (Number.isFinite(lat)) {
        const { data: jobs } = await supabase.from("bookings").select("id,provider_id").eq("provider_id", pro.id).eq("status", "accepted");
        for (const j of jobs || []) {
          const st = stageOf(j, await eventsFor(j.id));
          if (["on_the_way", "to_pickup", "in_transit"].includes(st)) await saveLocation(j, lat, lng);
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (action === "card") {
      const card = await trustCard(pro.id);
      if (!card) return res.status(403).json({ error: "Your WeAid ID appears once WeAid has verified you." });
      const { data: job } = await supabase.from("bookings").select("customer_name,service,scheduled_at").eq("provider_id", pro.id).eq("status", "accepted").order("scheduled_at", { ascending: true }).limit(1);
      return res.status(200).json({ ...card, phone: pro.phone, job: job?.[0] ? { customer: (job[0].customer_name || "").split(" ")[0], service: niceService(job[0].service) } : null });
    }

    if (action === "verify") {
      if (req.method === "GET") return res.status(200).json({ name: pro.name, ...statusFor(pro, await readCheck(pro.id)) });
      try {
        return res.status(200).json(await submitUpload(pro, { step: body.step, mime: body.mime, data: body.data, idType: body.idType }));
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    if (action === "device") {
      const token = String(body.token || "");
      if (token.length < 20) return res.status(400).json({ error: "bad token" });
      await supabase.from("provider_devices").upsert({ fcm_token: token, provider_id: pro.id, platform: String(body.platform || "android").slice(0, 10), updated_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    if (action === "offer") {
      if (!pro.verified) return res.status(403).json({ error: "Your account is waiting for WeAid's approval." });
      if (body.accept) {
        const r = await acceptOffer(pro, String(body.bookingId || ""));
        if (r.error) return res.status(409).json({ error: r.error });
        return res.status(200).json({ ok: true, bookingId: r.booking.id, jobToken: linkToken("pro", r.booking.id) });
      }
      await declineOffer(pro, String(body.bookingId || ""));
      return res.status(200).json({ ok: true });
    }

    if (action === "me") {
      if (pro.available && pro.verified) {
        await supabase.from("providers").update({ last_seen_at: new Date().toISOString() }).eq("id", pro.id);
        await advanceOffers().catch((e) => console.error("[pro/me] advance", e.message));
      }
      const offers = pro.verified && pro.available ? await offersFor(pro.id) : [];
      const { data: jobs } = await supabase.from("bookings")
        .select("id,service,scope,status,address,scheduled_at,description,provider_earnings,provider_id,provider_name,paid_at,payment_mode,total,amount,completed_at,created_at")
        .eq("provider_id", pro.id).order("created_at", { ascending: false }).limit(30);
      const mine = [];
      for (const j of jobs || []) {
        const stage = stageOf(j, await eventsFor(j.id));
        const payAfter = j.payment_mode === "pay_after";
        mine.push({ bookingId: j.id, jobToken: linkToken("pro", j.id), stage, words: STAGE_WORDS[stage], service: niceService(j.service), area: areaOf(j.address), when: j.scheduled_at, earnings: j.provider_earnings != null ? Math.round(j.provider_earnings) : null, completedAt: j.completed_at,
          // Pay-after: the pro collects from the customer; "unpaid" until the customer has paid (link or cash).
          payAfter, collect: payAfter ? Math.round(j.total || j.amount || 0) : 0, customerPaid: Boolean(j.paid_at) });
      }
      const done = mine.filter((j) => j.stage === "done");
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      // Cash commissions held for WeAid; past the limit, no new offers until it is settled.
      const owed = await owedBalance(pro.id);
      return res.status(200).json({
        verification: statusFor(pro, await readCheck(pro.id)),
        canCarpool: (pro.services || []).some((x) => x === "driver" || x === "carpool"),
        pro: { name: pro.name, phone: pro.phone, services: (pro.services || []).map(niceService), areas: pro.areas || [], approved: Boolean(pro.verified), online: Boolean(pro.available) && Date.now() - Date.parse(pro.last_seen_at || 0) < ONLINE_MINUTES * 60e3 },
        offers,
        active: mine.filter((j) => ["assigned", "on_the_way", "arrived"].includes(j.stage)),
        history: done.slice(0, 15),
        earnings: {
          today: done.filter((j) => (j.completedAt || "").slice(0, 10) === today).reduce((n, j) => n + (j.earnings || 0), 0),
          total: done.reduce((n, j) => n + (j.earnings || 0), 0),
          jobs: done.length,
          owed, owedLimit: PRO_OWED_LIMIT, blocked: owed > PRO_OWED_LIMIT,
          owedWords: owed > 0 ? `You're holding ₹${owed} of WeAid's share from cash jobs. It comes off your next payout${owed > PRO_OWED_LIMIT ? ", and new jobs are paused until it's under ₹" + PRO_OWED_LIMIT : ""}.` : "",
        },
      });
    }
    return res.status(404).json({ error: "unknown" });
  } catch (e) {
    console.error(`[pro/${action}]`, e);
    return res.status(500).json({ error: "Something went wrong." });
  }
}

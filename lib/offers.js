/**
 * Swiggy-style job offers for the WeAid Pro app.
 *
 * A paid job is offered to the nearest few pros who are ONLINE in the app
 * (toggle on, seen in the last 10 minutes), approved by WeAid (verified=true),
 * and do that trade. Their phones ring; the first to tap Accept gets it —
 * guarded by a conditional update, so two taps can never both win. Nobody
 * accepts within a minute → the next few. Still nobody after MAX_ROUNDS → the
 * owner is emailed to assign by hand in /ops.
 *
 * Offers are rows in booking_events (event "offer", data.providerId,
 * data.expires_at), so no extra table. Rounds advance whenever anybody polls
 * (pros' apps, the ops board, the tracking page) — no cron needed.
 */
import { supabase, getBooking } from "./supabase.js";
import { haversineKm } from "./geo.js";
import { logEvent, eventsFor, alertStep, jobLinks } from "./jobs.js";
import { pushToProvider } from "./fcm.js";
import { sendAdminNotification } from "./email.js";
import { dispatchRound, phoneDispatchOn } from "./dispatch.js";

export const OFFER_SECONDS = 60;
const PER_ROUND = 3;
const MAX_ROUNDS = 4;
const MAX_KM = 20;
export const ONLINE_MINUTES = 10;

const NICE = { electrical: "Electrician", plumbing: "Plumber", ac: "AC service", cleaning: "Cleaning", painting: "Painting", carpentry: "Carpentry", movers: "Packers & movers", pest_control: "Pest control", cctv: "CCTV", roofing: "Roofing", waterproofing: "Waterproofing", tiling: "Tiling", flooring: "Flooring", renovation: "Renovation", courier: "Courier", bike_ride: "Bike ride", cook: "Cook", maid: "Housemaid", babysit: "Babysitter", postnatal: "Mother & baby care", nursing: "Home nurse", eldercare: "Elder care", driver: "Driver" };
export const niceService = (s) => NICE[s] || String(s || "").replace(/_/g, " ");
export const areaOf = (address) => {
  const p = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  return p.length > 1 ? p[p.length - 2] : p[0] || "";
};

/** Open = paid (or marked paid), nobody assigned, not closed. */
export const isOpen = (b) => b && b.status === "pending" && !b.provider_id && !b.provider_name;

async function onlinePros(service) {
  const since = new Date(Date.now() - ONLINE_MINUTES * 60e3).toISOString();
  const { data, error } = await supabase.from("providers")
    .select("id,name,phone,lat,lng,areas,verified,available,last_seen_at")
    .eq("available", true).eq("verified", true).is("removed_at", null)
    .contains("services", [service]).gte("last_seen_at", since);
  if (error) { console.error("[offers] pros", error.message); return []; }
  return data || [];
}

function distanceKm(booking, p) {
  if (booking.customer_lat == null || p.lat == null) return null;
  return haversineKm(booking.customer_lat, booking.customer_lng, p.lat, p.lng);
}

/** Send the next round of offers. Returns how many pros were offered the job. */
export async function offerRound(booking, events) {
  events = events || (await eventsFor(booking.id));
  const offered = new Set(events.filter((e) => e.event === "offer").map((e) => e.data?.providerId));
  const declined = new Set(events.filter((e) => e.event === "declined").map((e) => e.data?.providerId));
  const round = events.filter((e) => e.event === "offer_round").length + 1;
  if (round > MAX_ROUNDS) return 0;

  const area = areaOf(booking.address);
  const pool = (await onlinePros(booking.service))
    .filter((p) => !offered.has(p.id) && !declined.has(p.id))
    .map((p) => ({ p, km: distanceKm(booking, p), near: area && (p.areas || []).includes(area) }))
    .filter((x) => x.km == null || x.km <= MAX_KM)
    .sort((a, b) => (a.km ?? (a.near ? 3 : 50)) - (b.km ?? (b.near ? 3 : 50)))
    .slice(0, PER_ROUND);

  if (!pool.length) return 0;
  const expires = new Date(Date.now() + OFFER_SECONDS * 1000).toISOString();
  await logEvent(booking.id, "offer_round", { round, count: pool.length });
  for (const { p, km } of pool) {
    await logEvent(booking.id, "offer", { providerId: p.id, expires_at: expires, km: km != null ? Math.round(km * 10) / 10 : null, round });
    pushToProvider(p.id, {
      title: booking.scope === "delivery" ? `New ${booking.service === "courier" ? "delivery" : "ride"}: pickup ${area || "nearby"}` : `${booking.scope === "quote" ? "Site visit" : "New job"}: ${niceService(booking.service)}${area ? ` in ${area}` : ""}`,
      body: `${booking.provider_earnings ? `Earn ₹${Math.round(booking.provider_earnings)}` : "Tap to see"}${km != null ? ` · ${km.toFixed(1)} km away` : ""} — accept within a minute`,
      data: { type: "offer", bookingId: booking.id },
    }).catch((e) => console.error("[offers] push", e.message));
  }
  return pool.length;
}

/** Called when a job becomes paid. */
export async function startOffers(bookingOrId) {
  const booking = typeof bookingOrId === "string" ? await getBooking(bookingOrId) : bookingOrId;
  if (!isOpen(booking)) return;
  const n = await offerRound(booking);
  if (!n) await noPros(booking);
}

/*
 * Nobody in the app took it. While WeAid has few pros, the owner takes the job
 * (FORWARD_TO_OWNER, on unless set to "false"): it is assigned to "WeAid team"
 * and the owner is emailed the pro's job link, which he can open himself or
 * forward on WhatsApp to one of his own workers.
 */
const OWNER_NAME = () => process.env.OWNER_PRO_NAME || "WeAid team";
const OWNER_PHONE = () => process.env.OWNER_PRO_PHONE || "+918590517355";

export async function noPros(booking, { afterCalls = false } = {}) {
  /*
   * Ring pros by phone before giving up on them. Nobody online in the app is
   * not nobody at all: most pros are not sitting in an app, but they do answer
   * the phone. The first round goes out here; cron/dispatch-tick widens it,
   * reads the answers, and comes back with afterCalls once it has run dry.
   */
  if (!afterCalls && phoneDispatchOn(booking)) {
    if ((booking.provider_candidates || []).length) return;   // already ringing round
    const r = await dispatchRound(booking).catch((e) => ({ skipped: e.message }));
    // Nobody on file to ring for this trade: straight to the owner, not 25 minutes of nothing.
    if (r.called || r.skipped === "another round is already ringing") return;
  }
  const events = await eventsFor(booking.id);
  if (events.some((e) => e.event === "no_pros")) return;
  await logEvent(booking.id, "no_pros", {});
  const ops = `${jobLinks(booking.id).ops}${process.env.OPS_KEY ? `#k=${encodeURIComponent(process.env.OPS_KEY)}` : ""}`;
  const area = areaOf(booking.address);
  const what = `${booking.scope === "quote" ? "Site visit" : "Job"}: ${niceService(booking.service)}${area ? ` in ${area}` : ""}`;

  if (process.env.FORWARD_TO_OWNER !== "false") {
    const { data: taken } = await supabase.from("bookings")
      .update({ provider_name: OWNER_NAME(), provider_phone: OWNER_PHONE(), status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", booking.id).eq("status", "pending").is("provider_id", null).is("provider_name", null).select("*").maybeSingle();
    if (taken) {
      await logEvent(booking.id, "assigned", { name: OWNER_NAME(), via: "forwarded_to_owner" });
      const link = jobLinks(booking.id).job;
      const when = booking.scheduled_at ? new Date(booking.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "as soon as possible";
      const share = `WeAid ${what.toLowerCase()}. ${booking.description || ""}\nWhen: ${when}\nOpen for the address, directions and steps: ${link}`;
      await sendAdminNotification(`[WeAid] 📲 Forwarded to you — ${what} — ${booking.customer_name || ""}`,
        `<div style="font-family:sans-serif"><p>No pro was online, so this ${booking.scope === "quote" ? "site visit" : "job"} is assigned to <b>${OWNER_NAME()}</b>.</p>
         <p><b>${what}</b><br>When: ${when}<br>${booking.description ? `Problem: ${String(booking.description).replace(/</g, "&lt;")}<br>` : ""}Customer: ${booking.customer_name || ""} ${booking.customer_phone || ""}<br>Address: ${String(booking.address || "").replace(/</g, "&lt;")}<br>${booking.provider_earnings ? `Pro earns: ₹${Math.round(booking.provider_earnings)}` : ""}</p>
         <p><a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open the job</a>
         &nbsp; <a href="https://wa.me/?text=${encodeURIComponent(share)}" style="display:inline-block;background:#25d366;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Forward to a worker on WhatsApp</a></p>
         <p style="color:#5b6573;font-size:13px">Whoever opens the link does the steps: "On my way", the customer's arrival code, ${booking.scope === "quote" ? "the quote form" : "photos"} and "Done". The customer's arrival code is on their page. To give it to an app pro instead, use Change pro in <a href="${ops}">Ops</a>.</p></div>`).catch(() => {});
      return;
    }
  }
  await sendAdminNotification(
    `[WeAid] ⚠️ No pro accepted — assign by hand — ${niceService(booking.service)} — ${booking.customer_name || ""}`,
    `<p style="font-family:sans-serif">Nobody in the WeAid Pro app accepted this ${niceService(booking.service)} job${area ? ` in ${area}` : ""}. Please assign someone in Ops.<br><br><a href="${ops}">Open WeAid Ops</a></p>`,
  ).catch(() => {});
}

/** Expired rounds → next round. Cheap; safe to call on every poll. */
export async function advanceOffers() {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { data: open } = await supabase.from("bookings").select("*")
    .eq("status", "pending").is("provider_id", null).is("provider_name", null).gte("paid_at", since).limit(20);
  for (const b of open || []) {
    const events = await eventsFor(b.id);
    const offers = events.filter((e) => e.event === "offer");
    if (!offers.length) { await startOffers(b); continue; }
    const live = offers.some((e) => Date.parse(e.data?.expires_at) > Date.now());
    if (live || events.some((e) => e.event === "no_pros")) continue;
    const n = await offerRound(b, events);
    if (!n) await noPros(b);
  }
}

/** Offers currently ringing for one pro. */
export async function offersFor(providerId) {
  const since = new Date(Date.now() - OFFER_SECONDS * 2000).toISOString();
  const { data: ev } = await supabase.from("booking_events").select("booking_id,data,created_at")
    .eq("event", "offer").gte("created_at", since).contains("data", { providerId });
  const live = (ev || []).filter((e) => Date.parse(e.data?.expires_at) > Date.now());
  if (!live.length) return [];
  const { data: books } = await supabase.from("bookings").select("*").in("id", live.map((e) => e.booking_id));
  const { data: dec } = await supabase.from("booking_events").select("booking_id").eq("event", "declined")
    .in("booking_id", live.map((e) => e.booking_id)).contains("data", { providerId });
  const declined = new Set((dec || []).map((d) => d.booking_id));
  return live
    .map((e) => ({ e, b: (books || []).find((x) => x.id === e.booking_id) }))
    .filter(({ e, b }) => isOpen(b) && !declined.has(e.booking_id))
    .map(({ e, b }) => ({
      bookingId: b.id, service: niceService(b.service), scope: b.scope, area: areaOf(b.address),
      description: b.description || "", when: b.scheduled_at, km: e.data?.km ?? null,
      earnings: b.provider_earnings != null ? Math.round(b.provider_earnings) : null,
      expiresAt: e.data.expires_at,
    }));
}

/** First tap wins. Returns the booking, or null if somebody else got there first. */
export async function acceptOffer(provider, bookingId) {
  const offers = await offersFor(provider.id);
  const graceOk = offers.some((o) => o.bookingId === bookingId);
  if (!graceOk) return { error: "This job is no longer available." };
  const { data, error } = await supabase.from("bookings")
    .update({ provider_id: provider.id, provider_name: provider.name, provider_phone: provider.phone, status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", bookingId).eq("status", "pending").is("provider_id", null)
    .select("*").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Another pro accepted this job first." };
  await logEvent(bookingId, "assigned", { providerId: provider.id, name: provider.name, via: "app" });
  await alertStep(data, "assigned", "Accepted in the WeAid Pro app.");
  return { booking: data };
}

export async function declineOffer(provider, bookingId) {
  await logEvent(bookingId, "declined", { providerId: provider.id });
  const b = await getBooking(bookingId);
  if (!isOpen(b)) return;
  // Everyone in this round said no → don't wait for the clock.
  const events = await eventsFor(bookingId);
  const lastRound = Math.max(0, ...events.filter((e) => e.event === "offer").map((e) => e.data?.round || 0));
  const inRound = events.filter((e) => e.event === "offer" && e.data?.round === lastRound).map((e) => e.data.providerId);
  const declined = new Set(events.filter((e) => e.event === "declined").map((e) => e.data?.providerId));
  if (inRound.every((id) => declined.has(id))) {
    const n = await offerRound(b, events);
    if (!n) await noPros(b);
  }
}

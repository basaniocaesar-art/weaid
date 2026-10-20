/**
 * Getting a paid job in front of somebody who will actually turn up.
 *
 * Until now a paid booking notified nobody. notifyProviderNewJob() sends a
 * WhatsApp message, but WHATSAPP_API_URL has never been set, so sendMessage()
 * logged "Missing env vars — skipping" and returned null. The customer paid,
 * the map polled, and no provider was ever told the job existed.
 *
 * WhatsApp is also the wrong first channel here. Nearly every provider in the
 * directory was imported from a public map listing: they have not opted in, and
 * cold template messages to numbers that never agreed is both against the rules
 * and a good way to lose the WhatsApp number the gym runs on. Ringing a
 * business's published landline to offer it paid work is ordinary commerce.
 *
 * The calls go through lib/errand.js, the same Sarvam request the errands use.
 * They used to go through lib/voice.js, whose "deploy with code" variables
 * production never had — so every round logged "not configured" and rang
 * nobody, for every customer who ever paid. One agent, one request shape, for
 * both: a booking differs from an errand only in the money and whose pros.
 *
 * So: when nobody in the WeAid Pro app takes a confirmed job (paid, or booked
 * pay-after — lib/payafter.js), call the nearest few.
 * Their answer is read back from the call log (settleDispatch), and the first
 * yes is awarded by the same atomic accept the dashboard uses. Nobody says yes,
 * widen the circle. Still nobody, hand it to the owner or refund — see
 * cron/dispatch-tick.
 *
 * SAFETY. This is a machine that rings real businesses, and the directory holds
 * 650 numbers nobody at those businesses gave us. It stays switched off until
 * DISPATCH_ENABLED is explicitly "true", it never rings the same provider twice
 * for one job, and it will not ring more than MAX_PROVIDERS people about any
 * single job however long it goes unanswered.
 */
import { supabase, getBooking } from "./supabase.js";
import { placeErrandCall, errandOutcome, errandReady } from "./errand.js";
import { withinCallingHours, releaseOthers } from "./errands.js";
import { logEvent, alertStep } from "./jobs.js";
import { providerAcceptJob } from "./orchestrator.js";
import { haversineKm } from "./geo.js";
import { withoutOverLimit } from "./payafter.js";

/** When outreach on this job was allowed to start: confirmed_at, or paid_at for rows older than the migration. */
export const confirmedAt = (b) => b.confirmed_at || b.paid_at || null;
const payAfter = (b) => b.payment_mode === "pay_after";

/** Off unless switched on, deliberately. An accident here is cold-calling 650 businesses. */
export const dispatchEnabled = () => process.env.DISPATCH_ENABLED === "true";

const PER_ROUND = Number(process.env.DISPATCH_PER_ROUND) || 3;
const MAX_PROVIDERS = Number(process.env.DISPATCH_MAX_PROVIDERS) || 12;
/** How long one round gets to produce a yes before the circle widens. */
export const ROUND_SECONDS = Number(process.env.DISPATCH_ROUND_SECONDS) || 120;
/** Nobody at all after this long and the job goes to the owner, or the money goes back. */
export const GIVE_UP_MINUTES = Number(process.env.DISPATCH_GIVE_UP_MINUTES) || 25;

/*
 * Can we ring pros about this job right now?
 *
 * Shop hours, like the errands — except an emergency, which the customer paid
 * extra for precisely because it cannot wait until morning. Outside those, the
 * job goes straight to the owner rather than sitting unrung until the refund.
 */
export const phoneDispatchOn = (booking) =>
  dispatchEnabled() && errandReady() && (booking?.slot === "emergency" || withinCallingHours());

const SERVICE_WORDS = { electrical: "electrical work", plumbing: "plumbing work", ac: "an AC service", cleaning: "a cleaning job", pest_control: "pest control", movers: "a house shift" };
const serviceWords = (s) => SERVICE_WORDS[s] || `${String(s || "").replace(/_/g, " ")} work`;
const areaOf = (address) => {
  const p = String(address || "").split(",").map((x) => x.trim()).filter(Boolean);
  return p.length > 1 ? p[p.length - 2] : p[0] || "";
};
const whenWords = (b) =>
  b.scheduled_at
    ? new Date(b.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })
    : "as soon as possible, today";

/*
 * What the agent says to a pro who has never heard of this job.
 *
 * Unlike an errand, nothing is negotiated: the price and the time are fixed by
 * the booking, whether the customer paid up front or pays after the job. So it
 * is a plain offer — the work, the area, the time, what they earn, and who
 * hands over the money — and a yes means yes to all of it.
 *
 * The address is deliberately not said. Until a pro has taken the job they
 * get the trade, the area, the time and what they earn; the customer's door is
 * none of their business if they say no.
 */
function offerTask(b) {
  const area = areaOf(b.address) || b.city || "Kochi";
  const earn = b.provider_earnings ? Math.round(b.provider_earnings) : 0;
  return [
    `WeAid has a ${payAfter(b) ? "confirmed" : "paid"} customer who needs ${serviceWords(b.service)} in ${area}.`,
    b.description ? `The customer says: ${String(b.description).slice(0, 300)}.` : "",
    `They want someone ${whenWords(b)}.`,
    earn && payAfter(b)
      ? `The customer pays ₹${Math.round(b.total || b.amount || 0)} after the job, in cash to the pro or by a WeAid payment link; the pro keeps ₹${earn} and WeAid's share is settled with WeAid.`
      : earn ? `The pro is paid ₹${earn} for it by WeAid; the customer has already paid.` : "",
    "Ask if they can take it at that time. The price and the time are fixed — do not negotiate either.",
    "If they can, say we will ring back in a few minutes to confirm with the address, because a few people"
      + " have been asked at once. Do not tell them the job is theirs.",
  ].filter(Boolean).join(" ");
}

/**
 * The next few people to ring about this job: right service, right city, free,
 * nearest first, and nobody who has already been rung about it.
 */
async function nextCandidates(booking, alreadyTried) {
  const { data, error } = await supabase
    .from("providers")
    .select("id, name, phone, lat, lng, areas, featured, rating")
    .eq("available", true)
    .is("removed_at", null)
    .contains("services", [booking.service])
    .ilike("city", booking.city || "kochi");
  if (error) throw error;

  const tried = new Set(alreadyTried);
  // A pro holding more of WeAid's cash commission than the limit is not rung.
  const eligible = await withoutOverLimit((data || []).filter((p) => !tried.has(p.id) && p.phone));
  return eligible
    .map((p) => ({
      p,
      // No customer coordinates means we cannot sort by distance; featured and
      // rating are then the only honest ordering we have.
      d: booking.customer_lat != null && p.lat != null
        ? haversineKm(booking.customer_lat, booking.customer_lng, p.lat, p.lng)
        : Infinity,
    }))
    .sort((a, b) => (a.d - b.d) || (b.p.featured - a.p.featured) || (b.p.rating - a.p.rating))
    .slice(0, PER_ROUND)
    .map((x) => x.p);
}

/**
 * Ring the next round for one booking. Safe to call repeatedly: it only ever
 * moves outward, and returns what it did so the caller can log it.
 */
export async function dispatchRound(bookingOrId) {
  const booking = typeof bookingOrId === "string" ? await getBooking(bookingOrId) : bookingOrId;
  if (!booking) return { skipped: "no such booking" };
  if (booking.status !== "pending" || booking.provider_id || booking.provider_name) return { skipped: `status is ${booking.status}` };
  // confirmed_at is the gate, not paid_at: a pay-after job is confirmed the
  // moment it is booked. (paid_at is kept for rows from before the migration.)
  if (!confirmedAt(booking)) return { skipped: "not confirmed" };

  const tried = booking.provider_candidates || [];
  if (tried.length >= MAX_PROVIDERS) return { skipped: "already asked enough people", exhausted: true, tried: tried.length };

  if (!phoneDispatchOn(booking)) {
    // Said out loud rather than passed over in silence: the whole point of this
    // module is that a job which reaches nobody should be obvious.
    console.warn("[dispatch] phone dispatch is off (DISPATCH_ENABLED, ERRAND_* or calling hours) — booking", booking.id, "is not being rung round");
    return { skipped: "dispatch disabled" };
  }

  const candidates = await nextCandidates(booking, tried);
  if (!candidates.length) return { skipped: "nobody left to ask", exhausted: true, tried: tried.length };

  /*
   * Claim the round before ringing. The app's polls and the minute cron can
   * both reach here for the same job at once; whoever moves
   * provider_notified_at first rings, the other rings nobody — otherwise the
   * same three plumbers get two calls about one job.
   */
  let claim = supabase.from("bookings")
    .update({ provider_candidates: [...tried, ...candidates.map((p) => p.id)], provider_notified_at: new Date().toISOString() })
    .eq("id", booking.id);
  claim = booking.provider_notified_at ? claim.eq("provider_notified_at", booking.provider_notified_at) : claim.is("provider_notified_at", null);
  const { data: claimed } = await claim.select("id");
  if (!claimed?.length) return { skipped: "another round is already ringing" };

  // Everyone in the round at once — they are racing for the job, and ringing
  // them one after another just means the third person hears about it last.
  const task = offerTask(booking);
  const calls = await Promise.all(
    candidates.map((p) =>
      placeErrandCall({ phone: p.phone, task, onBehalfOf: "WeAid", callbackNumber: process.env.ERRAND_FROM_NUMBER || "", metadata: { booking: booking.id } })
        .then((r) => ({ id: p.id, name: p.name, ok: r.ok, error: r.error || null }))
        .catch((e) => ({ id: p.id, name: p.name, ok: false, error: e.message }))
    )
  );
  await logEvent(booking.id, "phone_round", { round: Math.floor(tried.length / PER_ROUND) + 1, rang: calls.map((c) => c.name) });

  return { called: calls, round: Math.floor(tried.length / PER_ROUND) + 1 };
}

/**
 * Has anybody we rang said yes?
 *
 * Read from the call log, as the errands do, rather than waiting for the agent
 * to POST /api/voice/provider-accept — that needs a per-call secret and URL the
 * shared agent does not have. The first yes gets the job through the same
 * atomic accept the app uses, so a pro tapping Accept and a pro saying yes on
 * the phone can never both win.
 */
export async function settleDispatch(booking) {
  const ids = booking.provider_candidates || [];
  if (!ids.length || booking.status !== "pending" || booking.provider_id) return { pending: true };

  const { data: pros } = await supabase.from("providers").select("id, name, phone").in("id", ids);
  const since = (Date.now() - new Date(confirmedAt(booking) || booking.created_at).getTime()) / 3600_000;
  const agreed = [];
  for (const p of pros || []) {
    const out = await errandOutcome({ phone: p.phone, hours: Math.min(6, since + 0.5) }).catch(() => null);
    if (out?.found && String(out.outcome) === "agreed") agreed.push(p);
  }
  if (!agreed.length) return { pending: true };

  for (const p of agreed) {
    try {
      const won = await providerAcceptJob(booking.id, p.id);
      await logEvent(booking.id, "assigned", { providerId: p.id, name: p.name, via: "phone" });
      await alertStep(won, "assigned", "Said yes on the phone.");
      // Anybody else who said yes is holding a slot for a job they are not
      // getting. Same short call the errands make.
      await releaseOthers({
        id: booking.id,
        what: serviceWords(booking.service),
        tried: agreed.map((x) => x.phone),
        provider_phone: p.phone,
        candidates: agreed.map((x) => ({ name: x.name, phone: x.phone })),
      }).catch((e) => console.error("[dispatch] release", e.message));
      return { awarded: p.name };
    } catch (e) {
      if (e.code === "ALREADY_TAKEN") return { alreadyTaken: true };
      console.error("[dispatch] award failed", booking.id, e.message);
    }
  }
  return { pending: true };
}

/*
 * Tell both ends it is on, once a pro has the job.
 *
 * The pro gets the address and the customer's name and number now that they
 * have committed; the customer gets who is coming and when. The same agent the
 * errands use, given a different task — this replaces voice.js's "customer"
 * and "provider" confirmation calls, which never had an agent to ring with.
 */
export async function callBothEnds(booking) {
  if (!errandReady()) return { skipped: "calling is not configured" };
  const when = whenWords(booking);
  const from = process.env.ERRAND_FROM_NUMBER || "";
  const calls = [];
  if (booking.provider_phone) {
    calls.push(placeErrandCall({
      phone: booking.provider_phone,
      task: [
        `The WeAid job for ${serviceWords(booking.service)} is confirmed — it is theirs.`,
        `It is ${when}, at ${booking.address || "the customer's address (sent by message)"}.`,
        `The customer is ${booking.customer_name || "the customer"}, ${booking.customer_phone}.`,
        payAfter(booking)
          ? `The customer pays ₹${Math.round(booking.total || booking.amount || 0)} after the job — cash to the pro, or the WeAid link the customer gets; if it is cash, the pro marks it received on their WeAid job page.`
          : "",
        "Say the full details are also on WeAid by message. Keep it to twenty seconds and do not renegotiate anything.",
      ].join(" "),
      onBehalfOf: "WeAid", callbackNumber: from, metadata: { booking: booking.id, kind: "confirm_pro" },
    }));
  }
  if (booking.customer_phone) {
    calls.push(placeErrandCall({
      phone: booking.customer_phone,
      task: [
        `You are ringing ${booking.customer_name || "a customer"} about their WeAid booking for ${serviceWords(booking.service)}.`,
        `${booking.provider_name || "A WeAid pro"} is coming ${when}.`,
        payAfter(booking)
          ? `Say they will get the pro's details and a tracking link by message. Nothing to pay now: they pay ₹${Math.round(booking.total || booking.amount || 0)} after the job, in cash to the pro or by a link WeAid sends. Do not take any payment on this call.`
          : "Say they will get the pro's details and a tracking link by message. Do not ask for payment — it is already paid.",
      ].join(" "),
      onBehalfOf: "WeAid", callbackNumber: from, metadata: { booking: booking.id, kind: "confirm_customer" },
    }));
  }
  return Promise.all(calls.map((c) => c.catch((e) => ({ ok: false, error: e.message }))));
}

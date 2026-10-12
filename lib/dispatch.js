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
 * business's published landline to offer it paid work is ordinary commerce, and
 * lib/voice.js already speaks to Sarvam's agents in Malayalam for Kerala.
 *
 * So: when a job is paid for, call the nearest few. First to say yes gets it,
 * guarded by the same atomic accept the dashboard uses. Nobody says yes, widen
 * the circle. Still nobody, refund — see cron/dispatch-tick.
 *
 * SAFETY. This is a machine that rings real businesses, and the directory holds
 * 650 numbers nobody at those businesses gave us. It stays switched off until
 * DISPATCH_ENABLED is explicitly "true", it never rings the same provider twice
 * for one job, and it will not ring more than MAX_PROVIDERS people about any
 * single job however long it goes unanswered.
 */
import { supabase, getBooking, updateBooking } from "./supabase.js";
import { placeConfirmationCall } from "./voice.js";
import { haversineKm } from "./geo.js";

/** Off unless switched on, deliberately. An accident here is cold-calling 650 businesses. */
export const dispatchEnabled = () => process.env.DISPATCH_ENABLED === "true";

const PER_ROUND = Number(process.env.DISPATCH_PER_ROUND) || 3;
const MAX_PROVIDERS = Number(process.env.DISPATCH_MAX_PROVIDERS) || 12;
/** How long one round gets to produce a yes before the circle widens. */
export const ROUND_SECONDS = Number(process.env.DISPATCH_ROUND_SECONDS) || 120;
/** Nobody at all after this long and the money goes back. */
export const GIVE_UP_MINUTES = Number(process.env.DISPATCH_GIVE_UP_MINUTES) || 25;

/**
 * The next few people to ring about this job: right service, right city, free,
 * nearest first, and nobody who has already been rung about it.
 */
async function nextCandidates(booking, alreadyTried) {
  const { data, error } = await supabase
    .from("providers")
    .select("id, name, phone, lat, lng, areas, featured, rating")
    .eq("available", true)
    .contains("services", [booking.service])
    .ilike("city", booking.city || "kochi");
  if (error) throw error;

  const tried = new Set(alreadyTried);
  return (data || [])
    .filter((p) => !tried.has(p.id) && p.phone)
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
  if (booking.status !== "pending") return { skipped: `status is ${booking.status}` };
  if (!booking.paid_at) return { skipped: "not paid" };

  const tried = booking.provider_candidates || [];
  if (tried.length >= MAX_PROVIDERS) return { skipped: "already asked enough people", tried: tried.length };

  if (!dispatchEnabled()) {
    // Said out loud rather than passed over in silence: the whole point of this
    // module is that a job which reaches nobody should be obvious.
    console.warn("[dispatch] DISPATCH_ENABLED is not true — booking", booking.id, "has been paid for and nobody is being called");
    return { skipped: "dispatch disabled" };
  }

  const candidates = await nextCandidates(booking, tried);
  if (!candidates.length) return { skipped: "nobody left to ask", tried: tried.length };

  // Everyone in the round at once — they are racing for the job, and ringing
  // them one after another just means the third person hears about it last.
  const calls = await Promise.all(
    candidates.map((p) =>
      placeConfirmationCall({ to: p.phone, role: "offer", booking, provider: p })
        .then((r) => ({ id: p.id, name: p.name, ok: r !== null }))
        .catch((e) => ({ id: p.id, name: p.name, ok: false, error: e.message }))
    )
  );

  await updateBooking(booking.id, {
    provider_candidates: [...tried, ...candidates.map((p) => p.id)],
    provider_notified_at: new Date().toISOString(),
  });

  return { called: calls, round: Math.floor(tried.length / PER_ROUND) + 1 };
}

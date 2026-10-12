/**
 * Arranging a job by ringing round, and telling the customer when it is done.
 *
 * The shape comes from lib/dispatch.js, which solved this for paid bookings:
 * ring the nearest few AT ONCE because they are racing each other, give the
 * round a couple of minutes, widen if nobody bites, give up eventually. Ringing
 * shops one at a time means the third one hears about it last and the customer
 * waits three times as long.
 *
 * What is different here is who gets rung and who pays. A booking is a WeAid
 * provider at a WeAid price. An errand is a business somebody found on a map,
 * in a town we may not cover, with no account and no money through us. So this
 * is its own table and its own clock.
 *
 * The flow the customer actually experiences:
 *
 *   "my fan has stopped"          they say what, and WHEN they want it
 *   "I'll sort it and call you"   we stop holding them on the line
 *   ... we ring three shops ...
 *   "Cool Wing, 10 to 11, ₹500"   we ring THEM back with a name and a time
 *
 * That last call is the point. Nobody wants to sit watching a chat window
 * while a machine rings plumbers.
 */
import { supabase } from "./supabase.js";
import { placeErrandCall, errandOutcome, errandReady, anyIndianNumber } from "./errand.js";

const PER_ROUND = Number(process.env.ERRAND_PER_ROUND) || 3;
/*
 * Nobody is told "we couldn't find anyone" until at least ten have been asked.
 *
 * Three shops not answering at four in the afternoon means nothing — half of
 * them are up a ladder. Giving up at three would make us look useless when the
 * real answer was that we had barely started. So the clock can only end an
 * errand once MIN_TRIED have actually been rung, or the list is genuinely
 * exhausted.
 */
const MIN_TRIED = Number(process.env.ERRAND_MIN_TRIED) || 10;
const MAX_TRIED = Number(process.env.ERRAND_MAX_TRIED) || 15;
export const ROUND_SECONDS = Number(process.env.ERRAND_ROUND_SECONDS) || 150;
export const GIVE_UP_MINUTES = Number(process.env.ERRAND_GIVE_UP_MINUTES) || 45;

/** Have enough people been asked for "nobody could take it" to be honest? */
export function askedEnough(errand) {
  const tried = (errand.tried || []).length;
  const available = (errand.candidates || []).length;
  return tried >= Math.min(MIN_TRIED, available) || tried >= available;
}

/** Shops are rung during shop hours. Nobody wants a call about a fan at 11pm. */
const OPEN_HOUR = Number(process.env.ERRAND_OPEN_HOUR) || 8;
const CLOSE_HOUR = Number(process.env.ERRAND_CLOSE_HOUR) || 20;

export function withinCallingHours(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const h = ist.getUTCHours();
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

/* ----------------------------------------------------------------- starting */

export async function createErrand({
  what, area, city, wantedWindow, customerName, customerPhone, ownerRef, candidates,
}) {
  const phone = anyIndianNumber(customerPhone);
  if (!phone) return { error: `${customerPhone} is not a number we can ring back on.` };
  if (!String(what || "").trim()) return { error: "Nothing was said about what needs doing." };

  // Only the ones we can actually ring, best-reviewed first — that is the
  // order a person would try them in.
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((c) => ({
      name: String(c.name || "").slice(0, 120),
      phone: anyIndianNumber(c.phone),
      rating: Number(c.rating) || null,
      reviews: Number(c.reviews) || 0,
    }))
    .filter((c) => c.phone)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.reviews - a.reviews)
    .slice(0, MAX_TRIED);

  if (!list.length) return { error: "None of those businesses had a number we can ring." };

  const { data, error } = await supabase
    .from("errands")
    .insert({
      what: String(what).slice(0, 600),
      area: area || null,
      city: city || null,
      wanted_window: wantedWindow || null,
      customer_name: customerName || null,
      customer_phone: phone,
      owner_ref: ownerRef || null,
      candidates: list,
      status: "ringing",
    })
    .select()
    .single();
  if (error) return { error: error.message };

  // Straight into the first round, so "I'll sort it" is already true by the
  // time it has been said.
  const round = await ringRound(data);
  return { errand: data, round };
}

/* ------------------------------------------------------------------ ringing */

/** What the agent is told to do on the shop's phone. */
function taskFor(e) {
  const where = [e.area, e.city].filter(Boolean).join(", ");
  return [
    `A customer needs this done: ${e.what}.`,
    where ? `It is in ${where}.` : "",
    e.wanted_window ? `They would like it ${e.wanted_window}.` : "",
    // Availability, not a yes/no. A shop that cannot do Tuesday can usually do
    // Wednesday, and "no" to one slot is not "no" to the job — ending the call
    // there throws away somebody who would have taken it.
    "Ask what times they have free over the next few days, and whether the time"
      + " the customer wants is one of them. If it is not, get the nearest times"
      + " they CAN come.",
    "Then find out what it will cost.",
    "Do not turn the call into a yes or no about one slot.",
    /*
     * Said on every call, because a shop that thinks it has the job will hold
     * the slot — and three were rung at once, so at most one of them is right.
     * "We will ring you back to confirm" costs nothing and is simply true.
     */
    "Make clear this is not booked yet: say we are checking with the customer"
      + " and will ring back to confirm within a few minutes. Do not tell them"
      + " the job is theirs.",
  ].filter(Boolean).join(" ");
}

/**
 * Ring the next few. Safe to call repeatedly: it only ever moves outward, and
 * never rings a number that has already been tried for this errand.
 */
export async function ringRound(errand) {
  if (!errandReady()) return { skipped: "calling is not configured" };
  if (errand.status !== "ringing") return { skipped: `status is ${errand.status}` };
  if (!withinCallingHours()) return { skipped: "outside calling hours" };

  const tried = new Set(errand.tried || []);
  if (tried.size >= MAX_TRIED) return { skipped: "asked enough people", tried: tried.size };

  // Somebody the customer has already turned down is not asked again.
  const declined = new Set(errand.declined_phones || []);
  const next = (errand.candidates || [])
    .filter((c) => !tried.has(c.phone) && !declined.has(c.phone))
    .slice(0, PER_ROUND);
  if (!next.length) return { skipped: "nobody left to ask" };

  const task = taskFor(errand);
  // All at once: they are racing for the job.
  const calls = await Promise.all(
    next.map((c) =>
      placeErrandCall({
        phone: c.phone,
        task,
        onBehalfOf: errand.customer_name || "a customer",
        callbackNumber: process.env.ERRAND_FROM_NUMBER || "",
        metadata: { errand: errand.id },
      })
        .then((r) => ({ name: c.name, phone: c.phone, ok: r.ok, error: r.error || null }))
        .catch((e) => ({ name: c.name, phone: c.phone, ok: false, error: e.message })),
    ),
  );

  await supabase
    .from("errands")
    .update({
      tried: [...tried, ...next.map((c) => c.phone)],
      round_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", errand.id);

  return { called: calls, round: Math.floor(tried.size / PER_ROUND) + 1 };
}

/* ----------------------------------------------------------------- settling */

/**
 * Has anybody said yes?
 *
 * Read from the call log rather than a webhook, because the webhook is one
 * more thing to be configured wrong and this has to work either way. First
 * agreement wins; the ones still ringing are simply left — a shop that says
 * yes a minute later is told nothing, which is the one rough edge here and
 * the reason rounds are small.
 */
/*
 * Does what they offered match what the customer asked for?
 *
 * Free text on both sides — "tomorrow morning" against "tomorrow between 10
 * and 11" — so this is deliberately crude: do they share a day word and, if
 * both mention one, a part of the day. Crude is fine, because the only thing
 * riding on it is which of two people who BOTH said yes gets the job, and
 * being wrong means a slightly worse slot rather than a missed one.
 */
const DAY_WORDS = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/g;
const PART_WORDS = /\b(morning|afternoon|evening|night|noon)\b/g;

function matchesWanted(offered, wanted) {
  if (!wanted || !offered) return false;
  const a = String(offered).toLowerCase();
  const b = String(wanted).toLowerCase();
  const days = (t) => new Set(t.match(DAY_WORDS) || []);
  const parts = (t) => new Set(t.match(PART_WORDS) || []);

  const da = days(a), db = days(b);
  const sharedDay = [...db].some((d) => da.has(d));
  if (db.size && !sharedDay) return false;

  const pa = parts(a), pb = parts(b);
  if (pb.size && pa.size && ![...pb].some((p) => pa.has(p))) return false;
  return sharedDay || (!db.size && !!pb.size && [...pb].some((p) => pa.has(p)));
}

/**
 * Has anybody said yes?
 *
 * Read from the call log rather than a webhook, because the webhook is one
 * more thing to be configured wrong and this has to work either way.
 *
 * All the finished calls in this pass are gathered before one is chosen,
 * rather than taking the first "agreed" in list order. Three were rung
 * together and they usually finish together, so "first to agree" is nearly
 * always a tie — and when it is a tie, the one who can come when the customer
 * actually asked should win. Taking whoever happened to be first in the array
 * would hand the job to somebody offering next Friday while the shop that
 * could come tomorrow loses.
 */
export async function settle(errand) {
  const tried = errand.tried || [];
  if (!tried.length) return { pending: true };

  const agreed = [];
  for (const phone of tried) {
    const out = await errandOutcome({ phone, hours: 2 }).catch(() => null);
    if (!out?.found) continue;
    if (String(out.outcome) !== "agreed") continue;
    const who = (errand.candidates || []).find((c) => c.phone === phone);
    agreed.push({ phone, name: who?.name || null, out });
  }
  if (!agreed.length) return { pending: true };

  // Someone who can come when they asked, else the first who said yes.
  const best =
    agreed.find((a) => matchesWanted(a.out.agreed_time, errand.wanted_window)) || agreed[0];

  const { data } = await supabase
    .from("errands")
    .update({
      status: "arranged",
      provider_name: best.name,
      provider_phone: best.phone,
      agreed_time: best.out.agreed_time || null,
      agreed_price: best.out.agreed_price || null,
      summary: best.out.summary || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", errand.id)
    .eq("status", "ringing")       // whoever gets here first wins
    .select()
    .single();

  if (data) {
    return {
      arranged: data,
      // Said plainly so the call back to the customer can be honest about it.
      asAsked: matchesWanted(best.out.agreed_time, errand.wanted_window),
      alsoOffered: agreed.filter((a) => a.phone !== best.phone).length,
    };
  }
  return { pending: false, alreadyTaken: true };
}

/**
 * Tell the ones who said yes but did not get it.
 *
 * Three shops are rung at once and more than one often says yes. The first to
 * agree wins — that is the point — but the others have just blocked out
 * Wednesday morning for a job they are not getting, and nobody has told them.
 *
 * These are businesses we want ringing back one day. Leaving a tradesman
 * holding a slot for a customer who never arrives is how you stop being able
 * to get anyone on the phone.
 *
 * Usually nobody, occasionally one. Cheap, and the alternative is rude.
 */
export async function releaseOthers(errand) {
  if (!errandReady()) return { skipped: "calling is not configured" };
  const winner = errand.provider_phone;
  const others = (errand.tried || []).filter((p) => p !== winner);
  if (!others.length) return { released: [] };

  const released = [];
  for (const phone of others) {
    const out = await errandOutcome({ phone, hours: 2 }).catch(() => null);
    // Only the ones who actually committed. Somebody who said no, or never
    // answered, does not need a second call.
    if (!out?.found || String(out.outcome) !== "agreed") continue;

    const who = (errand.candidates || []).find((c) => c.phone === phone);
    const r = await placeErrandCall({
      phone,
      task:
        `You rang them a short while ago about this job: ${errand.what}. They said they could do it.`
        + ` Someone else got there first, so it is covered. Tell them that, thank them for coming back`
        + ` to us quickly, say we will ring them for the next one, and keep it to fifteen seconds.`
        + ` Do not apologise at length and do not offer them anything.`,
      onBehalfOf: "WeAid",
      callbackNumber: process.env.ERRAND_FROM_NUMBER || "",
      metadata: { errand: errand.id, kind: "released" },
    }).catch(() => ({ ok: false }));
    if (r.ok) released.push(who?.name || phone);
  }
  return { released };
}

/**
 * Ring the provider back and tell them it is on.
 *
 * The other half of "we'll confirm with the customer". A shop told that and
 * then never rung again learns quickly not to bother answering.
 */
export async function confirmProvider(errand) {
  if (errand.confirmed_at) return { skipped: "already confirmed" };
  if (!errandReady()) return { skipped: "calling is not configured" };
  if (!errand.provider_phone) return { skipped: "nobody to confirm" };

  const where = [errand.area, errand.city].filter(Boolean).join(", ");
  const r = await placeErrandCall({
    phone: errand.provider_phone,
    task: [
      `You rang them earlier about this job: ${errand.what}.`,
      where ? `It is in ${where}.` : "",
      `They said they could come ${errand.agreed_time || "at the time discussed"}.`,
      "The customer has confirmed. Tell them the job is on and that time is confirmed.",
      `Give them the customer's name and number: ${errand.customer_name || "the customer"}, ${errand.customer_phone}.`,
      "Keep it to twenty seconds. Do not renegotiate the price.",
    ].filter(Boolean).join(" "),
    onBehalfOf: "WeAid",
    callbackNumber: process.env.ERRAND_FROM_NUMBER || "",
    metadata: { errand: errand.id, kind: "confirm" },
  });
  if (!r.ok) return { error: r.error };

  await supabase
    .from("errands")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", errand.id);
  return { confirming: r.calling };
}

/**
 * What did the customer say when we rang them back?
 *
 * Same call log, same agent, same output variables — the confirmation call is
 * just another errand, so "agreed" means the time suits them.
 */
export async function readCustomerAnswer(errand) {
  if (!errand.customer_told_at) return { pending: true };
  const out = await errandOutcome({ phone: errand.customer_phone, hours: 3 }).catch(() => null);
  if (!out?.found || !out.outcome || out.outcome === "unknown") return { pending: true };
  return { said: String(out.outcome), summary: out.summary || null };
}

/**
 * The customer did not want that time. Put the errand back out, without the
 * shop they just turned down.
 */
export async function reopen(errand) {
  const declined = [...(errand.declined_phones || []), errand.provider_phone].filter(Boolean);
  const { data } = await supabase
    .from("errands")
    .update({
      status: "ringing",
      customer_said: "refused",
      declined_phones: declined,
      provider_name: null, provider_phone: null,
      agreed_time: null, agreed_price: null, summary: null,
      customer_told_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", errand.id)
    .select()
    .single();
  return data || null;
}

/**
 * Ring the customer back and tell them it is sorted.
 *
 * The same agent, with a different job — which is the whole reason it takes
 * the task as a variable rather than having a script baked in.
 */
export async function tellCustomer(errand) {
  if (errand.customer_told_at) return { skipped: "already told" };
  if (!errandReady()) return { skipped: "calling is not configured" };

  const asAsked = matchesWanted(errand.agreed_time, errand.wanted_window);
  const bits = [
    `You are ringing ${errand.customer_name || "a customer"} back about the job they asked us to arrange: ${errand.what}.`,
    `${errand.provider_name || "Someone"} has agreed to do it.`,
    /*
     * Lead with the mismatch rather than burying it.
     *
     * Somebody who asked for tomorrow morning and is told "they are coming
     * Thursday" in a cheerful voice has to work out for himself that he did
     * not get what he asked for. Saying it first is both more honest and
     * shorter, and it is the moment he can say no.
     */
    !asAsked && errand.wanted_window
      ? `They cannot do ${errand.wanted_window}, which is what the customer wanted. Say that first.`
      : "",
    errand.agreed_time ? `The time they can come is ${errand.agreed_time}.` : "",
    errand.agreed_price ? `The charge is ${errand.agreed_price}.` : "",
    !asAsked && errand.wanted_window
      ? "Ask whether that works instead. If it does not, say we will keep looking and ring back."
      : "Ask if the time suits.",
    "Say we will send the details by message.",
    "Do not ask them for payment and do not agree to anything else.",
  ].filter(Boolean);

  const r = await placeErrandCall({
    phone: errand.customer_phone,
    task: bits.join(" "),
    onBehalfOf: "WeAid",
    callbackNumber: process.env.ERRAND_FROM_NUMBER || "",
    metadata: { errand: errand.id, kind: "confirmation" },
  });
  if (!r.ok) return { error: r.error };

  await supabase
    .from("errands")
    .update({ customer_told_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", errand.id);
  return { calling: r.calling };
}

export async function getErrand(id) {
  const { data } = await supabase.from("errands").select("*").eq("id", id).single();
  return data || null;
}

/** Everything still in flight, for the clock to advance. */
export async function openErrands(limit = 30) {
  const { data } = await supabase
    .from("errands")
    .select("*")
    .in("status", ["ringing", "arranged"])
    .order("created_at", { ascending: true })
    .limit(limit);
  return data || [];
}

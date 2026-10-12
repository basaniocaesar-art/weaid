/**
 * POST /api/agent — WeAid, as something another AI can operate.
 *
 * Lenz AI is the only caller: a customer talks to the assistant there, and it
 * reaches in here to quote a job, find who is near and book it. That customer
 * has no WeAid account and never will, which is the point — one login, one
 * balance, every business behind it.
 *
 * Deliberately the same tool set WeAid's own concierge uses, not a parallel
 * API. Two definitions of "what it costs to get a tap fixed" would disagree
 * within a fortnight, and the one the customer was quoted would be the wrong
 * one.
 *
 *   { op: "tools" }                              → { tools: [...] }
 *   { op: "call", name, input, context }         → { result } | { error }
 *
 * Auth is a single shared key in WEAID_AGENT_KEY. It fails closed: with no key
 * set, nothing can call in. An unauthenticated endpoint here would let anyone
 * book jobs against real providers.
 */
import crypto from "crypto";
import { TOOLS, runTool } from "../../lib/concierge-tools";
import { placeErrandCall, errandOutcome, errandReady } from "../../lib/errand";

/*
 * Where WeAid actually operates.
 *
 * This matters here and nowhere else. WeAid's own site is a Kochi site, so
 * its concierge never had to ask; this endpoint can be reached from anywhere,
 * and find_providers answers an out-of-area request by telling the caller to
 * "carry on: quote it, take the details and book it", because in Kochi the
 * team really does arrange it by hand when nobody is listed.
 *
 * Followed outside Kochi, that would have us taking money for a job in a city
 * with no providers, no team and no way to do it. So the boundary is stated
 * once, here, at the surface that created the problem.
 *
 * WEAID_SERVED_CITIES widens it the day that changes.
 */
const SERVED = new Set(
  (process.env.WEAID_SERVED_CITIES || "kochi,ernakulam")
    .split(",").map((c) => c.trim().toLowerCase()).filter(Boolean),
);

/** Kochi's own localities, so "Kakkanad" is not mistaken for another city. */
const KOCHI_WORDS = /kochi|cochin|ernakulam|kakkanad|edappally|vyttila|kaloor|aluva|thrippunithura|thripunithura|fort kochi|mattancherry|palarivattom|thevara|maradu|kalamassery|thrikkakara|panampilly|angamaly|perumbavoor|muvattupuzha|kothamangalam|piravom|paravur|cheranallur|vypin|kumbalangi|chottanikkara|nedumbassery/i;

function outOfArea(input) {
  const city = String(input?.city || "").trim().toLowerCase();
  const area = String(input?.area || "").trim();
  if (!city) return false;                       // not stated: let the tool ask
  if (SERVED.has(city)) return false;
  if (KOCHI_WORDS.test(city) || KOCHI_WORDS.test(area)) return false;
  return city;
}

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
/*
 * Ringing somebody, which the website's concierge has no tool for.
 *
 * It belongs to WeAid rather than to the hub that asks for it: the number the
 * shop sees is a WeAid number, the job and the money are already here, and a
 * plumber should hear from the service brand arranging his work rather than
 * from a B2B umbrella he has never heard of.
 *
 * These two are NOT subject to the Kochi boundary below. Quoting from our own
 * price list or promising our own vetted providers outside Kochi would be a
 * lie; ringing a business that somebody has already found, anywhere, is just a
 * phone call.
 */
const CALL_TOOLS = [
  {
    name: "place_call",
    description:
      "Ring a business on the customer's behalf and have the AI handle the call — booking a repair, chasing a delivery, asking whether something is in stock. Say what the call is for; the agent does the talking. Works anywhere, not only Kochi.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["phone", "task"],
      properties: {
        phone: { type: "string", description: "The number to ring." },
        task: {
          type: "string",
          description:
            "What the call is for, in one or two sentences, as the agent should understand it: \"Ask if they can send someone to fix a ceiling fan in Kakkanad tomorrow morning, and what it will cost.\"",
        },
        on_behalf_of: { type: "string", description: "The customer's name, so the agent can say who it is calling for." },
        callback_number: { type: "string", description: "A number the business can call back on." },
      },
    },
  },
  {
    name: "check_call",
    description:
      "Find out what happened on a call we made — whether they answered, what was agreed, when, and what it will cost. Give the number that was rung.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        phone: { type: "string", description: "The number that was rung. The easiest way to find the call." },
        attempt_id: { type: "string", description: "The id place_call returned, if you still have it." },
        hours: { type: "integer", description: "How far back to look. Default 6." },
      },
    },
  },
];

const isCallTool = (name) => CALL_TOOLS.some((t) => t.name === name);

function keyOk(req) {
  const expected = process.env.WEAID_AGENT_KEY;
  if (!expected) return false;
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!given || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!keyOk(req)) return res.status(401).json({ error: "unauthorised" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const origin = process.env.SITE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

  if (body.op === "tools") {
    // Anthropic's spelling, because that is what the calling agent feeds
    // straight to the model.
    return res.status(200).json({
      tools: [
        ...TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        // Only offered once a committed agent and a number exist, so the
        // caller is never told we can ring somebody and then cannot.
        ...(errandReady() ? CALL_TOOLS : []),
      ],
    });
  }

  if (body.op === "call") {
    const name = String(body.name || "");

    if (isCallTool(name)) {
      const input = body.input || {};
      try {
        if (name === "place_call") {
          const r = await placeErrandCall({
            phone: input.phone,
            task: input.task,
            onBehalfOf: input.on_behalf_of,
            callbackNumber: input.callback_number,
          });
          if (!r.ok) return res.status(200).json({ error: r.error, ...(r.needs ? { needs: r.needs } : {}) });
          return res.status(200).json({
            result: {
              calling: r.calling,
              attempt_id: r.attemptId,
              note: "The call is being placed. Give it a minute, then check_call will say what was agreed.",
            },
          });
        }
        const r = await errandOutcome({
          phone: input.phone,
          attemptId: input.attempt_id,
          hours: Number(input.hours) || 6,
        });
        if (!r.ok) return res.status(200).json({ error: r.error });
        if (!r.found) {
          return res.status(200).json({
            result: {
              found: false,
              note: "No call to that number yet. It may still be connecting — wait a moment and look again.",
            },
          });
        }
        return res.status(200).json({
          result: {
            ...r,
            note: r.summary
              ? "Tell them what was agreed in a sentence."
              : "No summary yet, so the call may still be going. Say that rather than guessing.",
          },
        });
      } catch (e) {
        console.error("[agent]", name, e?.message);
        return res.status(200).json({ error: String(e?.message || e).slice(0, 300) });
      }
    }

    if (!TOOLS.some((t) => t.name === name)) {
      return res.status(200).json({ error: `WeAid has no capability called ${name}.` });
    }

    /*
     * The pin travels in `context`, not in the model's arguments.
     *
     * Same reason the browser holds it rather than the conversation: a
     * latitude carried through three turns of speech comes back subtly wrong
     * and sends a plumber to the wrong street.
     */
    const c = body.context && typeof body.context === "object" ? body.context : {};
    const context = {
      lat: Number.isFinite(Number(c.lat)) ? Number(c.lat) : null,
      lng: Number.isFinite(Number(c.lng)) ? Number(c.lng) : null,
      address: typeof c.address === "string" ? c.address.slice(0, 300) : "",
    };

    const elsewhere = outOfArea(body.input);
    if (elsewhere) {
      return res.status(200).json({
        result: {
          out_of_area: true,
          city: elsewhere,
          note: `WeAid only works in Kochi, so it cannot take a job in ${elsewhere}. `
              + `Do not quote or book this. Find a real local business there instead and offer to ring them.`,
        },
      });
    }

    try {
      const result = await runTool(name, body.input || {}, origin, context);
      return res.status(200).json({ result });
    } catch (e) {
      console.error("[agent]", name, e?.message);
      return res.status(200).json({ error: String(e?.message || e).slice(0, 300) });
    }
  }

  return res.status(400).json({ error: 'op must be "tools" or "call"' });
}

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
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    });
  }

  if (body.op === "call") {
    const name = String(body.name || "");
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

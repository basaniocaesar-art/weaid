/**
 * WeAid's concierge: describe the problem, get a price, book it, pay.
 *
 * The site had a search box over seventeen keyword lists. Somebody who types
 * "my tap is leaking" finds plumbing by accident, because the word "tap" is in
 * the list. Somebody who types "my mother needs someone with her during the
 * day" finds nothing, because that is how a person describes a problem and not
 * how a category is named.
 *
 * So: one conversation, in whatever language they write in, that reads the
 * problem, quotes from the same pricing the checkout uses, shows real providers
 * from the directory, and books.
 *
 * Streams server-sent events, same shape as MunchPies so the two can share a
 * front end later:  session | delta {text} | done {reply} | error
 */
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool, SERVICE_SLUGS } from "../../lib/concierge-tools.js";

const MODEL = process.env.CONCIERGE_MODEL || "claude-sonnet-5-5";
const MAX_TOOL_ROUNDS = 5;
const MAX_MESSAGE = 1500;

const client = new Anthropic();

const SYSTEM = `You are the WeAid concierge. WeAid finds trusted local people for jobs around the house, and books them.

HOW TO BE
Warm, quick, practical. One or two sentences. Ask ONE question at a time, never a form.
You are talking to somebody with a problem, not browsing a catalogue. Get to the price and the booking.

LANGUAGE
Reply in whatever language they write in: English, Malayalam, Hindi, Tamil, Manglish. Switch when they switch, without being asked and without mentioning it. Keep the ordinary English words people actually use for these things: AC, geyser, plumber, booking, UPI.

WHAT YOU CAN BOOK
These service slugs and no others: ${SERVICE_SLUGS.join(", ")}.
Read the problem and pick the slug yourself. "Tap is leaking" is plumbing. "Fan not working" is electrical. "Someone to sit with my mother" is nursing or eldercare. If it genuinely fits none of them, say so plainly and offer to take their details for a callback.

PRICE
Never say a number you have not got from quote_job. The website prices the same way, and a concierge that quotes differently from the checkout is worse than no concierge.
Scope is yours to judge from what they describe: small is one item or one room, medium a few, large a whole house or a full day. Say which you assumed, in plain words, so they can correct it: "I have priced that as a small job, one tap."
Slot: emergency if they need it today or tonight, weekend for Saturday and Sunday, evening after 6pm, otherwise standard. Emergency costs half again, so say that before you apply it, not after.

PROVIDERS
Call find_providers before saying anybody is available. If it returns nobody, say nobody is listed for that yet, offer a callback, and do not invent a name.

BOOKING
Before book_job you need: what the job is, their name, their mobile, and an address somebody could find the door with. Collect them one at a time, in that order, and never all at once.
After booking, give the amount and the payment link, and say plainly that the job is not booked until it is paid.

PEOPLE WHO DO THE WORK
Some callers are tradespeople, not customers. "I am an electrician" is a different conversation. Use register_provider, and tell them the true thing: new listings sit at the front of search for thirty days, free.

WHAT NOT TO DO
Do not promise a time a provider has not agreed to. Do not say anyone is verified unless the data says verified.
Do not quote, invent or estimate anything the tools did not give you. If you do not know, say so and offer a callback. An honest "I will find out" costs you nothing; a wrong price costs a customer.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = req.body || {};
  const message = String(body.message || "").trim().slice(0, MAX_MESSAGE);
  if (!message) return res.status(400).json({ error: "Say something first." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "concierge_not_configured" });
  }

  const origin =
    process.env.SITE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

  // The browser holds the thread. No session store yet: this is the first
  // version, and a half-built one would be a thing to migrate later.
  const history = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  const messages = [...history, { role: "user", content: message }];

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    let reply = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
      stream.on("text", (t) => {
        reply += t;
        emit("delta", { text: t });
      });
      const response = await stream.finalMessage();
      messages.push({ role: "assistant", content: response.content });

      const uses = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !uses.length) break;

      const results = [];
      for (const u of uses) {
        let out;
        try {
          out = await runTool(u.name, u.input, origin);
        } catch (e) {
          // A failed tool is told to the model, not to the customer: it can
          // apologise in its own words rather than the page showing a stack.
          out = { error: String(e.message || e) };
        }
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: JSON.stringify(out),
          ...(out.error && { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
    }

    emit("done", { reply: reply.trim(), messages: messages.slice(-40) });
  } catch (e) {
    console.error("[concierge]", e);
    emit("error", { error: "Something went wrong. Please try again." });
  } finally {
    res.end();
  }
}

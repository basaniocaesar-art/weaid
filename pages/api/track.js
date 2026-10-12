/**
 * GET /api/track?b=<booking id>&k=<customer token>
 * What the customer's tracking page shows. Polled every 10 seconds.
 */
import { getBooking } from "../../lib/supabase.js";
import { checkToken, eventsFor, stageOf, STAGE_WORDS, arrivalCode, latestLocation, logEvent } from "../../lib/jobs.js";
import { trustCard } from "../../lib/verify.js";
import { cancelQuote, cancelBooking } from "../../lib/cancel.js";
import { openTicket } from "../../lib/followup.js";
import { photoLinks, confirmation, confirmJob } from "../../lib/proof.js";
import { isQuoteJob, money, acceptQuote, declineQuote, payInfo, ADVANCE_PCT, VISIT_FEE } from "../../lib/quotes.js";
import { isCourierJob, courierInfo, pickupCode, dropCode, receiverLink } from "../../lib/courier.js";

export default async function handler(req, res) {
  const { b, k } = req.query;
  const isReceiver = checkToken("recv", b, k);
  if (!isReceiver && !checkToken("cust", b, k)) return res.status(404).json({ error: "not_found" });
  if (isReceiver && req.method !== "GET") return res.status(403).json({ error: "not allowed" });
  try {
    const booking = await getBooking(b);
    if (!booking) return res.status(404).json({ error: "not_found" });

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (body.action === "cancel") {
        const r = await cancelBooking(b, { by: "customer", reason: String(body.reason || "").slice(0, 300) });
        if (!r.ok) return res.status(409).json({ error: r.reason });
        return res.status(200).json(r);
      }
      if (["accept_quote", "decline_quote", "pay", "question"].includes(body.action)) {
        const ev = await eventsFor(b);
        if (!isQuoteJob(ev)) return res.status(400).json({ error: "Not a quote job." });
        if (body.action === "accept_quote") return res.status(200).json(await acceptQuote(booking, ev));
        if (body.action === "decline_quote") return res.status(200).json(await declineQuote(booking, body.reason));
        if (body.action === "question") {
          const text = String(body.text || "").trim().slice(0, 1000);
          if (text.length < 3) return res.status(400).json({ error: "Type your question." });
          const { ref } = await openTicket({ kind: "callback", phone: booking.customer_phone, name: booking.customer_name, bookingId: b, source: "web", summary: `Question about the ${booking.service} quote: ${text}` });
          return res.status(200).json({ ok: true, ref });
        }
        const m = money(booking, ev);
        const what = body.what === "balance" ? "balance" : "advance";
        return res.status(200).json(await payInfo(booking, what, what === "balance" ? m.balanceDue : m.advanceDue));
      }
      if (body.action === "confirm") {
        try { return res.status(200).json(await confirmJob(booking, await eventsFor(b), body.rating, body.comment)); }
        catch (e) { return res.status(400).json({ error: e.message }); }
      }
      if (body.action === "issue") {
        const text = String(body.text || "").trim().slice(0, 1500);
        if (text.length < 5) return res.status(400).json({ error: "Please tell us what went wrong." });
        const { ref } = await openTicket({ kind: "complaint", phone: booking.customer_phone, name: booking.customer_name, bookingId: b, summary: text, source: "web", details: { wants: String(body.wants || "") } });
        await logEvent(b, "issue_reported", { ref });
        return res.status(200).json({ ok: true, ref });
      }
      return res.status(400).json({ error: "unknown action" });
    }

    const events = await eventsFor(b);
    const stage = stageOf(booking, events);
    const moving = ["on_the_way", "to_pickup", "in_transit"].includes(stage);
    const at = (e) => events.find((x) => x.event === e)?.created_at || null;
    res.setHeader("Cache-Control", "no-store");
    const cj = isCourierJob(events) ? courierInfo(events) : null;
    if (isReceiver) {
      return res.status(200).json({
        receiver: true, stage, words: STAGE_WORDS[stage], service: booking.service,
        from: cj?.pickup?.name || "", to: cj?.drop?.name || "", item: cj?.item || "", sender: (booking.customer_name || "").split(" ")[0],
        code: ["assigned", "to_pickup", "in_transit"].includes(stage) ? dropCode(b) : null,
        pro: booking.provider_name ? { name: booking.provider_name, phone: stage === "in_transit" ? booking.provider_phone : null, trust: await trustCard(booking.provider_id).catch(() => null) } : null,
        location: stage === "in_transit" ? await latestLocation(booking) : null,
        home: cj?.drop ? { lat: cj.drop.lat, lng: cj.drop.lng } : null,
      });
    }
    return res.status(200).json({
      courier: cj ? { ...cj, pickupCode: ["finding", "assigned", "to_pickup"].includes(stage) ? pickupCode(b) : null, dropCode: dropCode(b), receiverLink: receiverLink(b) } : null,
      stage,
      words: STAGE_WORDS[stage],
      service: booking.service,
      total: Math.round(booking.total || booking.amount || 0),
      when: booking.scheduled_at || null,
      address: booking.address || "",
      customer: booking.customer_name || "",
      home: booking.customer_lat != null ? { lat: booking.customer_lat, lng: booking.customer_lng } : null,
      // The pro's name and number once someone is actually assigned.
      pro: ["assigned", "on_the_way", "arrived", "done"].includes(stage) && booking.provider_name
        ? { name: booking.provider_name, phone: booking.provider_phone || null, trust: await trustCard(booking.provider_id).catch(() => null) }
        : null,
      // Shown to the customer so they can give it to the pro at the door.
      code: !cj && ["assigned", "on_the_way"].includes(stage) ? arrivalCode(b) : null,
      eta: events.filter((e) => e.event === "on_the_way").pop()?.data?.eta_minutes || null,
      location: moving ? await latestLocation(booking) : null,
      cancel: cancelQuote(booking, events, "customer"),
      proof: stage === "done" || (cj && stage === "in_transit") ? { ...confirmation(booking, events), photos: await photoLinks(b) } : null,
      quoteJob: isQuoteJob(events) ? {
        quote: events.filter((e) => e.event === "quote").pop()?.data || null,
        money: money(booking, events), advancePct: ADVANCE_PCT, visitFee: VISIT_FEE,
        photos: ["quoted", "awaiting_advance", "scheduled", "working"].includes(stage) ? await photoLinks(b) : [],
      } : null,
      reported: events.some((e) => e.event === "issue_reported"),
      times: { paid: booking.paid_at, assigned: at("assigned") || booking.accepted_at, on_the_way: at("on_the_way"), arrived: at("arrived"), done: booking.completed_at || at("done") },
    });
  } catch (e) {
    console.error("[track]", e);
    return res.status(500).json({ error: "failed" });
  }
}

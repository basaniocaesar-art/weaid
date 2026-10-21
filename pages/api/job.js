/**
 * The pro's side of one job, behind a signed link (no login, no app).
 *
 *   GET  /api/job?b=&k=                       the job
 *   POST /api/job?b=&k=  { action: "on_the_way", lat, lng, eta_minutes }
 *                        { action: "location", lat, lng }      every ~20 s while on the way
 *                        { action: "arrived", code }           the customer's 4-digit code
 *                        { action: "done", note, bill: { items, total } }   pay-after: the final bill is required
 *                        { action: "final_bill", items, total, note }    re-enter the bill after Done
 *                        { action: "bill_shared", via }                 the pro sent the bill on WhatsApp
 *                        { action: "cash_received", amount }   pay-after job: the customer paid the pro
 *
 * Every step is logged in booking_events and emailed to the owner.
 */
import { getBooking, updateBooking } from "../../lib/supabase.js";
import { checkToken, eventsFor, stageOf, STAGE_WORDS, arrivalCode, logEvent, saveLocation, alertStep } from "../../lib/jobs.js";
import { savePhoto, photoCounts, arrivalDistance, FAR_METRES } from "../../lib/proof.js";
import { isQuoteJob, submitQuote, money, ADVANCE_PCT, VISIT_FEE } from "../../lib/quotes.js";
import { isCourierJob, courierInfo, pickupCode, dropCode } from "../../lib/courier.js";
import { amountDue, collectAfterJob, recordJobPayment, jobPaid, currentQr } from "../../lib/payafter.js";
import { reportFinalBill, cleanBill, billView, billState, billMessage, waLink, noteBillShared } from "../../lib/bill.js";

export const config = { api: { bodyParser: { sizeLimit: "4.5mb" } } };

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export default async function handler(req, res) {
  const { b, k } = req.query;
  if (!checkToken("pro", b, k)) return res.status(404).json({ error: "not_found" });
  res.setHeader("Cache-Control", "no-store");
  try {
    let booking = await getBooking(b);
    if (!booking) return res.status(404).json({ error: "not_found" });
    let events = await eventsFor(b);
    let stage = stageOf(booking, events);

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const lat = num(body.lat), lng = num(body.lng);

      if (body.action === "cash_received") {
        // The one thing a pro can still do after Done: say the customer paid them.
        if (amountDue(booking, events) <= 0) return res.status(400).json({ error: "This job is already paid." });
        const bs = billState(events).state;
        if (bs === "awaiting_approval") return res.status(400).json({ error: "The customer hasn't approved the bill yet — nothing to collect until they do." });
        if (bs === "disputed") return res.status(400).json({ error: "The customer has questioned the bill. WeAid will ring you both." });
        try { await recordJobPayment(b, { amount: Number(body.amount) || undefined, mode: "cash", receivedBy: "pro", by: "pro" }); }
        catch (e) { return res.status(400).json({ error: e.message }); }
        booking = await getBooking(b);
      } else if (body.action === "final_bill") {
        // After Done: correct the bill (the customer gets a fresh bill, QR and link for the new amount).
        if (stage !== "done" || booking.payment_mode !== "pay_after") return res.status(400).json({ error: "Enter the bill when you tap Job done." });
        if (booking.paid_at) return res.status(400).json({ error: "This job is already paid." });
        try { await reportFinalBill(b, { items: body.items, total: body.total, note: body.note, by: "pro", source: "web" }); }
        catch (e) { return res.status(400).json({ error: e.message }); }
        booking = await getBooking(b);
      } else if (body.action === "bill_shared") {
        await noteBillShared(b, { by: "pro", via: body.via || "whatsapp" });
      } else if (["cancelled", "refunded", "done"].includes(stage)) {
        return res.status(409).json({ error: "This job is closed.", stage });
      }
      if (body.action === "location") {
        if (["on_the_way", "to_pickup", "in_transit"].includes(stage)) await saveLocation(booking, lat, lng);
        return res.status(200).json({ ok: true });
      }
      if (body.action === "on_the_way") {
        if (stage !== "on_the_way") {
          const eta = Math.max(0, Math.round(num(body.eta_minutes))) || null;
          await logEvent(b, "on_the_way", { eta_minutes: eta });
          if (booking.status !== "accepted") booking = await updateBooking(b, { status: "accepted", accepted_at: booking.accepted_at || new Date().toISOString() });
          await alertStep(booking, "on_the_way", eta ? `Says about ${eta} minutes.` : "");
        }
        await saveLocation(booking, lat, lng);
      } else if (body.action === "arrived") {
        if (String(body.code || "").replace(/\D/g, "") !== arrivalCode(b)) {
          return res.status(400).json({ error: "That code doesn't match. Ask the customer to read it from their WeAid page." });
        }
        if (stage !== "arrived") {
          const metres = arrivalDistance(booking, lat, lng);
          await logEvent(b, "arrived", Number.isFinite(lat) ? { lat, lng, metres } : { metres: null });
          await alertStep(booking, "arrived", `Arrival code checked.${metres == null ? " (No location from the pro's phone.)" : metres > FAR_METRES ? ` ⚠️ Pro's phone was ${metres} m from the customer's pin.` : ` Pro was ${metres} m from the customer's pin.`}`);
        }
      } else if (body.action === "quote") {
        if (stage !== "visiting" && stage !== "quoted") return res.status(400).json({ error: "Write the quote during the site visit (after the arrival code)." });
        try { await submitQuote(booking, events, body); } catch (e) { return res.status(400).json({ error: e.message }); }
      } else if (body.action === "work_started") {
        if (stage !== "scheduled") return res.status(400).json({ error: stage === "awaiting_advance" ? "Wait until the customer has paid the advance." : "This job isn't ready to start." });
        await logEvent(b, "work_started", Number.isFinite(lat) ? { lat, lng } : {});
        await alertStep(booking, "working", "Work started on site.");
      } else if (body.action === "picked_up") {
        if (stage !== "to_pickup") return res.status(400).json({ error: "Tap \"On my way\" first." });
        if ((await photoCounts(b)).pickup < 1) return res.status(400).json({ error: "Take a photo of the item first." });
        if (String(body.code || "").replace(/\D/g, "") !== pickupCode(b)) return res.status(400).json({ error: "That's not the sender's code. Ask them to read it from their WeAid page." });
        await logEvent(b, "picked_up", Number.isFinite(lat) ? { lat, lng } : {});
        await saveLocation(booking, lat, lng);
        await alertStep(booking, "in_transit", "Picked up — sender's code checked, photo taken.");
      } else if (body.action === "delivered") {
        if (stage !== "in_transit") return res.status(400).json({ error: "Pick up the item first." });
        if ((await photoCounts(b)).delivery < 1) return res.status(400).json({ error: "Take a photo at delivery first." });
        if (String(body.code || "").replace(/\D/g, "") !== dropCode(b)) return res.status(400).json({ error: "That's not the receiver's code. Ask the receiver for their WeAid code." });
        booking = await updateBooking(b, { status: "completed", completed_at: new Date().toISOString() });
        await logEvent(b, "delivered", Number.isFinite(lat) ? { lat, lng } : {});
        await logEvent(b, "done", { note: "Delivered — receiver's code checked, photo taken." });
        await alertStep(booking, "done", "Delivered — receiver's code checked, photo taken.");
        await collectAfterJob(booking).catch((e) => console.error("[job] collect", e.message));
      } else if (body.action === "photo") {
        if (!["arrived", "visiting", "working", "to_pickup", "in_transit"].includes(stage)) return res.status(400).json({ error: "Enter the customer's arrival code first." });
        try { await savePhoto(booking, body.kind, body.mime, body.data); } catch (e) { return res.status(400).json({ error: e.message }); }
      } else if (body.action === "done") {
        if (stage !== "arrived" && stage !== "working") return res.status(400).json({ error: isQuoteJob(events) ? "Start the work first." : "Enter the customer's arrival code first." });
        if ((await photoCounts(b)).after < 1) return res.status(400).json({ error: "Add at least one photo of the finished work first." });
        if (booking.payment_mode === "pay_after") {
          /*
           * Pay-after: Done and the final bill are one step. The bill is checked
           * before anything is written, then lib/bill.js completes the job,
           * stores the bill, re-splits the money, and sends the customer the
           * bill with a QR and a link (or asks them to approve it, over 3×).
           */
          try { cleanBill(body.bill || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
          try { await reportFinalBill(b, { ...(body.bill || {}), note: body.note, by: "pro", source: "web" }); }
          catch (e) { return res.status(400).json({ error: e.message }); }
          booking = await getBooking(b);
        } else {
          booking = await updateBooking(b, { status: "completed", completed_at: new Date().toISOString() });
          await logEvent(b, "done", { note: String(body.note || "").slice(0, 500) });
          await alertStep(booking, "done", body.note ? `Pro's note: ${String(body.note).slice(0, 300)}` : "");
          await collectAfterJob(booking).catch((e) => console.error("[job] collect", e.message));
        }
      } else if (!["cash_received", "final_bill", "bill_shared"].includes(body.action)) {
        return res.status(400).json({ error: "unknown action" });
      }
      events = await eventsFor(b);
      stage = stageOf(booking, events);
    }

    const bill = billView(booking, events);
    return res.status(200).json({
      stage,
      words: STAGE_WORDS[stage],
      service: booking.service,
      scope: booking.scope,
      description: booking.description || "",
      when: booking.scheduled_at || null,
      address: booking.address || "",
      pin: booking.customer_lat != null ? { lat: booking.customer_lat, lng: booking.customer_lng } : null,
      customer: { name: booking.customer_name || "", phone: booking.customer_phone || "" },
      pro: booking.provider_name || "",
      earnings: booking.provider_earnings != null ? Math.round(booking.provider_earnings) : null,
      paid: Boolean(booking.paid_at),
      // How the money works on this job, in the pro's terms.
      payment: booking.payment_mode === "pay_after"
        ? { mode: "pay_after", total: Math.round(booking.total || booking.amount || 0), due: amountDue(booking, events), received: jobPaid(events),
            payUrl: events.filter((e) => e.event === "payment_due").pop()?.data?.payUrl || null,
            qr: currentQr(events, amountDue(booking, events)),
            commission: Math.max(0, Math.round((booking.total || booking.amount || 0) - (booking.provider_earnings || 0))),
            billState: billState(events).state }
        : { mode: booking.payment_mode || "prepaid", due: 0 },
      // The final bill, and a ready-made WhatsApp message to send it with (the pro's own WhatsApp, signed by them).
      bill: bill ? { ...bill, whatsapp: bill.ready ? waLink(booking.customer_phone, billMessage(booking, bill, booking.provider_name || "your WeAid pro")) : null } : null,
      photos: await photoCounts(b),
      courier: isCourierJob(events) ? courierInfo(events) : null,
      quoteJob: isQuoteJob(events) ? { money: money(booking, events), quote: events.filter((e) => e.event === "quote").pop()?.data || null, advancePct: ADVANCE_PCT, visitFee: VISIT_FEE } : null,
    });
  } catch (e) {
    console.error("[job]", e);
    return res.status(500).json({ error: "failed" });
  }
}

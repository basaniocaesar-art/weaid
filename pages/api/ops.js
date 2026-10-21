/**
 * The owner's job board (header X-Ops-Key = OPS_KEY).
 *
 *   GET  /api/ops                         recent bookings with their stage
 *   GET  /api/ops?pros=<service>&area=..  pros to choose from, nearest area first
 *   POST /api/ops { action: "assign", bookingId, name, phone, providerId? }
 *        { action: "mark_paid", bookingId, how }    cash / UPI taken outside Razorpay, before the job
 *        { action: "dispatch_unpaid", bookingId }   a booking stuck waiting for payment: make it pay-after and find a pro now
 *        { action: "job_payment_received", bookingId, amount, how, receivedBy }   pay-after job: money collected
 *        { action: "final_bill", bookingId, items, total, note }   enter/correct the pro's final bill (lib/bill.js)
 *        { action: "bill_shared", bookingId, via }     the owner sent the bill from their own WhatsApp
 *        { action: "owed_settled", providerId, amount, how }   a pro paid WeAid the commission they were holding
 *        { action: "cancel", bookingId, reason }
 *
 * "assign" hands back ready-to-send WhatsApp links: the job link for the pro,
 * the tracking link (with the arrival code on it) for the customer.
 */
import { supabase, getBooking, updateBooking } from "../../lib/supabase.js";
import { checkOpsKey, jobLinks, eventsFor, stageOf, STAGE_WORDS, logEvent, alertStep, arrivalCode } from "../../lib/jobs.js";
import { canonicalArea, SERVICE_SLUGS } from "../../lib/concierge-tools.js";
import crypto from "crypto";
import { startOffers, advanceOffers } from "../../lib/offers.js";
import { loginCode } from "../../lib/jobs.js";
import { ownerView, decide } from "../../lib/verify.js";
import { cancelBooking, cancelQuote, refund } from "../../lib/cancel.js";
import { confirmation, photoLinks } from "../../lib/proof.js";
import { isQuoteJob, money, recordPayment } from "../../lib/quotes.js";
import { confirmSeat, seatLink } from "../../lib/carpool.js";
import { activatePlan, PLANS as JP_PLANS } from "../../lib/jobportal.js";
import { startDispatch, confirmBooking } from "../../lib/orchestrator.js";
import { amountDue, recordJobPayment, owedBalances, addLedger, PRO_OWED_LIMIT } from "../../lib/payafter.js";
import { billView, billMessage, waLink, noteBillShared, reportFinalBill } from "../../lib/bill.js";

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const wa = (phone, text) => (ten(phone).length === 10 ? `https://wa.me/91${ten(phone)}?text=${encodeURIComponent(text)}` : null);
const NICE = { electrical: "electrician", plumbing: "plumber", ac: "AC technician", cleaning: "cleaning team", painting: "painter", carpentry: "carpenter", movers: "packers and movers", pest_control: "pest control", cctv: "CCTV technician", nursing: "home nurse", eldercare: "caregiver", tiling: "tiling work", flooring: "flooring work", renovation: "renovation work" };
const nice = (s) => NICE[s] || String(s || "").replace(/_/g, " ");
const whenWords = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "as soon as possible");

async function listJobs() {
  const { data, error } = await supabase.from("bookings")
    .select("id,created_at,service,scope,status,total,amount,customer_name,customer_phone,address,description,scheduled_at,paid_at,confirmed_at,payment_mode,provider_id,provider_name,provider_phone,provider_earnings,completed_at")
    .order("created_at", { ascending: false }).limit(60);
  if (error) throw error;
  const ids = (data || []).map((b) => b.id);
  const { data: ev } = ids.length
    ? await supabase.from("booking_events").select("booking_id,event,data,created_at").in("booking_id", ids)
    : { data: [] };
  return (data || []).map((b) => {
    const events = (ev || []).filter((e) => e.booking_id === b.id);
    const stage = stageOf(b, events);
    const refunded = (ev || []).filter((e) => e.booking_id === b.id && e.event === "refunded").length;
    const refundDue = (ev || []).filter((e) => e.booking_id === b.id && e.event === "refund_due").length - (ev || []).filter((e) => e.booking_id === b.id && e.event === "refund_sent").length;
    // Pay-after money: what is still owed and the link the customer was sent.
    const payment = b.payment_mode === "pay_after"
      ? { mode: "pay_after", due: amountDue(b, events), payUrl: events.filter((e) => e.event === "payment_due").pop()?.data?.payUrl || null }
      : { mode: b.payment_mode || "prepaid", due: 0 };
    /*
     * The final bill (lib/bill.js), with the WhatsApp messages ready to send
     * from the owner's own phone: the bill to the customer, signed WeAid, and
     * a note to the pro saying where the money stands. Whether anybody has
     * sent the bill yet is shown, so the ones nobody sent can be sent by hand.
     */
    const bv = billView(b, events);
    const bill = bv && bv.ready ? {
      number: bv.number, total: bv.total, due: bv.due, status: bv.status, items: bv.items, link: bv.link, version: bv.version,
      shared: bv.shared, sent: bv.shared.length > 0,
      whatsappCustomer: waLink(b.customer_phone, billMessage(b, bv, "WeAid")),
      whatsappPro: waLink(b.provider_phone, bv.status === "paid"
        ? `Hi ${(b.provider_name || "").split(" ")[0]}, WeAid here: ${b.customer_name || "the customer"} has paid ₹${bv.total} for the ${bv.service} job. Your share ₹${Math.round(b.provider_earnings || 0)} comes in your weekly payout. Thank you!`
        : `Hi ${(b.provider_name || "").split(" ")[0]}, WeAid here about the ${bv.service} job for ${b.customer_name || "the customer"}: bill ₹${bv.total}, ₹${bv.due} still unpaid${bv.status === "awaiting_approval" ? " (waiting for the customer to approve it)" : ""}. Bill: ${bv.link}`),
    } : null;
    return { ...b, stage, words: STAGE_WORDS[stage], links: jobLinks(b.id), code: arrivalCode(b.id), refunded: refunded > 0, refundDue: refundDue > 0, payment, bill, proof: confirmation(b, events), quote: isQuoteJob(events) ? { money: money(b, events), q: events.filter((e) => e.event === "quote").pop()?.data || null } : null };
  });
}

async function prosFor(service, area) {
  const a = canonicalArea(area);
  let q = supabase.from("providers").select("id,name,phone,areas,source,claimed,rating,google_rating,google_reviews,available")
    .contains("services", [service]).is("removed_at", null).limit(200);
  const { data, error } = await q;
  if (error) throw error;
  const score = (p) => (a && (p.areas || []).includes(a) ? 1000 : 0) + (p.source === "signup" || p.claimed ? 500 : 0) + Number(p.google_rating || p.rating || 0) * 10 + Math.min(Number(p.google_reviews || 0), 300) / 30;
  return (data || []).filter((p) => p.phone).sort((x, y) => score(y) - score(x)).slice(0, 25)
    .map((p) => ({ id: p.id, name: p.name, phone: p.phone, areas: (p.areas || []).slice(0, 3), rating: Number(p.google_rating || p.rating) || null, reviews: p.google_reviews || 0, signedUp: p.source === "signup" || Boolean(p.claimed), nearby: Boolean(a && (p.areas || []).includes(a)) }));
}

/**
 * The app team: pros who signed up or were approved. With `q`, search every
 * listing by name or number (to invite a directory pro you've spoken to).
 */
async function team(q) {
  let query = supabase.from("providers")
    .select("id,name,phone,services,areas,verified,available,last_seen_at,source,claimed,created_at,kyc_status,kyc_id_type")
    .is("removed_at", null).order("created_at", { ascending: false }).limit(q ? 20 : 200);
  const term = String(q || "").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const digits = term.replace(/\D/g, "");
  if (term) query = digits.length >= 5 ? query.ilike("phone", `%${digits}%`) : query.ilike("name", `%${term}%`);
  else query = query.or("source.eq.signup,claimed.eq.true,verified.eq.true");
  const { data } = await query;
  const { data: dev } = await supabase.from("provider_devices").select("provider_id");
  const hasApp = new Set((dev || []).map((d) => d.provider_id));
  // Cash commissions held by each pro (lib/payafter.js); over the limit means no new offers.
  const owed = await owedBalances((data || []).map((p) => p.id));
  return (data || []).map((p) => ({
    id: p.id, name: p.name, phone: p.phone, services: p.services || [], areas: p.areas || [],
    approved: Boolean(p.verified), hasApp: hasApp.has(p.id),
    owed: owed[p.id] || 0, owedLimit: PRO_OWED_LIMIT, blocked: (owed[p.id] || 0) > PRO_OWED_LIMIT,
    online: Boolean(p.available) && Date.now() - Date.parse(p.last_seen_at || 0) < 10 * 60e3,
    appCode: loginCode(p.id),
    kyc: p.kyc_status, idType: p.kyc_id_type || null,
  }));
}

export default async function handler(req, res) {
  if (!checkOpsKey(req)) return res.status(401).json({ error: "unauthorized" });
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      await advanceOffers().catch((e) => console.error("[ops] advance", e.message));
      if (req.query.jobs) {
        const { data: jobs } = await supabase.from("jp_jobs").select("*, jp_employers!inner(business_name, phone, email, approved, plan, plan_until)").order("created_at", { ascending: false }).limit(80);
        const { data: emps } = await supabase.from("jp_employers").select("id,business_name,contact_name,phone,email,kind,area,approved,plan,plan_until,unlocks_left,boosts_left,created_at").order("created_at", { ascending: false }).limit(100);
        const { count: cands } = await supabase.from("jp_candidates").select("id", { count: "exact", head: true });
        const { count: apps } = await supabase.from("jp_applications").select("id", { count: "exact", head: true });
        return res.status(200).json({ jobs: jobs || [], employers: emps || [], candidates: cands || 0, applications: apps || 0, plans: JP_PLANS });
      }
      if (req.query.carpool) {
        const { data: rides } = await supabase.from("carpools").select("*").order("depart_at", { ascending: false }).limit(60);
        const ids = (rides || []).map((r) => r.id);
        const { data: seats } = ids.length ? await supabase.from("carpool_seats").select("*").in("carpool_id", ids).order("created_at") : { data: [] };
        return res.status(200).json({ rides: (rides || []).map((r) => {
          const mine = (seats || []).filter((x) => x.carpool_id === r.id);
          return { ...r, seats: mine.map((x) => ({ ...x, link: seatLink(x.id) })),
            owed: mine.filter((x) => x.status === "boarded").reduce((n, x) => n + x.seats * r.price_per_seat, 0),
            fees: mine.filter((x) => ["boarded", "confirmed", "no_show"].includes(x.status)).reduce((n, x) => n + x.fee, 0) };
        }) });
      }
      if (req.query.tickets) {
        const { data, error } = await supabase.from("support_tickets").select("*").order("created_at", { ascending: false }).limit(100);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ tickets: data || [] });
      }
      if (req.query.team) return res.status(200).json({ team: await team(req.query.q) });
      if (req.query.pros) return res.status(200).json({ pros: await prosFor(String(req.query.pros), String(req.query.area || "")) });
      return res.status(200).json({ jobs: await listJobs() });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const NO_BOOKING = ["approve", "unapprove", "app_code", "kyc_view", "kyc_approve", "kyc_reject", "kyc_call", "ticket_done", "carpool_paid", "carpool_payout", "add_pros", "jp_job", "jp_plan", "owed_settled"];
    const booking = NO_BOOKING.includes(body.action) ? null : await getBooking(body.bookingId);
    if (!booking && !NO_BOOKING.includes(body.action)) return res.status(404).json({ error: "no such booking" });

    if (body.action === "assign") {
      const name = String(body.name || "").trim();
      const phone = ten(body.phone);
      if (!name || phone.length !== 10) return res.status(400).json({ error: "Need the pro's name and a 10-digit mobile." });
      const updated = await updateBooking(booking.id, {
        provider_name: name, provider_phone: `+91${phone}`,
        provider_id: body.providerId || booking.provider_id || null,
        // Paid jobs become "accepted"; an unpaid (cash) job keeps its status and still shows as assigned.
        status: booking.status === "pending" ? "accepted" : booking.status,
        accepted_at: new Date().toISOString(),
      });
      await logEvent(booking.id, "assigned", { name, phone: `+91${phone}`, providerId: body.providerId || null });
      await alertStep(updated, "assigned");
      const links = jobLinks(booking.id);
      const area = (booking.address || "").split(",").slice(-2).join(",").trim();
      const proText = `WeAid job for you: ${nice(booking.service)}${booking.description ? ` — ${booking.description}` : ""}. ${area ? `Area: ${area}. ` : ""}When: ${whenWords(booking.scheduled_at)}.${updated.provider_earnings ? ` You earn ₹${Math.round(updated.provider_earnings)}.` : ""}\nOpen this link for the address and tap "On my way" when you leave: ${links.job}`;
      const custText = `Hi ${booking.customer_name || ""}, your WeAid ${nice(booking.service)} booking is confirmed. ${name} will come${booking.scheduled_at ? ` on ${whenWords(booking.scheduled_at)}` : " soon"}.\nYour arrival code is ${arrivalCode(booking.id)} — give it to ${name} when they arrive.\nTrack your pro live: ${links.track}`;
      return res.status(200).json({ ok: true, links, whatsappPro: wa(phone, proText), whatsappCustomer: wa(booking.customer_phone, custText), proText, custText });
    }
    if (body.action === "mark_paid") {
      // Money taken before the job, outside Razorpay. A pay-after job that is paid this way is simply paid.
      if (booking.payment_mode === "pay_after" && amountDue(booking, await eventsFor(booking.id)) > 0) {
        const r = await recordJobPayment(booking.id, { mode: String(body.how || "cash").slice(0, 20), receivedBy: "weaid", by: "WeAid" });
        return res.status(200).json({ ok: true, status: booking.status, due: r.due });
      }
      const now = new Date().toISOString();
      const updated = await updateBooking(booking.id, { paid_at: booking.paid_at || now, confirmed_at: booking.confirmed_at || now, status: booking.status === "pending_payment" ? "pending" : booking.status, payment_gateway: String(body.how || "cash").slice(0, 20) });
      await logEvent(booking.id, "paid_offline", { how: body.how || "cash" });
      // The same outreach a Razorpay payment starts; a no-op if it already ran.
      const d = await startDispatch(updated).catch((e) => ({ skipped: e.message }));
      if (d.skipped) await startOffers(updated).catch((e) => console.error("[ops] offers", e.message));
      return res.status(200).json({ ok: true, status: updated.status });
    }
    if (body.action === "dispatch_unpaid") {
      /*
       * The two October bookings that sat in "waiting for payment" while nobody
       * was rung: this is the button for them. The job becomes pay-after and
       * outreach starts now; the customer pays when it is done.
       */
      if (booking.status !== "pending_payment") return res.status(409).json({ error: `This job is ${booking.status}, not waiting for payment.` });
      const updated = await confirmBooking(booking.id);
      return res.status(200).json({ ok: true, status: updated.status, paymentMode: updated.payment_mode });
    }
    if (body.action === "job_payment_received") {
      // A pay-after job's money arrived by cash/UPI: to the pro (commission goes in their ledger) or to WeAid.
      try {
        const r = await recordJobPayment(booking.id, { amount: Number(body.amount) || undefined, mode: String(body.how || "cash").slice(0, 20), receivedBy: body.receivedBy === "weaid" ? "weaid" : "pro", by: "WeAid" });
        return res.status(200).json(r);
      } catch (e) { return res.status(400).json({ error: e.message }); }
    }
    if (body.action === "bill_shared") {
      // The owner sent the bill (or a nudge) from their own WhatsApp.
      await noteBillShared(booking.id, { by: "weaid", via: String(body.via || "whatsapp") });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "final_bill") {
      // Enter or correct the final bill on the pro's behalf (after a phone call, or a disputed bill).
      try { return res.status(200).json(await reportFinalBill(booking.id, { items: body.items, total: body.total, note: body.note, by: "ops", source: "ops" })); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    if (body.action === "owed_settled") {
      const amt = Math.round(Number(body.amount) || 0);
      if (!body.providerId || amt <= 0) return res.status(400).json({ error: "Need the pro and an amount." });
      await addLedger(body.providerId, "settled", -amt, { note: `Paid to WeAid by ${String(body.how || "UPI").slice(0, 20)}` });
      const owed = (await owedBalances([body.providerId]))[body.providerId] || 0;
      return res.status(200).json({ ok: true, owed });
    }
    if (body.action === "approve" || body.action === "unapprove") {
      const { error } = await supabase.from("providers").update({ verified: body.action === "approve" }).eq("id", body.providerId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "jp_job") {
      const st = { approve: "live", reject: "rejected", close: "closed" }[body.decision];
      if (!st) return res.status(400).json({ error: "decision?" });
      const { data: j } = await supabase.from("jp_jobs").update({ status: st }).eq("id", body.jobId).select("employer_id").maybeSingle();
      if (j && st === "live") await supabase.from("jp_employers").update({ approved: true }).eq("id", j.employer_id);
      return res.status(200).json({ ok: true });
    }
    if (body.action === "jp_plan") return res.status(200).json(await activatePlan(body.employerId, body.plan));
    if (body.action === "add_pros") {
      /*
       * The owner adds people he knows. Each gets an account (not yet approved —
       * they still verify their ID in the app) and a WhatsApp link with the app
       * and their login code. An existing number is not duplicated.
       */
      const out = [];
      for (const raw of (body.pros || []).slice(0, 200)) {
        const name = String(raw.name || "").trim().slice(0, 80);
        const phone = ten(raw.phone);
        const services = (raw.services || []).map((x) => String(x).trim().toLowerCase()).filter((x) => SERVICE_SLUGS.includes(x));
        if (!name || phone.length !== 10 || !services.length) { out.push({ name, phone, error: !services.length ? "unknown service" : "need name + 10-digit mobile" }); continue; }
        const { data: ex } = await supabase.from("providers").select("id,name,source,claimed").or(`phone.eq.+91${phone},phone.eq.${phone},whatsapp.eq.+91${phone}`).is("removed_at", null).limit(1);
        let id = ex?.[0]?.id;
        if (id) {
          await supabase.from("providers").update({ services, source: "signup", claimed: true, ...(raw.area ? { areas: [canonicalArea(raw.area) || String(raw.area).trim()] } : {}) }).eq("id", id);
        } else {
          const area = canonicalArea(raw.area) || String(raw.area || "").trim();
          const { data, error } = await supabase.from("providers").insert({
            name, phone: `+91${phone}`, whatsapp: `+91${phone}`, city: "kochi", services, areas: area ? [area] : [],
            source: "signup", claimed: true, verified: false, available: false, edit_token: crypto.randomUUID(),
          }).select("id").single();
          if (error) { out.push({ name, phone, error: error.message }); continue; }
          id = data.id;
        }
        const code = loginCode(id);
        const text = `Hi ${name.split(" ")[0]}, this is WeAid. You're added as a WeAid pro (${services.join(", ")}). Paid jobs near you will pop up in the WeAid Pro app.\n1. Install: https://weaid.in/pro\n2. Log in with this number and code ${code}\n3. Tap "Verify my ID" (2 minutes)\nCall 080 6426 7771 with any questions.`;
        out.push({ id, name, phone, existed: Boolean(ex?.[0]), code, whatsapp: wa(phone, text) });
      }
      return res.status(200).json({ added: out });
    }
    if (body.action === "carpool_paid") return res.status(200).json(await confirmSeat(body.seatId, { how: "UPI" }));
    if (body.action === "carpool_payout") {
      await supabase.from("carpools").update({ payout_sent_at: new Date().toISOString() }).eq("id", body.rideId);
      return res.status(200).json({ ok: true });
    }
    if (body.action === "ticket_done") {
      const { error } = await supabase.from("support_tickets").update({ status: body.reopen ? "open" : "done", closed_at: body.reopen ? null : new Date().toISOString() }).eq("id", body.ticketId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "kyc_view") return res.status(200).json({ check: await ownerView(body.providerId) });
    if (["kyc_approve", "kyc_reject", "kyc_call"].includes(body.action)) {
      return res.status(200).json(await decide(body.providerId, body.action.slice(4), String(body.note || "").slice(0, 300)));
    }
    if (body.action === "app_code") {
      const { data: p } = await supabase.from("providers").select("id,name,phone").eq("id", body.providerId).maybeSingle();
      if (!p) return res.status(404).json({ error: "no such pro" });
      if (!p.phone) return res.status(400).json({ error: "This pro has no phone number." });
      const code = loginCode(p.id);
      const text = `Hi ${p.name}, WeAid jobs now come through the WeAid Pro app. Install it: https://weaid.in/pro\nLog in with your number and this code: ${code}\nGo online and nearby jobs will pop up on your phone.`;
      return res.status(200).json({ ok: true, code, whatsapp: wa(p.phone, text) });
    }
    if (body.action === "cancel_quote") {
      return res.status(200).json(cancelQuote(booking, await eventsFor(booking.id), "owner"));
    }
    if (body.action === "cancel") {
      const r = await cancelBooking(booking.id, { by: "WeAid", reason: String(body.reason || "").slice(0, 300), refundAmount: body.refund != null ? Number(body.refund) : null });
      if (!r.ok) return res.status(409).json({ error: r.reason });
      return res.status(200).json(r);
    }
    if (body.action === "refund") {
      const r = await refund(booking, Number(body.amount), String(body.reason || "Part refund").slice(0, 300), "WeAid");
      return res.status(200).json(r);
    }
    if (body.action === "payment_received") {
      const what = body.what === "balance" ? "balance" : "advance";
      return res.status(200).json(await recordPayment(booking.id, what, Number(body.amount), String(body.how || "UPI").slice(0, 20)));
    }
    if (body.action === "photos") return res.status(200).json({ photos: await photoLinks(booking.id) });
    if (body.action === "refund_sent") {
      await logEvent(booking.id, "refund_sent", { by: "WeAid", how: String(body.how || "UPI").slice(0, 20) });
      await updateBooking(booking.id, { refunded_at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[ops]", e);
    return res.status(500).json({ error: e.message });
  }
}

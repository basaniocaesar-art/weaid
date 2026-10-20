/**
 * WeAid phone line — the Sarvam voice agent that answers WeAid's number calls
 * this as its tools (header X-Line-Key = PHONE_LINE_KEY):
 *
 *   ?step=start       { caller }                       on-start: who is this?
 *   ?step=quote       { service, area, scope, slot, workers, sqft, days, hours }
 *   ?step=book        { caller, name, phone, service, scope, slot, workers,
 *                       sqft, days, hours, area, address, description, when }
 *   ?step=site_visit  { caller, name, phone, service, area, address, description, when }
 *   ?step=complaint   { caller, name, booking_ref, issue, wants }
 *   ?step=callback    { caller, name, reason, when }
 *
 * Every reply carries `say`: one or two plain English sentences the agent
 * speaks (translating to Malayalam itself). Prices come from lib/pricing.js,
 * the same numbers the website and the chat assistant use. Nothing here takes
 * card details on the call: a repair is booked pay-after and dispatched at once
 * (lib/payafter.js); anything prepaid gets a Razorpay payment link that
 * Razorpay texts to the caller; and anything a person must do becomes a ticket
 * emailed to the team (lib/followup.js).
 */
import { supabase, insertBooking } from "../../lib/supabase.js";
import { calculatePrice, SERVICES } from "../../lib/pricing.js";
import { runTool, SERVICE_SLUGS, SCOPES, SLOTS, canonicalArea } from "../../lib/concierge-tools.js";
import { createPaymentLink, razorpayConfigured } from "../../lib/razorpay.js";
import { openTicket, alertTeamBooking } from "../../lib/followup.js";
import { jobLinks, eventsFor, stageOf, STAGE_WORDS, arrivalCode } from "../../lib/jobs.js";
import { createVisitBooking, VISIT_FEE, needsVisit, ADVANCE_PCT } from "../../lib/quotes.js";
import { quoteTrip, createTrip, receiverLink, dropCode, pickupCode } from "../../lib/courier.js";
import { loginCode } from "../../lib/jobs.js";
import { sendAdminNotification } from "../../lib/email.js";
import { startDispatch } from "../../lib/orchestrator.js";
import { paymentModeFor, openUnpaidCount, PAY_AFTER_OPEN_LIMIT } from "../../lib/payafter.js";
import crypto from "crypto";

const ten = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  const t = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(t) ? t : "";
};
const rupees = (n) => `${Math.round(Number(n) || 0)} rupees`;
const str = (v) => (v == null || v === "null" || v === "undefined" ? "" : String(v).trim());
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

const SERVICE_WORDS = {
  plumbing: "plumber", electrical: "electrician", ac: "AC technician", cleaning: "cleaning team",
  painting: "painter", carpentry: "carpenter", movers: "packers and movers team", renovation: "mason",
  tiling: "tiling team", flooring: "flooring team", roofing: "roofing team", waterproofing: "waterproofing team",
  cook: "cook", maid: "housemaid", babysit: "babysitter", postnatal: "mother and baby caregiver", driver: "driver", pest_control: "pest control team", cctv: "CCTV technician",
  nursing: "home nurse", eldercare: "caregiver", caretaking: "helper",
};
const who = (s) => SERVICE_WORDS[s] || "professional";

const STATUS_WORDS = {
  pending_payment: "booked but not paid yet",
  pending: "booked, and we are finding the nearest available pro",
  accepted: "confirmed — a pro has taken the job",
  in_progress: "in progress",
  completed: "completed",
  cancelled: "cancelled",
  refunded: "cancelled and refunded",
};

/** Status in words, including "on the way" / "arrived" and the arrival code once a pro is assigned. */
async function stageWords(b) {
  const stage = stageOf(b, await eventsFor(b.id));
  const code = ["assigned", "on_the_way"].includes(stage) ? `. Their arrival code is ${arrivalCode(b.id).split("").join(" ")}` : "";
  return `${STAGE_WORDS[stage] || STATUS_WORDS[b.status] || b.status}${b.provider_name && stage !== "finding" ? ` (${b.provider_name})` : ""}${code}`;
}

function todayIst() {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " IST";
}

/** The agent sends ISO when it can; anything else is kept as words for the team. */
function parseWhen(raw) {
  const s = str(raw);
  if (!s || /^(now|asap|today asap|as soon as possible)$/i.test(s)) return { mode: "asap", at: null, text: "" };
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+05:30`);
  if (Number.isFinite(t) && t > Date.now() - 3600e3) return { mode: "scheduled", at: new Date(t).toISOString(), text: "" };
  return { mode: "asap", at: null, text: s };
}

async function start({ caller }) {
  const t = ten(caller);
  // Every field on every reply, so the agent's variables always get a value
  // (and the Sarvam tool form can map all of them from a single test call).
  const base = {
    today: todayIst(), caller_phone: t, caller_type: "new",
    customer_name: "", booking_status: "none", booking_ref: "none",
    provider_name: "", provider_jobs: "none",
  };
  if (!t) return base;

  const [{ data: pros }, { data: jobs }] = await Promise.all([
    supabase.from("providers").select("id,name,services").or(`phone.eq.+91${t},whatsapp.eq.+91${t},phone.eq.${t}`).is("removed_at", null).limit(1),
    supabase.from("bookings").select("id,service,status,scheduled_at,created_at,customer_name,provider_id,provider_name,paid_at")
      .or(`customer_phone.eq.+91${t},customer_phone.eq.${t}`).order("created_at", { ascending: false }).limit(1),
  ]);

  const pro = pros?.[0];
  if (pro) {
    const { data: theirs } = await supabase.from("bookings").select("service,status,scheduled_at")
      .eq("provider_id", pro.id).in("status", ["accepted", "in_progress"]).order("scheduled_at", { ascending: true }).limit(5);
    return {
      ...base,
      caller_type: "provider",
      provider_name: pro.name,
      provider_jobs: theirs?.length
        ? theirs.map((j) => `${j.service}${j.scheduled_at ? ` at ${new Date(j.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "2-digit" })}` : " (as soon as possible)"}`).join("; ")
        : "no open jobs",
    };
  }

  const b = jobs?.[0];
  if (b) {
    return {
      ...base,
      caller_type: "customer",
      customer_name: b.customer_name || "",
      booking_ref: String(b.id).slice(0, 8),
      booking_status: `${b.service} job — ${await stageWords(b)}${b.scheduled_at ? `, for ${new Date(b.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", hour: "numeric", minute: "2-digit" })}` : ""}`,
    };
  }
  return { ...base, caller_type: "new" };
}

function priceArgs(b) {
  const service = str(b.service).toLowerCase();
  // Asha passes scope "monthly" for care/household hires by the month, and
  // "large" for a 24-hour nurse — no new tool fields needed in Sarvam.
  const monthly = /month/i.test(str(b.scope)) || num(b.months);
  return {
    service,
    city: "kochi",
    months: monthly ? Math.max(1, Math.round(num(b.months) || 1)) : undefined,
    scope: SCOPES.includes(str(b.scope)) ? str(b.scope) : "small",
    slot: SLOTS.includes(str(b.slot)) ? str(b.slot) : "standard",
    workers: Math.max(1, Math.round(num(b.workers) || 1)),
    sqft: num(b.sqft),
    days: num(b.days),
    hours: num(b.hours),
  };
}

const VISIT_SAY = `For a job like this, a pro comes to see it first — the visit is ${VISIT_FEE} rupees, taken off your bill if you go ahead. You get a written quote on your phone with materials included, pay ${Math.round(ADVANCE_PCT * 100)} percent to book, and the rest only after you've checked the finished work. Shall I book the visit?`;

async function quote(b) {
  const a = priceArgs(b);
  if (needsVisit(a.service, a)) return { ok: true, site_visit: true, say: VISIT_SAY };
  if (a.service === "event_cook") return { ok: true, callback: true, say: "For a party or function, our team will call you to plan the menu and numbers and give you a quote. Shall I have them call you?" };
  if (SERVICES[a.service]?.callback) return { ok: true, callback: true, say: "Our team arranges this one on a call and gives you a price. Shall I have them call you?" };
  if (!SERVICE_SLUGS.includes(a.service)) {
    return { ok: false, say: "I'll need to check that one with the team. Can I take your name and have someone call you back?" };
  }
  const price = calculatePrice(a);
  const area = canonicalArea(b.area);
  const bs = price.basis || {};
  const priceWords = bs.months ? `${rupees(bs.perMonth)} a month${bs.months > 1 ? `, ${rupees(price.total)} for ${bs.months} months` : ""}`
    : bs.perDay && price.mode === "care" ? `${rupees(bs.perDay)} a day${bs.days > 1 ? `, ${rupees(price.total)} for ${bs.days} days` : ""}${bs.shift ? ` for a ${bs.shift} shift` : ""}`
    : bs.perHour ? `${rupees(price.total)} for ${bs.hours} hours` : `${rupees(price.total)} in total`;
  const found = await runTool("find_providers", { service: a.service, city: "kochi", area }, "");
  const n = found?.available || 0;
  const assumed = price.mode === "care" ? "" : price.basis?.assumedArea
    ? ` That assumes about ${price.basis.sqft} square feet — tell me the size and I'll redo it.`
    : price.basis?.assumedDays ? " That assumes one day of work." : "";
  return {
    ok: true,
    price_total: Math.round(price.total),
    available: n,
    say: n
      ? `That's ${priceWords}.${assumed} We have ${n} ${who(a.service)}s available${found.in_their_area ? ` near ${area}` : " in Kochi"}.`
      : `That's ${priceWords}.${assumed} We Aid will arrange ${/^[aeiou]/i.test(who(a.service)) ? "an" : "a"} ${who(a.service)} and confirm who's coming. Shall I book it?`,
  };
}

async function book(b) {
  const a = priceArgs(b);
  if (needsVisit(a.service, a)) return siteVisit(b);
  if (!SERVICE_SLUGS.includes(a.service)) return { ok: false, say: "I can't book that one directly. Let me take your details for a callback instead." };
  const phone = ten(b.phone) || ten(b.caller);
  if (!phone) return { ok: false, say: "What's the best mobile number for the booking?" };
  const address = str(b.address) || (str(b.area) ? `${str(b.area)}, Kochi` : "");
  if (!address) return { ok: false, say: "Which area are you in, and what's the address?" };
  const name = str(b.name) || "Customer";
  const when = parseWhen(b.when);
  const price = calculatePrice(a);

  // Repairs are pay-after and go out to pros at once; the same open-jobs guard as the website.
  let mode = paymentModeFor(a.service);
  if (mode === "pay_after" && (await openUnpaidCount(phone)) >= PAY_AFTER_OPEN_LIMIT) mode = "prepaid";
  const payAfter = mode === "pay_after";
  const now = new Date().toISOString();

  const booking = await insertBooking({
    service: a.service, city: "kochi", scope: a.scope, slot: a.slot,
    customer_name: name, customer_phone: `+91${phone}`, customer_email: null,
    subtotal: price.subtotal, platform_fee: price.platformFee, total: price.total, commission: price.commission,
    amount: Math.round(price.total),
    commission_pct: price.subtotal > 0 ? Number((price.commission / price.subtotal).toFixed(4)) : 0,
    provider_earnings: price.providerEarnings,
    payment_gateway: "razorpay",
    timing_mode: when.mode, scheduled_at: when.at,
    description: [str(b.description), when.text && `Preferred time: ${when.text}`, "Booked on the phone line"].filter(Boolean).join(" — "),
    address, workers: a.workers,
    payment_mode: mode, status: payAfter ? "pending" : "pending_payment", confirmed_at: payAfter ? now : null,
  });

  if (payAfter) {
    await startDispatch(booking).catch((e) => console.error("[phone-line] dispatch failed:", e.message));
    if (when.text) {
      await openTicket({ kind: "callback", phone: `+91${phone}`, name, bookingId: booking.id, source: "phone",
        summary: `Booked ${a.service} (pay after); confirm the time with them: "${when.text}"` });
    }
    return {
      ok: true, booking_ref: String(booking.id).slice(0, 8), total: Math.round(price.total),
      say: `Done. Your ${who(a.service)} is booked for ${rupees(price.total)}, and there's nothing to pay now — you pay after the work is done, by cash or a link we send. We're finding the nearest ${who(a.service)} now and you'll get a call to confirm.`,
    };
  }

  await alertTeamBooking(booking, "new");
  let link = null;
  if (razorpayConfigured()) {
    try {
      link = await createPaymentLink({
        amountInr: Math.round(price.total), bookingId: booking.id, name, phone,
        description: `WeAid — ${who(a.service)} (${a.scope} job)`,
        callbackUrl: jobLinks(booking.id).track,
      });
    } catch (e) {
      console.error("[phone-line] payment link failed:", e.message);
    }
  }

  if (link?.short_url) {
    if (when.text) {
      await openTicket({ kind: "callback", phone: `+91${phone}`, name, bookingId: booking.id, source: "phone",
        summary: `Booked ${a.service}; confirm the time with them: "${when.text}"` });
    }
    return {
      ok: true, booking_ref: String(booking.id).slice(0, 8), total: Math.round(price.total),
      say: `Done. Your booking is made for ${rupees(price.total)}. You'll get a text message from Razorpay with a payment link in the next minute — once it's paid, we assign the nearest ${who(a.service)} and you'll get a call to confirm.`,
    };
  }

  const { ref } = await openTicket({
    kind: "payment", phone: `+91${phone}`, name, bookingId: booking.id, source: "phone",
    summary: `Phone booking: ${a.service}, ${a.scope}, ${rupees(price.total)}. ${str(b.description)}`,
    details: { address, preferred_time: when.at || when.text || "as soon as possible" },
  });
  return {
    ok: true, booking_ref: ref, total: Math.round(price.total),
    say: `Your job is logged for ${rupees(price.total)}, reference ${ref.replace(/\D/g, "").split("").join(" ")}. Someone from We Aid will call you back on this number shortly to confirm and arrange payment.`,
  };
}

async function siteVisit(b) {
  const phone = ten(b.phone) || ten(b.caller);
  const name = str(b.name) || "Customer";
  let service = str(b.service).toLowerCase();
  if (!SERVICE_SLUGS.includes(service)) service = "renovation";
  const when = parseWhen(b.when);
  if (!phone) return { ok: false, say: "What's the best mobile number for the visit?" };
  const booking = await createVisitBooking({
    service, name, phone: `+91${phone}`, address: str(b.address), area: str(b.area),
    description: [str(b.description), when.text && `Preferred visit: ${when.text}`].filter(Boolean).join(" — "), when: when.at, source: "phone",
  });
  let link = null;
  if (razorpayConfigured()) {
    try { link = await createPaymentLink({ amountInr: VISIT_FEE, bookingId: booking.id, name, phone, description: `WeAid — ${service} site visit`, callbackUrl: jobLinks(booking.id).track }); }
    catch (e) { console.error("[phone-line] visit link", e.message); }
  }
  if (link?.short_url) {
    return { ok: true, say: `Booked. You'll get a text from Razorpay to pay the ${VISIT_FEE} rupee visit fee — it's taken off your bill if you go ahead. Once it's paid, a pro will come, measure up and send your written quote to your phone.` };
  }
  const { ref } = await openTicket({ kind: "payment", phone: `+91${phone}`, name, bookingId: booking.id, source: "phone", summary: `Site visit for ${service}: confirm the time and collect ₹${VISIT_FEE}. ${str(b.description)}` });
  return { ok: true, ref, say: `I've booked your site visit, reference ${ref.replace(/\D/g, "").split("").join(" ")}. Our team will call you to fix the time. The visit is ${VISIT_FEE} rupees, taken off your bill if you go ahead, and you'll get a written quote on your phone.` };
}

async function complaint(b) {
  const phone = ten(b.caller) || ten(b.phone);
  let bookingId = null;
  if (phone) {
    const { data } = await supabase.from("bookings").select("id").or(`customer_phone.eq.+91${phone},customer_phone.eq.${phone}`)
      .order("created_at", { ascending: false }).limit(1);
    bookingId = data?.[0]?.id || null;
  }
  const { ref } = await openTicket({
    kind: "complaint", phone: phone ? `+91${phone}` : str(b.caller), name: str(b.name), bookingId, source: "phone",
    summary: str(b.issue),
    details: { booking_ref_given: str(b.booking_ref), what_they_want: str(b.wants) },
  });
  return {
    ok: true, ref,
    say: `I'm sorry about that. I've logged it as reference ${ref.replace(/\D/g, "").split("").join(" ")}, and someone from We Aid will call you back within the hour to sort it out.`,
  };
}

async function callback(b) {
  const phone = ten(b.phone) || ten(b.caller);
  const { ref } = await openTicket({
    kind: "callback", phone: phone ? `+91${phone}` : str(b.caller), name: str(b.name), source: "phone",
    summary: str(b.reason), details: { best_time: str(b.when) },
  });
  return { ok: true, ref, say: `Noted. Someone from We Aid will call you back${str(b.when) ? ` ${str(b.when)}` : " soon"}.` };
}

/*
 * Courier on the phone. One tool, two uses: without "confirm" it prices the
 * trip; with confirm "yes" (after the caller agreed) it books it.
 */
async function delivery(b) {
  const pickup = str(b.pickup), drop = str(b.drop);
  if (!pickup || !drop) return { ok: false, say: "Where should we pick it up from, and where does it go? A landmark and area for each, please." };
  if (!/^y/i.test(str(b.confirm))) {
    try {
      const q = await quoteTrip({ service: "courier", pickup, drop });
      return { ok: true, price: q.price.total, say: `From ${pickup} to ${drop} is about ${Math.round(q.km)} kilometres, so it's ${rupees(q.price.total)}. A rider collects it with a code and photographs it at pickup and delivery, and the receiver gives their own code to receive it. Shall I book it?` };
    } catch (e) { return { ok: false, say: `${e.message} Could you give me a nearby landmark?` }; }
  }
  const sp = ten(b.phone) || ten(b.caller), rp = ten(b.receiver_phone);
  if (!sp) return { ok: false, say: "What's your mobile number?" };
  if (!rp) return { ok: false, say: "What's the receiver's mobile number? They'll get a code to receive it." };
  let t;
  try {
    t = await createTrip({ service: "courier", pickup, drop, item: str(b.item) || "Parcel", notes: str(b.notes) || null,
      sender: { name: str(b.name) || "Customer", phone: `+91${sp}` }, receiver: { name: str(b.receiver_name) || "Receiver", phone: `+91${rp}` },
      when: parseWhen(b.when).at, source: "phone" });
  } catch (e) { return { ok: false, say: `${e.message}` }; }
  const id = t.booking.id;
  const codes = `Your pickup code is ${pickupCode(id).split("").join(" ")}. The receiver's code is ${dropCode(id).split("").join(" ")} — please pass it to them.`;
  let link = null;
  if (razorpayConfigured()) {
    try { link = await createPaymentLink({ amountInr: t.total, bookingId: id, name: str(b.name), phone: sp, description: "WeAid courier delivery", callbackUrl: jobLinks(id).track }); }
    catch (e) { console.error("[phone-line] courier link", e.message); }
  }
  if (link?.short_url) return { ok: true, say: `Booked for ${rupees(t.total)}. You'll get a text from Razorpay to pay; once paid, a rider is sent. ${codes}` };
  const { ref } = await openTicket({ kind: "payment", phone: `+91${sp}`, name: str(b.name), bookingId: id, source: "phone", summary: `Courier ${pickup} → ${drop}: collect ${rupees(t.total)}.` });
  return { ok: true, ref, say: `Booked for ${rupees(t.total)}. Someone from We Aid will call you to take the payment, then a rider is sent. ${codes}` };
}

/*
 * Outbound recruiting (Asha calling businesses and workers). When someone says
 * yes, they get an unapproved WeAid account and the owner gets an email with a
 * one-tap WhatsApp invite (app link + login code). No WhatsApp is sent by the
 * agent itself.
 */
const TRADE_WORDS = [
  ["electrical", /electric|wiring|wireman/i], ["plumbing", /plumb|pipe/i], ["ac", /\bac\b|air ?con|a\.c/i],
  ["cleaning", /clean|housekeep/i], ["painting", /paint/i], ["tiling", /tile|tiling/i], ["flooring", /floor/i],
  ["carpentry", /carpent|wood|furniture/i], ["roofing", /roof|sheet/i], ["waterproofing", /waterproof|leak|damp/i],
  ["renovation", /renovat|mason|construction|civil/i], ["pest_control", /pest|termite/i], ["cctv", /cctv|camera/i],
  ["movers", /mover|packer|shifting/i], ["appliance", /washing machine|fridge|refrigerator|\btv\b|microwave|appliance/i], ["ro_service", /\bro\b|purifier/i],
  ["inverter", /inverter|\bups\b|battery/i], ["gas_stove", /gas stove|burner/i], ["motor_repair", /motor|rewind|pump/i], ["locksmith", /lock ?smith|duplicate key/i],
  ["computer_repair", /computer|laptop/i], ["mobile_repair", /mobile repair|phone repair|mobile service/i], ["solar", /solar/i], ["tank_cleaning", /tank|septic/i], ["well_cleaning", /well clean|borewell|\bwells\b/i],
  ["welding", /weld|fabricat|gate|grill/i], ["aluminium", /alumin|glass|mosquito/i], ["gardening", /garden|landscap|coconut|tree climb/i], ["sofa_cleaning", /sofa|carpet/i],
  ["interior", /interior|modular/i], ["vehicle_service", /mechanic|car wash|bike service|car service/i], ["tailoring", /tailor|stitch/i], ["photography", /photo|video ?graph/i], ["event_decor", /decorat/i],
  ["tutor", /tuition|tutor|teacher/i], ["makeup", /makeup|beautician|bridal/i], ["mehendi", /mehe?ndi|henna/i], ["physio", /physio/i], ["laundry", /laundry|ironing|dry ?clean/i], ["pet_grooming", /\bpets?\b|groom|\bvet/i], ["cook", /cook|chef|catering|kitchen/i], ["maid", /maid|domestic|house ?help|servant/i],
  ["babysit", /baby ?sit|nanny|child ?care|day ?care/i], ["postnatal", /post.?natal|delivery care|after delivery|mother.*baby|prasava/i],
  ["nursing", /nurs|patient care|bystander|home ?care/i], ["eldercare", /elder|old age|senior/i], ["driver", /driver|driving/i], ["courier", /courier|delivery boy|delivery rider|parcel/i],
];
async function recruit(b) {
  const phone = ten(b.phone) || ten(b.caller);
  const yes = /^y/i.test(str(b.interested));
  const text = `${str(b.services)} ${str(b.notes)}`;
  const services = [...new Set(TRADE_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k))];
  const name = str(b.name) || str(b.business_name) || "WeAid pro";
  if (!yes) {
    if (str(b.callback_time)) await openTicket({ kind: "callback", phone: phone ? `+91${phone}` : str(b.caller), name, source: "phone", summary: `Recruiting call: call back ${str(b.callback_time)} about joining WeAid. ${text}` });
    return { ok: true, say: "No problem at all. Thank you for your time!" };
  }
  if (!phone) return { ok: false, say: "What's the best mobile number for the WeAid app?" };
  const area = canonicalArea(str(b.area)) || str(b.area);
  const { data: ex } = await supabase.from("providers").select("id").or(`phone.eq.+91${phone},phone.eq.${phone},whatsapp.eq.+91${phone}`).is("removed_at", null).limit(1);
  let id = ex?.[0]?.id;
  if (id) {
    await supabase.from("providers").update({ source: "signup", claimed: true, ...(services.length ? { services } : {}), ...(area ? { areas: [area] } : {}) }).eq("id", id);
  } else {
    const { data, error } = await supabase.from("providers").insert({
      name, phone: `+91${phone}`, whatsapp: `+91${phone}`, city: "kochi", services: services.length ? services : ["renovation"], areas: area ? [area] : [],
      years_experience: Math.round(num(b.years)) || null, source: "signup", claimed: true, verified: false, available: false, edit_token: crypto.randomUUID(),
    }).select("id").single();
    if (error) return { ok: false, say: "Sorry, I couldn't save that just now — the team will call you back." };
    id = data.id;
  }
  const code = loginCode(id);
  const msg = `Hi ${name.split(" ")[0]}, this is WeAid — thanks for joining! Paid ${services.join(", ") || "home-service"} jobs near you will pop up in the WeAid Pro app.\n1. Install: https://weaid.in/pro\n2. Log in with this number and code ${code}\n3. Tap "Verify my ID" (2 minutes)`;
  await sendAdminNotification(`[WeAid] 🙋 New pro from recruiting call — ${name} +91${phone}`,
    `<p style="font-family:sans-serif"><b>${name}</b> +91${phone} — ${services.join(", ") || "trade not clear"}${area ? `, ${area}` : ""}${b.years ? `, ${num(b.years)} yrs` : ""}${b.team_size ? `, team of ${num(b.team_size)}` : ""}.<br>${str(b.notes) ? `Notes: ${str(b.notes).replace(/</g, "&lt;")}<br>` : ""}
     <a href="https://wa.me/91${phone}?text=${encodeURIComponent(msg)}" style="display:inline-block;margin-top:10px;background:#25d366;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">Send the app link on WhatsApp</a></p>`).catch(() => {});
  return { ok: true, say: "Wonderful! You'll get a WhatsApp from We Aid today with the app link and your login code. Install it, verify your ID, and jobs near you will start coming. Thank you!" };
}

const STEPS = { start, quote, book, site_visit: siteVisit, complaint, callback, delivery, recruit };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const want = process.env.PHONE_LINE_KEY || "";
  if (!want || req.headers["x-line-key"] !== want) return res.status(401).json({ error: "unauthorized" });
  const fn = STEPS[req.query.step];
  if (!fn) return res.status(400).json({ error: "unknown step" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    return res.status(200).json(await fn(body));
  } catch (e) {
    console.error(`[phone-line ${req.query.step}]`, e);
    return res.status(200).json({ ok: false, say: "Sorry, I couldn't do that just now. Let me take your number and have someone call you back." });
  }
}

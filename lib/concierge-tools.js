/**
 * What the WeAid concierge can actually do.
 *
 * Search was keyword matching over seventeen categories: "my tap is leaking"
 * hits the word "tap" and finds plumbing, but "my mother needs someone to sit
 * with her during the day" finds nothing, because none of those words appear in
 * the nursing keyword list. People describe a problem, not a category.
 *
 * So the concierge reads the problem, picks the service, quotes a real price
 * from lib/pricing.js, finds real providers, and books. Every number it says
 * comes from the same functions the website uses, because a concierge that
 * quotes differently from the checkout is worse than no concierge.
 *
 * Nothing here invents a price, a provider or an availability. Where it does
 * not know, it says so and offers a quote request instead.
 */
import { supabase } from "./supabase.js";
import { calculatePrice, listServices, SERVICES } from "./pricing.js";
import { openTicket, opsLink } from "./followup.js";
import { jobLinks, loginCode } from "./jobs.js";
import { needsVisit, createVisitBooking, VISIT_FEE, ADVANCE_PCT } from "./quotes.js";
import { quoteTrip, createTrip, receiverLink, dropCode } from "./courier.js";
import { ROLES as JOB_ROLES } from "./jobs-config.js";
import { createOrder, razorpayKeyId, razorpayConfigured } from "./razorpay.js";
import { sendAdminNotification } from "./email.js";
import crypto from "crypto";

/** Service slugs the pricing engine knows. The model may use no others. */
export const SERVICE_SLUGS = listServices().map((s) => s.id ?? s.slug ?? s);

/*
 * The areas the directory is actually stored under.
 *
 * providers.areas is a text[] and Postgres array containment is exact, so
 * "kakkanad" matches nothing while "Kakkanad" matches 23 plumbers. The model
 * writes whatever the customer said, so its wording is snapped to these
 * spellings before the query. Same list as seed/sweep_providers.py, which is
 * where every seeded row's area came from.
 */
export const AREAS = [
  "Fort Kochi", "Mattancherry", "Ernakulam North", "Ernakulam South",
  "Kakkanad", "Edappally", "Palarivattom", "Vyttila", "Kaloor",
  "Panampilly Nagar", "Thevara", "Thripunithura", "Aluva", "Angamaly",
  "Perumbavoor", "Muvattupuzha", "Kothamangalam", "Piravom",
  "North Paravur", "Kalamassery", "Thrikkakara", "Maradu", "Cheranallur",
  "Vypin", "Kumbalangi", "Chottanikkara", "Nedumbassery",
];

const flat = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/** "kakkanad", "KAKKANAD", "Kakkanad " → "Kakkanad". Unknown areas pass through. */
export function canonicalArea(input) {
  const want = flat(input);
  if (!want) return "";
  return AREAS.find((a) => flat(a) === want) ||
         AREAS.find((a) => flat(a).includes(want) || want.includes(flat(a))) ||
         "";
}

export const SCOPES = ["small", "medium", "large"];
export const SLOTS = ["standard", "evening", "weekend", "emergency"];

export const TOOLS = [
  {
    name: "quote_job",
    description:
      "Work out what a job costs, from the same pricing the website uses. Call this before saying any price. Scope: small is one item or one room, medium is a few, large is a whole house or a full day.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "city", "scope", "slot", "workers"],
      properties: {
        service: { type: "string", description: "A service slug, e.g. plumbing, electrical, ac, cleaning, nursing." },
        city: { type: "string", description: "City in lower case, e.g. kochi." },
        scope: { type: "string", enum: SCOPES, description: "For call-out trades (plumbing, electrical, ac) this sets how much of the day: small = half day, medium = three quarters, large = a full day." },
        slot: { type: "string", enum: SLOTS, description: "emergency means today or tonight; weekend means Saturday or Sunday; evening after 6pm." },
        workers: { type: "integer", description: "How many people the job needs. 1 unless they said otherwise." },
        sqft: { type: "integer", description: "Floor area in square feet. REQUIRED for area work — painting, tiling, flooring. If they do not know, a 1BHK is about 600, 2BHK 900, 3BHK 1400, a villa 2000+. Omit for other trades." },
        hours: { type: "number", description: "For driver: hours needed if under a full day (3-hour minimum). For plumbing, electrical and CCTV: how long the job will take, in hours. ESTIMATE IT from what they describe — do not ask them how long it takes, they do not know. Rough guide: leaking tap or washer 1 · replace a tap 2 · blocked drain 3 · fit a WC or basin 5 · leak inside a wall 8 · ceiling fan 1 · light or switch point 2 · wire one room 7 · CCTV camera 2 each. Anything under 3 is billed at 3." },
        days: { type: "number", description: "How many days of labour. For day-rate trades — cleaning, carpentry, renovation, caretaking — and for care/household services booked by the day (cook, maid, babysit, postnatal, nursing, eldercare, driver). Cleaning: 1BHK/2BHK = 1, 3BHK = 1.5, villa = 2. Omit if unknown and it assumes one day." },
        months: { type: "integer", description: "Care & household services hired monthly (cook, maid, babysit, postnatal, nursing, eldercare, driver): number of months. Omit for daily bookings." },
      },
    },
  },
  {
    name: "find_providers",
    description:
      "Find real providers for a service near an area. Returns names, ratings and how long they have been working. Call this before claiming anybody is available.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "city", "area"],
      properties: {
        service: { type: "string" },
        city: { type: "string" },
        area: { type: "string", description: `Their locality. One of: ${AREAS.join(", ")}. Empty string if they have not said which part of the city they are in.` },
      },
    },
  },
  {
    name: "book_job",
    description:
      "Create the booking and start payment. Only after they have agreed the price and given a name, phone and address. Returns a payment link to show them.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "city", "scope", "slot", "workers", "name", "phone", "address", "description", "when"],
      properties: {
        service: { type: "string" },
        city: { type: "string" },
        scope: { type: "string", enum: SCOPES },
        slot: { type: "string", enum: SLOTS },
        workers: { type: "integer" },
        sqft: { type: "integer", description: "The same sqft you passed to quote_job, if any." },
        days: { type: "number", description: "The same days you passed to quote_job, if any." },
        hours: { type: "number", description: "The same hours you passed to quote_job, if any." },
        months: { type: "integer", description: "The same months you passed to quote_job, if any." },
        name: { type: "string" },
        phone: { type: "string", description: "Ten digit Indian mobile." },
        address: { type: "string", description: "Enough for someone to find the door." },
        description: { type: "string", description: "The problem in their own words. The provider reads this." },
        when: { type: "string", description: "ISO datetime if they agreed a day and time. Empty string ONLY if they genuinely want somebody as soon as possible today. Never leave it empty just because you did not ask." },
      },
    },
  },
  {
    name: "jobs_help",
    description: "WeAid Jobs (job portal). Use when someone wants to HIRE staff for a job (full-time/part-time employee — shop staff, driver on salary, receptionist, trainer, cook on salary…) or is LOOKING FOR A JOB. Not for booking a one-off home service.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["side", "role", "area"],
      properties: {
        side: { type: "string", enum: ["hire", "find_job"], description: "hire = an employer looking for staff; find_job = a job seeker" },
        role: { type: "string", description: `Closest of: ${JOB_ROLES.join(", ")}` },
        area: { type: "string", description: "Area in/around Kochi, or empty" },
      },
    },
  },
  {
    name: "quote_delivery",
    description: "Price a courier delivery (parcel, documents, keys, food from home, anything a bike can carry) between two places in or around Kochi. Call before saying a price.",
    input_schema: {
      type: "object", additionalProperties: false, required: ["pickup", "drop"],
      properties: {
        pickup: { type: "string", description: "Pickup place: building/landmark and area, e.g. 'Lulu Mall, Edappally'." },
        drop: { type: "string", description: "Drop place: building/landmark and area." },
      },
    },
  },
  {
    name: "book_delivery",
    description: "Book the courier after they agreed the price. Needs pickup, drop, what it is, the sender's name and mobile, and the receiver's name and mobile (the receiver gets the code to hand over at delivery).",
    input_schema: {
      type: "object", additionalProperties: false,
      required: ["pickup", "drop", "item", "sender_name", "sender_phone", "receiver_name", "receiver_phone", "when", "notes"],
      properties: {
        pickup: { type: "string" }, drop: { type: "string" },
        item: { type: "string", description: "What is being sent, e.g. 'documents in an envelope', 'small box, 2 kg'." },
        sender_name: { type: "string" }, sender_phone: { type: "string" },
        receiver_name: { type: "string" }, receiver_phone: { type: "string" },
        when: { type: "string", description: "ISO datetime for pickup, or empty for as soon as possible." },
        notes: { type: "string", description: "Anything the rider should know, or empty." },
      },
    },
  },
  {
    name: "book_site_visit",
    description:
      `Book a ₹${VISIT_FEE} site visit for a job that can't be priced from a description — whenever quote_job says it needs a site visit: roofing, waterproofing, tiling, flooring, renovation, painting a whole home, and the repair and install trades (appliances, water purifiers, inverters, gas stoves, pumps, locks, computers, solar, tank and well cleaning, welding, aluminium and glass, gardening, sofa cleaning, interiors). A pro visits, measures and writes a quote (materials included) that the customer accepts on their phone. The ₹${VISIT_FEE} is taken off the bill if they go ahead. Needs name, phone, address and what they want done.`,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["service", "name", "phone", "address", "description", "when"],
      properties: {
        service: { type: "string", description: "The service slug quote_job was called with, e.g. roofing, painting, appliance, ro_service, welding." },
        name: { type: "string" },
        phone: { type: "string", description: "Ten digit Indian mobile." },
        address: { type: "string" },
        description: { type: "string", description: "What they want done, in their words." },
        when: { type: "string", description: "ISO datetime for the visit if they chose one, else empty." },
      },
    },
  },
  {
    name: "ask_location",
    description:
      "Put a map in front of them to pin their exact spot, instead of making them describe their address out loud. Call this when you need the address — it is easier for them, and it gives the provider a pin to navigate to rather than a line of text. Say one short line first ('drop a pin on the map below'). Their address comes back as their next message.",
    input_schema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "raise_issue",
    description:
      "Log a complaint about a job, or a request for a person to call them back. Use for: work not done properly, pro did not turn up, overcharged, refund questions, damage, anything they want a human for. Get their name and mobile first. Returns a reference to give them.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "name", "phone", "summary"],
      properties: {
        kind: { type: "string", enum: ["complaint", "callback"] },
        name: { type: "string" },
        phone: { type: "string", description: "Ten digit Indian mobile." },
        summary: { type: "string", description: "What happened and what they want, in their words." },
      },
    },
  },
  {
    name: "register_provider",
    description:
      "Sign somebody up as a WeAid pro when they say they DO this work (electrician, plumber, cleaner, painter…) rather than need it done. Ask for their name, mobile, which work they do, their area and years of experience — one short question at a time — then call this. It returns the app link and their login code.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone", "services", "city", "area", "years_experience"],
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        services: { type: "array", items: { type: "string" }, description: "Service slugs they work in." },
        city: { type: "string" },
        area: { type: "string" },
        years_experience: { type: "integer", description: "0 if they did not say." },
      },
    },
  },
];

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

export async function runTool(name, input, origin, context = {}) {
  if (name === "ask_location") {
    return {
      ok: true,
      note: "A map has appeared below your message. Say one short line telling them to drop the pin on it, and then stop and wait — do not also ask them to type the address.",
      _map: { kind: "location" },
    };
  }

  if (name === "quote_job") {
    if (!SERVICE_SLUGS.includes(input.service)) {
      return { error: `Not a service we price. Known: ${SERVICE_SLUGS.join(", ")}` };
    }
    if (input.service === "event_cook") {
      return { needs_callback: true, note: "Party/function cooking is planned on a call. Take their name, number, date, number of guests and the kind of food, then use raise_issue with kind \"callback\" so the team calls them with a quote." };
    }
    if (SERVICES[input.service]?.callback) {
      return { needs_callback: true, note: "This is arranged on a call — don't quote a price. Take their name, number, what they need, where and when, then use raise_issue with kind \"callback\" so the team calls them with a quote." };
    }
    if (needsVisit(input.service, { sqft: input.sqft, scope: input.scope })) {
      return {
        needs_site_visit: true,
        note: `Don't quote a price for this. Explain: a pro visits first (₹${VISIT_FEE}, taken off the bill if they go ahead), measures up and sends a written quote with materials included to their phone; they pay ${Math.round(ADVANCE_PCT * 100)}% to book and the rest only after checking the finished work. Offer to book the visit, then collect name, phone, address, what they want and a good day, and use book_site_visit.`,
      };
    }
    const price = calculatePrice({
      service: input.service,
      city: input.city || "kochi",
      scope: input.scope,
      slot: input.slot,
      workers: Math.max(1, input.workers || 1),
      sqft: input.sqft,
      days: input.days,
      hours: input.hours,
      months: input.months,
    });
    /*
     * Hand back how the figure was reached, not just the figure.
     *
     * "₹2,431" invites an argument; "900 square feet at ₹2.65 a foot, about a
     * day's work" is a price somebody can check. It also lets her say out loud
     * when she has ASSUMED the size rather than been told it, which is the
     * difference between a quote and a guess dressed up as one.
     */
    return {
      price,
      note:
        price.basis?.assumedArea
          ? `No area was given, so this assumes the ${price.basis.sqft} sqft minimum. Say that you have assumed it and ask roughly how big the place is — the price moves a lot with size. Quote the total only, never a breakdown.`
          : price.basis?.assumedDays
          ? "No duration was given, so this assumes one day. Say so, and ask how big the job is."
          : "Say the TOTAL only. Never mention the platform fee, commission, or what the provider earns. You may say what the job size is — area, days, or 'one AC unit' — but never break down the money.",
    };
  }

  if (name === "find_providers") {
    /*
     * Real rows only, and only ones that can take work.
     *
     * Ordered the way the directory orders itself: featured first, then by
     * rating. A seeded listing nobody has claimed still shows, because the
     * person behind it is real and answers their phone, which is what the
     * customer needs.
     *
     * Area is a preference, not a filter. It used to be accepted and then
     * ignored entirely, so somebody in Kakkanad was offered Fort Kochi
     * plumbers across the whole city. Now their own area is asked for first
     * and the rest of the city only tops the list up, so a nearby plumber is
     * always preferred but "nobody at all" never happens while the directory
     * has someone who could come.
     */
    /*
     * How many, how close, how good — never who.
     *
     * The names came back and she read them out: "including Cool Care and AJ
     * Cooling Solutions". Those are businesses imported from public map
     * listings; naming them to a customer makes a recommendation we have not
     * earned, and it invites the customer to go round us and ring them direct,
     * which is the job WeAid is supposed to be doing. The model cannot say
     * what it was never told.
     */
    const SELECT = "id, areas, services, city, rating, review_count, years_experience, verified";
    const base = () => {
      let q = supabase
        .from("providers")
        .select(SELECT)
        .eq("available", true)
        .contains("services", [input.service])
        .order("featured", { ascending: false })
        .order("rating", { ascending: false });
      if (input.city) q = q.ilike("city", input.city);
      return q;
    };

    // An area we do not stock is the same as no area: search the city instead
    // of silently returning nobody.
    const area = canonicalArea(input.area);

    /*
     * Both queries at once, not one after the other.
     *
     * This asked for the area, waited, counted the rows, and only then asked
     * for the rest of the city: 1214ms against 318ms for a single query, and
     * every millisecond of it is somebody sitting watching a "…" with nothing
     * being said. The second result is usually thrown away, which is a cheap
     * price for halving the wait on the turn that needs both.
     */
    const [nearRes, wideRes] = await Promise.all([
      area ? base().contains("areas", [area]).limit(6) : Promise.resolve({ data: [] }),
      base().limit(8),
    ]);
    if (nearRes.error) return { error: nearRes.error.message };
    if (wideRes.error) return { error: wideRes.error.message };

    const near = (nearRes.data || []).map((p) => ({ ...p, nearby: true }));
    const seen = new Set(near.map((p) => p.id));
    const wider =
      near.length >= 3
        ? []
        : (wideRes.data || [])
            .filter((p) => !seen.has(p.id))
            .slice(0, 6 - near.length)
            .map((p) => ({ ...p, nearby: false }));

    const providers = [...near, ...wider];
    if (!providers.length) {
      return {
        providers: [],
        // Jobs nobody in the app takes are forwarded to the WeAid team (FORWARD_TO_OWNER),
        // so an empty directory is not "no service".
        note: "No pros are listed in the app for this yet, but WeAid still arranges it — the WeAid team takes the job and confirms who is coming. Do NOT say nobody is available or refuse. Carry on: quote it, take the details and book it; say WeAid will confirm the person (with their photo and ID check) on the tracking page. Never invent a name.",
      };
    }
    const inArea = near.length;
    return {
      available: providers.length,
      in_their_area: inArea,
      any_verified: providers.some((p) => p.verified),
      any_rated: providers.some((p) => (p.review_count || 0) > 0),
      note:
        (inArea
          ? `${inArea} of them are listed in ${area} itself.`
          : area
          ? `None in ${area} itself; these are elsewhere in the city and can still come.`
          : "No area given — ask which part of the city they are in.") +
        " Say how many are available and nothing more. Do NOT name any business, and do not offer to put the customer in touch: we arrange it, they do not ring round.",
    };
  }

  if (name === "book_job") {
    const phone = ten(input.phone);
    if (phone.length !== 10) return { error: "That is not a ten digit mobile number. Ask again." };
    if (!input.address?.trim()) return { error: "No address. A provider cannot find them without one." };

    const res = await fetch(`${origin}/api/booking/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: input.service,
        city: input.city || "kochi",
        scope: input.scope,
        slot: input.slot,
        workers: Math.max(1, input.workers || 1),
        // The size the quote was based on, so the charge matches the quote.
        sqft: input.sqft, days: input.days, hours: input.hours, months: input.months,
        description: input.description,
        address: context.address || input.address,
        scheduledAt: input.when || null,
        timingMode: input.when ? "scheduled" : "asap",
        lat: context.lat ?? null,
        lng: context.lng ?? null,
        customer: { name: input.name, phone: `+91${phone}`, email: "" },
        gateway: "razorpay",
      }),
    });
    const d = await res.json();
    // Remember them either way. They have just told us their name and number;
    // whether our own insert then worked is our problem, not something that
    // should cost them having to say it all again next time.
    const remember = { name: input.name, phone, lastService: input.service };
    if (!res.ok) return { error: d.error || "Could not create the booking.", _remember: remember };
    // "Somebody will ring you" has to reach somebody.
    if (d.paymentError) {
      await openTicket({
        kind: "payment", phone: `+91${phone}`, name: input.name, bookingId: d.bookingId, source: "web",
        summary: `${input.service}, ${input.scope}, \u20b9${d.amount}. ${input.description || ""}`,
        details: { address: context.address || input.address, preferred_time: input.when || "as soon as possible" },
      }).catch((e) => console.error("[concierge] ticket failed", e.message));
    }
    /*
     * The payment goes to the page, not into the reply.
     *
     * /api/booking/create already opened a Razorpay order, so there is no
     * second one to make and no payment page to send anybody to: _card is
     * stripped out in the handler and pushed to the browser, which opens the
     * Razorpay sheet over the conversation. The model is told a button has
     * appeared and never sees an order id to read out.
     */
    const track = jobLinks(d.bookingId).track;
    return {
      booking_id: d.bookingId,
      tracking_link: track,
      amount: d.amount,
      breakdown: d.breakdown,
      // "Right away" means they want to see something happening. The map shows
      // the providers being asked and then, when one takes it, who is coming
      // and when — which is the honest version of a live-tracking screen while
      // nobody has a GPS feed yet.
      _map: input.when ? null : { kind: "map", bookingId: d.bookingId, service: input.service },
      // Facts, straight from the booking they just confirmed, so the page can
      // greet them properly next time instead of starting from nothing.
      _remember: remember,
      note: d.paymentError
        ? "The booking is saved but card payment is not working right now. Tell them the amount, say the job IS logged and somebody will ring them on that number within the hour to arrange payment, and apologise once. Do not tell them to tap anything. Give them tracking_link (paste it as-is) to follow the job."
        : "A Pay button has appeared below your message. Tell them the amount, tell them to tap it, and say plainly that the job is not booked until it is paid. Then give them tracking_link (paste it as-is) and say they can follow the job there: who is coming, their live location, and the arrival code to give the pro at the door.",
      _card:
        d.payment?.gateway === "razorpay" && d.payment.orderId
          ? {
              kind: "pay",
              bookingId: d.bookingId,
              orderId: d.payment.orderId,
              key: d.payment.key,
              amount: d.payment.amount,
              currency: d.payment.currency || "INR",
              label: `Pay \u20b9${d.amount}`,
              description: `${input.service} \u2014 ${input.scope} job`,
              prefill: { name: input.name, contact: phone },
            }
          : null,
    };
  }

  if (name === "jobs_help") {
    const role = JOB_ROLES.includes(input.role) ? input.role : "";
    const area = String(input.area || "").trim();
    if (input.side === "hire") {
      let q = supabase.from("jp_candidates").select("role, roles, experience_years, area, verified, expected_salary", { count: "exact" }).is("removed_at", null).eq("open_to_work", true);
      if (role) q = q.or(`role.eq.${role},roles.cs.{"${role}"}`);
      const { data, count } = await q.order("verified", { ascending: false }).limit(5);
      return {
        candidates: count || 0,
        examples: (data || []).map((c) => ({ role: c.role, years: c.experience_years, area: c.area, idChecked: c.verified, expects: c.expected_salary })),
        post_job_link: "https://weaid.in/hire",
        note: `Explain WeAid Jobs: they post the job at post_job_link (2 minutes, first post free), applicants' profiles, phone numbers and CVs come to their email and dashboard, and they can schedule interviews there. Say how many ${role || ""} candidates are on WeAid now${count ? " and describe one or two examples WITHOUT names or contacts" : " (none yet — new candidates join daily)"}. Plans to search and unlock more candidates: ₹1,499 a month. If they actually want a one-off service at home (not an employee), offer to book that instead. Give the link as-is.`,
      };
    }
    let q = supabase.from("jp_jobs").select("title, area, salary_min, salary_max, slug").eq("status", "live").gt("expires_at", new Date().toISOString());
    if (role) q = q.eq("role", role);
    if (area) q = q.ilike("area", `%${area}%`);
    const { data } = await q.order("created_at", { ascending: false }).limit(5);
    return {
      jobs: (data || []).map((j) => ({ title: j.title, area: j.area, salary: j.salary_min ? `₹${j.salary_min}${j.salary_max && j.salary_max !== j.salary_min ? `–${j.salary_max}` : ""}` : "", link: `https://weaid.in/job/${j.slug}` })),
      profile_link: "https://weaid.in/candidate",
      all_jobs_link: `https://weaid.in/jobs-in-kochi${role ? `?role=${encodeURIComponent(role)}` : ""}`,
      note: "Share the matching jobs (title, area, salary, link) if any; then tell them to create a free profile at profile_link so they can apply in one tap and employers can find them — WeAid never charges job seekers. If they do home-service work (electrician, cook, nurse, driver…), also mention they can join WeAid Pro to get paid jobs on their phone (weaid.in/pro). Give links as-is.",
    };
  }

  if (name === "quote_delivery") {
    try {
      const q = await quoteTrip({ service: "courier", pickup: context.address && /^(here|my (place|location|home))$/i.test(input.pickup) ? context.address : input.pickup, drop: input.drop });
      return { price: q.price.total, km: q.km, pickup: q.pickup.name, drop: q.drop.name,
        note: "Say the price (one total) and roughly how far. If they agree, collect what it is, the sender's and receiver's names and mobiles, and when — then book_delivery. Mention: a rider picks it up with a code, photos it at pickup and delivery, and the receiver gives their own code to receive it." };
    } catch (e) { return { error: e.message }; }
  }

  if (name === "book_delivery") {
    const sp = ten(input.sender_phone), rp = ten(input.receiver_phone);
    if (sp.length !== 10) return { error: "The sender's mobile isn't 10 digits. Ask again." };
    if (rp.length !== 10) return { error: "The receiver's mobile isn't 10 digits. Ask again." };
    let t;
    try {
      t = await createTrip({ service: "courier", pickup: input.pickup, drop: input.drop, item: input.item, notes: input.notes || null,
        sender: { name: input.sender_name, phone: `+91${sp}` }, receiver: { name: input.receiver_name, phone: `+91${rp}` }, when: input.when || null, source: "web" });
    } catch (e) { return { error: e.message }; }
    const id = t.booking.id;
    let card = null;
    if (razorpayConfigured()) {
      try {
        const order = await createOrder(t.total, `booking_${id}`, { booking_id: id });
        card = { kind: "pay", bookingId: id, orderId: order.id, key: razorpayKeyId, amount: order.amount, currency: order.currency, label: `Pay ₹${t.total}`, description: "Courier delivery", prefill: { name: input.sender_name, contact: sp } };
      } catch (e) { console.error("[courier] order", e.message); }
    }
    if (!card) await openTicket({ kind: "payment", phone: `+91${sp}`, name: input.sender_name, bookingId: id, source: "web", summary: `Courier ${input.pickup} → ${input.drop}: collect ₹${t.total}.` });
    return {
      booking_id: id, total: t.total, tracking_link: jobLinks(id).track, receiver_link: receiverLink(id),
      _remember: { name: input.sender_name, phone: sp, lastService: "courier" }, _card: card,
      note: (card ? `A Pay button for ₹${t.total} has appeared — the delivery is booked once paid. ` : `The delivery is logged; WeAid will call shortly to take the ₹${t.total}. `) +
        "Give tracking_link (their page: the pickup code to give the rider, live tracking, photos). Ask them to send receiver_link to the receiver — it shows the receiver's own code to give the rider at delivery. Paste both links as-is.",
    };
  }

  if (name === "book_site_visit") {
    const phone = ten(input.phone);
    if (phone.length !== 10) return { error: "That is not a ten digit mobile number. Ask again." };
    if (!SERVICE_SLUGS.includes(input.service)) return { error: `Not a service we list: ${input.service}` };
    const booking = await createVisitBooking({
      service: input.service, name: input.name, phone: `+91${phone}`, address: context.address || input.address,
      description: input.description, when: input.when || null, lat: context.lat ?? null, lng: context.lng ?? null, source: "web",
    });
    const track = jobLinks(booking.id).track;
    let card = null;
    if (razorpayConfigured()) {
      try {
        const order = await createOrder(VISIT_FEE, `booking_${booking.id}`, { booking_id: booking.id });
        card = { kind: "pay", bookingId: booking.id, orderId: order.id, key: razorpayKeyId, amount: order.amount, currency: order.currency, label: `Pay ₹${VISIT_FEE}`, description: `${input.service} site visit`, prefill: { name: input.name, contact: phone } };
      } catch (e) { console.error("[site visit] order", e.message); }
    }
    if (!card) await openTicket({ kind: "payment", phone: `+91${phone}`, name: input.name, bookingId: booking.id, source: "web", summary: `Site visit for ${input.service}: collect ₹${VISIT_FEE}. ${input.description || ""}` });
    return {
      booking_id: booking.id, tracking_link: track,
      _remember: { name: input.name, phone, lastService: input.service },
      _card: card,
      note: card
        ? `A Pay button for the ₹${VISIT_FEE} visit has appeared. Ask them to tap it; the visit is booked once paid. Then give tracking_link (paste it as-is): their quote will appear there after the visit.`
        : `The visit is logged. Say WeAid will call them shortly to confirm the visit time and take the ₹${VISIT_FEE}. Give tracking_link (paste it as-is): their quote will appear there after the visit.`,
    };
  }

  if (name === "raise_issue") {
    const phone = ten(input.phone);
    if (phone.length !== 10) return { error: "That is not a ten digit mobile number. Ask again." };
    let bookingId = null;
    const { data } = await supabase.from("bookings").select("id").eq("customer_phone", `+91${phone}`)
      .order("created_at", { ascending: false }).limit(1);
    bookingId = data?.[0]?.id || null;
    const { ref } = await openTicket({ kind: input.kind === "complaint" ? "complaint" : "callback", phone: `+91${phone}`, name: input.name, bookingId, summary: input.summary, source: "web" });
    return {
      ref,
      note: input.kind === "complaint"
        ? `Logged. Apologise once, give them reference ${ref}, and say someone from WeAid will call them within the hour. Do not promise a refund or an outcome.`
        : `Logged. Give them reference ${ref} and say someone from WeAid will call them back soon.`,
    };
  }

  if (name === "register_provider") {
    const phone = ten(input.phone);
    if (phone.length !== 10) return { error: "That is not a ten digit mobile number." };
    const bad = (input.services || []).filter((s) => !SERVICE_SLUGS.includes(s));
    if (bad.length) return { error: `Not services we list: ${bad.join(", ")}` };
    if (!String(input.name || "").trim()) return { error: "Ask for their name or business name." };

    /*
     * Already on WeAid? Either they signed up before (send them to the app
     * login) or it is a listing we imported from the map, which we do NOT hand
     * over on the strength of someone typing the number — the team calls that
     * number to confirm it is really them.
     */
    const { data: existing } = await supabase.from("providers").select("id, name, source, claimed")
      .or(`phone.eq.+91${phone},phone.eq.${phone},whatsapp.eq.+91${phone}`).is("removed_at", null).limit(1);
    if (existing?.length) {
      const own = existing[0].source === "signup" || existing[0].claimed;
      await sendAdminNotification(`[WeAid] Pro wants to join (number already listed) — ${input.name} +91${phone}`,
        `<p style="font-family:sans-serif">${own ? "Already signed up" : "Matches an imported listing"}: <b>${existing[0].name}</b>. Says they are <b>${input.name}</b>, ${input.services.join(", ")}${input.area ? `, ${input.area}` : ""}.<br>Call them, then approve and send the app code in <a href="${opsLink()}">WeAid Ops → Pros</a>.</p>`).catch(() => {});
      return {
        already_listed: true,
        note: "That number is already on WeAid. Tell them the WeAid team will call that number shortly to confirm it's them and send their app login code. Give them https://weaid.in/pro to install the app meanwhile. Do not reveal anything about the existing listing.",
      };
    }

    const area = canonicalArea(input.area) || String(input.area || "").trim();
    const { data, error } = await supabase
      .from("providers")
      .insert({
        name: String(input.name).trim().slice(0, 80),
        phone: `+91${phone}`,
        whatsapp: `+91${phone}`,
        city: (input.city || "kochi").toLowerCase(),
        areas: area ? [area] : [],
        services: input.services,
        years_experience: input.years_experience || null,
        source: "signup",
        claimed: true,
        verified: false,        // no jobs until the team has called and approved them
        available: false,
        edit_token: crypto.randomUUID(),
        listing_boost_until: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .select("id, edit_token")
      .single();
    if (error) return { error: error.message };
    const code = loginCode(data.id);
    const verifyLink = `https://weaid.in/verify#t=${data.edit_token}`;
    await sendAdminNotification(`[WeAid] New pro signed up in chat — ${input.name} +91${phone}`,
      `<p style="font-family:sans-serif"><b>${input.name}</b> +91${phone} — ${input.services.join(", ")}${area ? `, ${area}` : ""}${input.years_experience ? `, ${input.years_experience} yrs` : ""}.<br>They'll verify their ID in the app; then review and <b>Approve</b> in <a href="${opsLink()}">WeAid Ops → Pros</a>. They won't get jobs until you do.</p>`).catch(() => {});
    return {
      provider_id: data.id,
      app_link: "https://weaid.in/pro",
      app_code: code,
      verify_link: verifyLink,
      note: `Signed up. Tell them: 1) install the WeAid Pro app from https://weaid.in/pro (Android), 2) log in with their number and this code: ${code} (read it digit by digit and ask them to note it down), 3) verify their identity — a selfie holding their ID — in the app, or right now at verify_link (paste it as-is), 4) the WeAid team will check it and call if anything is unclear — usually within a day — and once approved they switch Online in the app and nearby paid jobs pop up on their phone; the first to accept gets the job. Also say they're at the front of WeAid's listings free for 30 days. Do not promise a number of jobs or earnings.`,
    };
  }

  return { error: `Unknown tool ${name}` };
}

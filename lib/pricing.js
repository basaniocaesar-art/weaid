/* ── WeAid Pricing Engine (server-side) ── */

/*
 * How a price is worked out, and where the numbers come from.
 *
 * This used to be a table of invented base prices multiplied by small/medium/
 * large. It priced an electrician's "small job" at ₹573, of which the
 * electrician got ₹501 — about a third of a day's pay in Kochi. Nobody would
 * have accepted the work, and every quote would have had to be renegotiated on
 * the doorstep.
 *
 * It is now built from what a tradesman actually earns, upward:
 *
 *   day rate ÷ what that crew covers in a day = cost per unit
 *   cost per unit ÷ (1 − commission)          = what the customer pays
 *
 * DAY_RATES are real, from jobs Basanio has paid for in Kochi (Oct 2026).
 * CREW and OUTPUT are estimates and are the numbers to argue with — they are
 * the only guesses in here, and changing one changes every price that depends
 * on it. Everything else follows arithmetically.
 */

/** What the worker takes home for a day. Verified, Kochi, October 2026. */
/*
 * Care & household — CUSTOMER prices, agreed with the owner 8 Oct 2026 (his
 * Kochi estimates; adjust here). Commission sits inside the price, like TASKS.
 * Nursing: scope "large" = 24-hour shift, otherwise 12-hour.
 * Driver: the customer's own car ("acting driver") — hourly, daily or monthly.
 */
const CARE_RATES = {
  cook:      { label: "Home cook (2 meals)",               day: 600,  month: 15000 },
  maid:      { label: "Housemaid (3 hours)",                day: 400,  month: 7000 },
  babysit:   { label: "Babysitter (4 hours)",               day: 600,  month: 14000 },
  postnatal: { label: "Mother & baby care (24 hr, live-in)", day: 1500, month: 40000 },
  nursing:   { label: "Home nurse (12 hr)",                 day: 1200, month: 30000, day24: 1800, month24: 45000 },
  eldercare: { label: "Elder care (12 hr)",                 day: 1100, month: 28000 },
  driver:    { label: "Driver for your car",                hour: 250, minHours: 3, day: 1200, month: 20000 },
};

const DAY_RATES = {
  carpenter:   1500,   // 9am–5pm, confirmed
  electrician: 1350,   // 10am–5pm, confirmed
  tiler:       1500,   // confirmed
  // Not yet confirmed — set to the band the confirmed trades sit in.
  plumber:     1350,
  painter:     1350,
  ac_tech:     1350,
  mason:       1400,
  helper:      800,    // unskilled second pair of hands
  cleaner:     900,
  nurse:       1200,
  tutor:       600,    // per session, not a day
};

/*
 * How much ground a crew covers in a day. ESTIMATES — the weakest numbers here.
 * Worth checking against one real job each before trusting a quote to a
 * customer, because a 20% error in output is a 20% error in every price.
 */
const SQFT_PER_DAY = {
  tiling:    120,   // tiler + helper, floor tile incl. levelling
  flooring:  140,   // same crew, vitrified
  painting:  500,   // one painter, two coats — of WALL, see SURFACE_FACTOR
  cleaning:  800,   // two cleaners, full deep clean
};

/*
 * Floor area is not always the work area.
 *
 * A customer says "900 square feet" meaning the size of their flat. For
 * cleaning and tiling that IS the job — you clean and tile the floor. For
 * painting it is not: the work is walls and ceiling, which in a typical flat
 * comes to around three times the floor area once internal partitions are
 * counted. Without this, painting a 2BHK came out at ₹2,810 against ₹2,431 to
 * clean it, which anybody who has painted a room would laugh at.
 *
 * 3.0 is the usual trade rule of thumb for interior walls plus ceiling, less
 * windows and doors. An estimate, like the outputs above.
 */
const SURFACE_FACTOR = {
  painting: 3.0,
  tiling:   1.0,
  flooring: 1.0,
  cleaning: 1.0,
};

const PLATFORM_FEE = 49;

/** Cost of the crew a trade needs for one day. */
const CREW_COST = {
  tiling:   DAY_RATES.tiler + DAY_RATES.helper,
  flooring: DAY_RATES.tiler + DAY_RATES.helper,
  painting: DAY_RATES.painter,
  cleaning: DAY_RATES.cleaner * 2,
};

/*
 * Fixed-price tasks — the Urban Company model, and the one that actually
 * matches the market.
 *
 * The rest of this file prices upward from what labour costs. That is the
 * wrong end for common household jobs: a cleaner's day in Kochi is ₹900, but
 * Urban Company sells three hours of cleaning for ₹3,199. The gap between
 * informal labour cost and what somebody will pay for a branded, fixed-price,
 * someone-turns-up service IS the business. Pricing off cost gives that gap
 * away.
 *
 * So these are priced from the market in, not from the wage out:
 *   price  what the customer pays, all in — no platform fee on top
 *   pay    what the provider gets
 *   the difference is the margin, and it is far better than a commission
 *
 * Every number here must come from a real job. AC is Basanio's: he charges
 * ₹750 and pays the technician ₹500. Nothing goes in this table on a guess.
 */
const TASKS = {
  ac: { label: "AC service, per unit", price: 750, pay: 500, minutes: 60 },
};

/**
 * Four ways a job gets priced, because trade work is sold four ways:
 *
 *   visit  a call-out. Nobody comes for less than half a day's pay, so that is
 *          the floor however small the job.
 *   day    labour by the day, which is how carpentry, wiring and masonry are
 *          actually bought.
 *   sqft   area work. Tiling, painting, flooring, deep cleaning.
 */
const SERVICES = {
  /*
   * ── hours: estimated time, with a floor ──────────────────────────────────
   *
   * Plumbing and wiring vary too much for one call-out price — a washer is an
   * hour, a leak behind a wall is most of a day. So the concierge finds out
   * what is actually wrong, estimates the hours, and the price follows.
   *
   * Three hours is the floor however small the job. A plumber crossing Kochi
   * for twenty minutes' work has still lost half his morning, and a price that
   * ignores that gets declined — which costs the customer more than the extra
   * would have.
   */
  plumbing:     { mode: "hours", worker: "plumber",     minHours: 3, commission: 0.125 },
  electrical:   { mode: "hours", worker: "electrician", minHours: 3, commission: 0.125 },
  ac:           { mode: "task" },   // see TASKS — real price, real payout

  // ── day: bought by the day ────────────────────────────────────────────────
  carpentry:    { mode: "day",  worker: "carpenter",   commission: 0.125 },
  renovation:   { mode: "day",  worker: "mason",       crew: 2, commission: 0.08 },
  caretaking:   { mode: "day",  worker: "helper",      commission: 0.12 },
  nursing:      { mode: "care", commission: 0.12 },
  eldercare:    { mode: "care", commission: 0.12 },

  // ── sqft: area work ───────────────────────────────────────────────────────
  /*
   * Cleaning is a day's work for two people, not a per-foot calculation.
   *
   * It was priced per square foot, which then computed that 900 sqft was 1.1
   * days — arithmetic to arrive at the thing you could just say. A crew turns
   * up, they clean the flat, they leave. Size changes how many days, not the
   * unit. Basanio's call, and it is how the job is actually bought.
   */
  cleaning:     { mode: "day",  worker: "cleaner", crew: 2, commission: 0.15 },
  painting:     { mode: "sqft", job: "painting", minSqft: 300,  commission: 0.12 },
  tiling:       { mode: "sqft", job: "tiling",   minSqft: 80,   commission: 0.12 },
  flooring:     { mode: "sqft", job: "flooring", minSqft: 80,   commission: 0.12 },

  // ── flat-priced: unchanged, these are genuinely fixed-price services ──────
  pickup:       { mode: "flat", base: 799,  commission: 0.10 },
  movers:       { mode: "flat", base: 1500, commission: 0.12 },
  tutor:        { mode: "flat", base: 600,  commission: 0.15 },
  laundry:      { mode: "flat", base: 300,  commission: 0.15 },
  haircut:      { mode: "flat", base: 399,  commission: 0.15 },
  barber:       { mode: "flat", base: 199,  commission: 0.15 },
  nails:        { mode: "flat", base: 499,  commission: 0.15 },
  makeup:       { mode: "flat", base: 999,  commission: 0.12 },
  facial:       { mode: "flat", base: 699,  commission: 0.15 },
  waxing:       { mode: "flat", base: 499,  commission: 0.15 },
  mehendi:      { mode: "flat", base: 799,  commission: 0.10 },
  massage:      { mode: "flat", base: 999,  commission: 0.12 },
  physio:       { mode: "flat", base: 799,  commission: 0.10 },
  trainer:      { mode: "flat", base: 599,  commission: 0.12 },
  yoga:         { mode: "flat", base: 499,  commission: 0.10 },
  babysit:      { mode: "care", commission: 0.12 },
  pet_grooming: { mode: "flat", base: 599,  commission: 0.15 },
  pet_walking:  { mode: "flat", base: 299,  commission: 0.15 },
  cctv:         { mode: "hours", worker: "electrician", minHours: 3, commission: 0.125 },
  pest_control: { mode: "visit", worker: "cleaner", commission: 0.15 },

  // ── care & household: daily or monthly, see CARE_RATES ───────────────────
  cook:         { mode: "care", commission: 0.12 },
  maid:         { mode: "care", commission: 0.12 },
  postnatal:    { mode: "care", commission: 0.12 },
  driver:       { mode: "care", commission: 0.12 },
  event_cook:   { mode: "flat", base: 99, commission: 0.10, quoteOnly: true },
  courier:      { mode: "distance", vehicle: "courier", commission: 0.20 },  // lib/courier.js
  bike_ride:    { mode: "distance", vehicle: "bike", commission: 0.15, hidden: true },

  // ── quote jobs: priced after a ₹99 site visit (lib/quotes.js) ─────────────
  // The 99 here is only the visit fee; the job itself is the written quote.
  roofing:      { mode: "flat", base: 99, commission: 0.08, quoteOnly: true },
  waterproofing:{ mode: "flat", base: 99, commission: 0.10, quoteOnly: true },
};

/*
 * City multiplier. The day rates above ARE Kochi, so Kochi is 1.0 and
 * everywhere else is relative to it — the old table had Kochi at 1.15, which
 * silently inflated the one city we have real numbers for.
 */
const AREA_MULTIPLIERS = {
  mumbai:    1.35,
  delhi:     1.30,
  bangalore: 1.25,
  hyderabad: 1.20,
  chennai:   1.18,
  pune:      1.15,
  kochi:     1.00,   // the baseline: all day rates above are Kochi rates
  ahmedabad: 1.00,
  jaipur:    0.95,
};
const DEFAULT_AREA_MULTIPLIER = 0.95;

const SLOT_MULTIPLIERS = {
  standard:  1.0,
  evening:   1.15,
  weekend:   1.25,
  emergency: 1.50,
};

/**
 * What a job costs.
 *
 * Takes whatever the concierge managed to find out. A missing sqft or days
 * falls back to a sensible default rather than refusing to quote — a rough
 * price now beats an interrogation, and the number is shown as "from" so it
 * can be corrected on site.
 *
 *   calculatePrice({ service:"tiling",   city:"kochi", sqft: 250 })
 *   calculatePrice({ service:"carpentry",city:"kochi", days: 2 })
 *   calculatePrice({ service:"plumbing", city:"kochi" })          → half-day call-out
 */
export function calculatePrice({ service, city, scope, slot, workers, sqft, days, hours, months }) {
  const svc = SERVICES[service];
  if (!svc) throw new Error(`Unknown service: ${service}`);

  const areaM = AREA_MULTIPLIERS[city?.toLowerCase()] ?? DEFAULT_AREA_MULTIPLIER;
  const slotM = SLOT_MULTIPLIERS[slot] ?? 1.0;
  /*
   * Crew size, counted once.
   *
   * Some trades carry their own crew — cleaning is two people, renovation is a
   * mason and a helper — and that is already in CREW_COST or svc.crew. When the
   * concierge ALSO passed workers=2 for cleaning it multiplied a second time
   * and a 3BHK quoted ₹5,767 instead of ₹3,225. Where the trade defines its
   * crew, that is the crew; `workers` only applies to trades where sending more
   * people is genuinely the customer's choice.
   */
  const fixedCrew = svc.crew != null || svc.mode === "sqft";
  const n = fixedCrew ? 1 : Math.max(1, Number(workers) || 1);
  // Each extra worker adds 80%: shared travel and setup make two people cheaper
  // than twice one person.
  const workerM = 1 + (n - 1) * 0.8;

  let labour;            // what the work costs before city/slot/commission
  const basis = {};      // shown to the customer so the price is explainable

  if (svc.mode === "sqft") {
    const rate = CREW_COST[svc.job] / SQFT_PER_DAY[svc.job];   // ₹ per sqft of WORK
    // Below the minimum it is still a day's mobilisation, so the minimum bites.
    const floor = Math.max(svc.minSqft, Math.round(Number(sqft) || svc.minSqft));
    const factor = SURFACE_FACTOR[svc.job] ?? 1.0;
    const worked = floor * factor;          // what actually gets covered
    labour = rate * worked;
    basis.sqft = floor;                     // what they told us
    basis.workedSqft = Math.round(worked);  // what gets painted/cleaned/tiled
    basis.surfaceFactor = factor;
    // Quoted against THEIR number, so "₹X a square foot" matches the area they
    // gave rather than an internal figure they never mentioned.
    basis.perSqft = Math.round((rate * factor) / (1 - svc.commission) * 100) / 100;
    basis.assumedArea = !sqft;
    basis.daysOfWork = Math.round((worked / SQFT_PER_DAY[svc.job]) * 10) / 10;
  } else if (svc.mode === "day") {
    const crew = (svc.crew || 1);
    const d = Math.max(0.5, Number(days) || 1);
    labour = DAY_RATES[svc.worker] * crew * d;
    basis.days = d;
    basis.assumedDays = !days;
    basis.dayRate = Math.round(DAY_RATES[svc.worker] * crew / (1 - svc.commission));
  } else if (svc.mode === "hours") {
    /*
     * Hours of a tradesman's day. HOURS_PER_DAY is 8 — the carpenter works 9
     * to 5 — so an hour is a day rate divided by eight, and anything under the
     * floor is billed at the floor.
     */
    const HOURS_PER_DAY = 8;
    const asked = Number(hours) || 0;
    const billed = Math.max(svc.minHours, asked);
    labour = (DAY_RATES[svc.worker] / HOURS_PER_DAY) * billed;
    basis.hours = billed;
    basis.estimatedHours = asked || null;
    basis.atMinimum = billed > asked;
    basis.assumedHours = !asked;
    basis.minHours = svc.minHours;
  } else if (svc.mode === "visit") {
    /*
     * A call-out. Nobody travels across Kochi for one tap and an hour's pay, so
     * half a day is the floor. Scope lifts it toward a full day, which is the
     * honest reading of "a few things" versus "one thing".
     */
    const fraction = scope === "large" ? 1.0 : scope === "medium" ? 0.75 : 0.5;
    labour = DAY_RATES[svc.worker] * fraction;
    basis.hours = Math.round(fraction * 8);
    basis.callOut = true;
  } else if (svc.mode === "care") {
    /*
     * Fixed customer prices, returned whole like TASKS: ₹600 a day means ₹600.
     * months → monthly rate; hours (driver) → hourly with a floor; else days.
     */
    const r = CARE_RATES[service];
    const h24 = service === "nursing" && scope === "large";
    const m = Number(months) || 0;
    let total, b;
    if (m > 0) {
      const per = h24 ? r.month24 : r.month;
      total = per * m; b = { months: m, perMonth: per };
    } else if (service === "driver" && Number(hours) > 0 && Number(hours) < 8) {
      const hrs = Math.max(r.minHours, Math.ceil(Number(hours)));
      total = r.hour * hrs; b = { hours: hrs, perHour: r.hour, minHours: r.minHours };
    } else {
      const d = Math.max(1, Math.round(Number(days) || 1));
      const per = h24 ? r.day24 : r.day;
      total = per * d; b = { days: d, perDay: per, assumedDays: !days };
    }
    total = Math.round(total * (slot === "emergency" ? 1.25 : 1));
    const commission = Math.round(total * svc.commission);
    return {
      service, city, scope, slot, mode: "care",
      basis: { ...b, label: h24 ? r.label.replace("12 hr", "24 hr") : r.label, fixedPrice: true, shift: service === "nursing" ? (h24 ? "24 hr" : "12 hr") : null },
      subtotal: total, platformFee: 0, total, commission, providerEarnings: total - commission,
    };
  } else if (svc.mode === "distance") {
    // Courier / bike ride: a fixed customer price from the road distance.
    const r = TRIP_RATES[svc.vehicle];
    const km = Math.max(0, Number(arguments[0].km) || 0);
    const total = Math.max(r.min, Math.round((r.base + r.perKm * km) / 5) * 5);
    const commission = Math.round(total * svc.commission);
    return { service, city, scope, slot, mode: "distance", basis: { km: Math.round(km * 10) / 10, fixedPrice: true },
      subtotal: total, platformFee: 0, total, commission, providerEarnings: total - commission };
  } else if (svc.mode === "task") {
    /*
     * A fixed price, returned whole. No commission arithmetic, no platform fee
     * on top — ₹750 means ₹750, because that is the most a customer will pay
     * for an AC service and ₹799 is a different, worse number.
     */
    const t = TASKS[service];
    const uplift = slotM * areaM;
    const total = Math.round(t.price * uplift);
    const pay = Math.round(t.pay * uplift);
    return {
      service, city, scope, slot,
      mode: "task",
      basis: { task: t.label, minutes: t.minutes, fixedPrice: true },
      subtotal: total,
      platformFee: 0,
      total,
      commission: total - pay,
      providerEarnings: pay,
    };
  } else {
    labour = svc.base;            // genuinely fixed-price services
  }

  const subtotal = Math.round(labour * areaM * slotM * workerM / (1 - svc.commission));
  const total = subtotal + PLATFORM_FEE;
  const commission = Math.round(subtotal * svc.commission);

  return {
    service, city, scope, slot,
    mode: svc.mode,
    basis,
    subtotal,
    platformFee: PLATFORM_FEE,
    total,
    commission,
    providerEarnings: subtotal - commission,
  };
}

// ── Trip fare (rides + courier): distance-based, per-km ──
const TRIP_RATES = {
  bike:    { base: 25, perKm: 8,  min: 35, commission: 0.15 },
  auto:    { base: 35, perKm: 12, min: 45, commission: 0.15 },
  car:     { base: 60, perKm: 16, min: 80, commission: 0.18 },
  courier: { base: 40, perKm: 12, min: 50, commission: 0.20 },
};

export function calculateFare({ vehicle = "car", distanceKm = 0 }) {
  const r = TRIP_RATES[vehicle] || TRIP_RATES.car;
  const raw = Math.round(r.base + r.perKm * (Number(distanceKm) || 0));
  const subtotal = Math.max(r.min, raw);
  const commission = Math.round(subtotal * r.commission);
  return {
    vehicle,
    distanceKm: Math.round((Number(distanceKm) || 0) * 10) / 10,
    subtotal,
    total: subtotal,
    commission,
    providerEarnings: subtotal - commission,
  };
}

export function listServices() {
  return Object.entries(SERVICES).map(([key, val]) => ({
    id: key,
    mode: val.mode,
    // A "from" figure for browsing: the smallest honest price for this trade.
    basePrice: val.mode === "flat" ? val.base : calculatePrice({ service: key, city: "kochi" }).total,
    commission: val.commission,
  }));
}

export { CARE_RATES };
export { SERVICES, TASKS, AREA_MULTIPLIERS, SLOT_MULTIPLIERS, PLATFORM_FEE, DAY_RATES, SQFT_PER_DAY, SURFACE_FACTOR };

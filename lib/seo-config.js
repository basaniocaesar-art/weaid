/**
 * Search-page settings and copy — safe to use in the browser (no database code).
 * Server-only data loading lives in lib/seo.js.
 */
export const SITE = "https://weaid.in";
export const MIN_PER_PAGE = 3;

// URL slug, names and page copy per service. Keys match providers.services[].
export const SERVICES = {
  painting: {
    slug: "painters", plural: "Painters", one: "painter", trade: "house painting", arranged: true,
    price: "Single rooms are priced instantly; a whole home gets a ₹99 site visit and a written quote.",
    jobs: ["interior wall painting", "exterior painting before or after the monsoon", "putty, primer and crack repair", "texture and accent walls", "repainting before moving in"],
    faq: [
      ["How is house painting priced?", "One or two rooms are priced from the floor area. For a whole home, a pro visits (₹99, taken off the bill if you go ahead) and sends a written quote with paint and materials included."],
      ["How do I pay for a big painting job?", "35% to book once you accept the quote — refundable until work starts — and the rest only after you've checked the finished walls."],
    ],
  },
  tiling: {
    slug: "tiling-contractors", plural: "Tiling Contractors", one: "tiling contractor", trade: "tiling and flooring", arranged: true,
    price: "Every tiling job starts with a ₹99 site visit and a written quote, materials included.",
    jobs: ["floor and wall tiling", "bathroom and kitchen re-tiling", "replacing broken or hollow tiles", "vitrified and granite flooring", "skirting and grouting"],
    faq: [
      ["Why is there a site visit for tiling?", "Tiling depends on the floor underneath, how much has to come up and the tiles you choose. A pro measures first, so the quote is the price — no surprises halfway through."],
      ["Are tiles included in the quote?", "Yes — the written quote includes materials and labour, itemised, so you can see exactly what you're paying for."],
    ],
  },
  roofing: {
    slug: "roofing-contractors", plural: "Roofing Contractors", one: "roofing contractor", trade: "roofing and roof repair", arranged: true,
    price: "₹99 site visit (taken off the bill if you go ahead), then a written quote with materials included.",
    jobs: ["roof leak repair before the monsoon", "GI and aluminium sheet roofing", "Mangalore tile re-roofing", "steel truss work", "gutters and roof waterproofing"],
    faq: [
      ["How much does roof repair cost in Kochi?", "It depends on the roof type, the area and what's damaged, so a pro visits first (₹99) and sends a written, itemised quote with materials included. You pay 35% to book and the rest after the work is done."],
      ["Can you fix a roof leak before the monsoon?", "Yes — monsoon leak repairs are the most common roofing job. Book a site visit early; slots fill up in May and June."],
      ["Is the work guaranteed?", "If something isn't right after the job, report it from your WeAid booking page and WeAid sends the team back to fix it."],
    ],
  },
  waterproofing: {
    slug: "waterproofing", plural: "Waterproofing Services", one: "waterproofing expert", trade: "waterproofing", arranged: true,
    price: "₹99 site visit, then a written quote with materials included.",
    jobs: ["terrace and roof waterproofing", "bathroom leak waterproofing", "wall dampness and seepage", "water tank waterproofing", "crack filling and sealing"],
    faq: [
      ["How do I stop dampness on my walls?", "The cause has to be found first — a terrace leak, a bathroom above, or rising damp. A pro visits (₹99), finds the source and quotes the fix."],
      ["When is the best time to waterproof in Kerala?", "Before the monsoon, from January to April, when surfaces are dry enough to treat properly."],
    ],
  },
  carpentry: {
    slug: "carpenters", plural: "Carpenters", one: "carpenter", trade: "carpentry", arranged: true,
    jobs: ["door and window repairs", "furniture assembly and repair", "kitchen cabinet fixing", "wardrobe and shelf work", "lock and hinge replacement"],
    faq: [["How is carpentry priced?", "By the day — half a day for small repairs. You see the price before you book."]],
  },
  pest_control: {
    slug: "pest-control", plural: "Pest Control", one: "pest control expert", trade: "pest control", arranged: true,
    jobs: ["cockroach and ant treatment", "termite treatment", "bed bug treatment", "rodent control", "mosquito treatment"],
    faq: [["Is pest control safe with children at home?", "Tell us when you book; the team will explain how long to keep children and pets out of treated rooms."]],
  },
  cook: {
    slug: "home-cooks", plural: "Home Cooks", one: "home cook", trade: "home cooking", arranged: true,
    price: "Part-time home cook (2 meals): ₹600 a day or ₹15,000 a month.",
    jobs: ["daily breakfast, lunch or dinner", "Kerala meals, North Indian and diet food", "cooking for elderly parents", "tiffin preparation", "party and function cooking (quoted separately)"],
    faq: [
      ["How much does a home cook cost in Kochi?", "On WeAid a part-time cook for two meals a day is ₹600 a day, or ₹15,000 a month. Party and function cooking is quoted separately."],
      ["Is the cook verified?", "Every WeAid cook has their photo ID checked by WeAid before they're sent to a home, and you see their photo before they arrive."],
    ],
  },
  maid: {
    slug: "maids", plural: "Housemaids", one: "housemaid", trade: "housekeeping", arranged: true,
    price: "Part-time housemaid (3 hours): ₹400 a day or ₹7,000 a month.",
    jobs: ["sweeping and mopping", "washing vessels", "laundry and ironing", "bathroom cleaning", "daily or alternate-day help"],
    faq: [
      ["How much is a part-time maid in Kochi?", "On WeAid a housemaid for 3 hours is ₹400 a day, or ₹7,000 a month."],
      ["What if the maid doesn't come?", "Report it from your booking page — WeAid arranges a replacement or adjusts what you pay."],
    ],
  },
  babysit: {
    slug: "babysitters", plural: "Babysitters", one: "babysitter", trade: "babysitting and child care", arranged: true,
    price: "Babysitter (4 hours): ₹600, or ₹14,000 a month for daytime care.",
    jobs: ["daytime child care while parents work", "evening babysitting", "after-school care", "help with infants and toddlers", "occasional or monthly care"],
    faq: [
      ["Are babysitters background-checked?", "Every WeAid babysitter has their photo ID checked, and those with a Kerala Police clearance certificate show a Police-verified badge. You see their photo and checks before they arrive."],
      ["How much does a babysitter cost?", "₹600 for a 4-hour visit, or ₹14,000 a month for daytime care."],
    ],
  },
  postnatal: {
    slug: "post-delivery-care", plural: "Mother & Baby Care", one: "mother and baby caregiver", trade: "post-delivery mother and baby care", arranged: true,
    price: "24-hour live-in mother & baby care: ₹1,500 a day or ₹40,000 a month.",
    jobs: ["newborn bathing and care", "mother's post-delivery care and rest", "night feeds and settling", "traditional Kerala post-natal care", "live-in support for the first weeks"],
    faq: [
      ["How much does post-delivery care cost in Kochi?", "On WeAid, 24-hour live-in mother and baby care is ₹1,500 a day or ₹40,000 a month."],
      ["When should I book?", "A few weeks before the due date is best, so the caregiver can start the day you come home."],
    ],
  },
  nursing: {
    slug: "home-nurses", plural: "Home Nurses", one: "home nurse", trade: "home nursing", arranged: true,
    price: "Home nurse: ₹1,200 for a 12-hour shift or ₹1,800 for 24 hours; monthly from ₹30,000.",
    jobs: ["post-hospital care at home", "bedridden patient care", "medication and vitals", "wound dressing and feeding", "12-hour or 24-hour shifts"],
    faq: [
      ["How much is a home nurse in Kochi?", "On WeAid, ₹1,200 for a 12-hour shift, ₹1,800 for 24 hours, or ₹30,000 / ₹45,000 a month."],
      ["Can a nurse stay overnight?", "Yes — choose a 24-hour shift."],
    ],
  },
  eldercare: {
    slug: "elder-care", plural: "Elder Care", one: "elder caregiver", trade: "elder care at home", arranged: true,
    price: "Elder care (12 hours): ₹1,100 a day or ₹28,000 a month.",
    jobs: ["companionship and daily help", "bathing and mobility support", "meals and medicines on time", "care for parents living alone", "hospital visit accompaniment"],
    faq: [
      ["My parents are in Kochi and I'm abroad — can you help?", "Yes. Book on WeAid from anywhere; you'll see the caregiver's photo and checks, and get updates on the booking page."],
      ["How much does elder care cost?", "₹1,100 for a 12-hour day, or ₹28,000 a month."],
    ],
  },
  driver: {
    slug: "acting-drivers", plural: "Acting Drivers", one: "driver", trade: "a driver for your own car", arranged: true,
    price: "A driver for your own car: ₹250 an hour (3-hour minimum), ₹1,200 a day, or ₹20,000 a month.",
    jobs: ["airport and railway station drops in your car", "a driver for the day or a function", "monthly driver for office runs", "outstation trips", "driving for elderly parents"],
    faq: [
      ["Do you provide the car?", "No — a WeAid driver drives YOUR car. Every driver's licence is checked by WeAid."],
      ["How much is an acting driver in Kochi?", "₹250 an hour (3-hour minimum), ₹1,200 for a full day, or ₹20,000 a month."],
    ],
  },

  electrical: {
    slug: "electricians", plural: "Electricians", one: "electrician", trade: "electrical work",
    jobs: ["wiring and rewiring", "switch, socket and MCB repairs", "fan and light installation", "inverter and UPS fitting", "earthing and short-circuit faults"],
    faq: [
      ["How quickly can an electrician come?", "Most electricians on WeAid work locally and can come the same day for urgent faults like a tripping MCB or no power. Book through WeAid and the nearest available electrician is sent."],
      ["Do I pay through WeAid?", "Yes — you see the price before you book and pay WeAid securely. The electrician is paid after the job, and if something isn't right WeAid sends someone back."],
    ],
  },
  plumbing: {
    slug: "plumbers", plural: "Plumbers", one: "plumber", trade: "plumbing",
    jobs: ["leaking taps and pipes", "blocked drains and toilets", "water tank and motor connections", "bathroom fittings", "new pipelines"],
    faq: [
      ["Can a plumber come for a small leak?", "Yes — small jobs like a leaking tap or a blocked sink are the most common call. Tell WeAid the problem and we send the nearest available plumber."],
      ["Do plumbers bring their own materials?", "Most bring basic tools and common fittings; for new taps, pipes or a motor they will tell you what to buy, or buy it and add it to the bill."],
    ],
  },
  ac: {
    slug: "ac-repair", plural: "AC Repair & Service", one: "AC technician", trade: "AC repair and service",
    price: "On WeAid, a standard AC service is ₹750 per unit, all in.",
    jobs: ["AC servicing and cleaning", "gas refilling", "AC not cooling", "installation and uninstallation", "water leakage from the indoor unit"],
    faq: [
      ["How much does an AC service cost?", "On WeAid a standard AC service is ₹750 per unit, all in. Gas top-ups and repairs are priced after the technician checks the unit."],
      ["How often should an AC be serviced in Kochi?", "Kochi's humidity and dust mean most homes service split ACs every 3–4 months of regular use, and before the summer."],
    ],
  },
  cleaning: {
    slug: "cleaning-services", plural: "Cleaning Services", one: "cleaner", trade: "home cleaning",
    jobs: ["full home deep cleaning", "kitchen and bathroom cleaning", "sofa and carpet cleaning", "move-in / move-out cleaning", "office cleaning"],
    faq: [
      ["How long does a deep clean take?", "A full deep clean of a 2–3 bedroom home usually takes a team of two most of a day."],
      ["Do cleaners bring their own supplies?", "Professional cleaning services bring their own equipment and cleaning products — WeAid confirms what's included when you book."],
    ],
  },
  movers: {
    slug: "packers-and-movers", plural: "Packers & Movers", one: "mover", trade: "packing and moving",
    price: "On WeAid, local moves within the city start from ₹1,500.",
    jobs: ["house shifting", "office relocation", "packing and unpacking", "vehicle transport", "local and outstation moves"],
    faq: [
      ["How much do packers and movers cost in Kochi?", "On WeAid, local moves within the city start from ₹1,500; the final price depends on how much you're moving, the distance and the floor."],
      ["Should I get more than one quote?", "Yes — call two or three movers below with the same list of items and compare."],
    ],
  },
};
export const SERVICE_BY_SLUG = Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [v.slug, k]));

export const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");


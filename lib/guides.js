/**
 * Guides — the questions people search before they book, answered with
 * WeAid's real Kochi prices (from lib/pricing.js, checked 9 Oct 2026; update
 * these if pricing changes). Browser-safe: plain data.
 *
 * Each guide: slug, title, description, service (seo-config key it links to),
 * ask (pre-filled chat request), updated, and sections [heading, paragraphs|list].
 */
export const GUIDES = [
  {
    slug: "ac-service-cost-kochi",
    title: "AC service cost in Kochi (2026): what you should pay",
    description: "What an AC service costs in Kochi, what's included, how often to service in Kerala's humidity, and when you need gas or a repair instead.",
    service: "ac", ask: "I need an AC service", updated: "2026-10-09",
    sections: [
      ["The short answer", ["On WeAid, a standard split-AC service in Kochi is ₹750 per unit, all in — the price you see is the price you pay. Gas top-ups and repairs are priced separately, after the technician has checked the unit and told you what's wrong."]],
      ["What a standard service includes", { list: ["Cleaning the indoor unit's filters and fins", "Clearing the drain line so water doesn't leak inside", "Checking cooling and airflow once it's running again", "Telling you if anything else needs attention — before any extra work is done"] }],
      ["How often should you service an AC in Kochi?", ["Kochi's humidity and dust clog filters faster than in drier cities. For an AC used every day, a service every 3–4 months keeps it cooling well and running cheaper. At the very least, service it before the summer — demand for AC technicians peaks in March and April, so booking in February avoids the wait."]],
      ["Signs you need more than a service", { list: ["It runs but barely cools even after cleaning — often low gas", "Water dripping from the indoor unit — usually a blocked drain line", "Ice on the pipes, or a burning smell — switch it off and book a check", "The outdoor unit doesn't start — often a capacitor or electrical fault"] }],
      ["Avoiding surprises", ["Ask for the price before anyone comes, and agree any extra work before it's done. On WeAid you see the technician's photo and ID check before they arrive, and you pay through WeAid — if the work isn't right, WeAid sends someone back."]],
    ],
  },
  {
    slug: "plumber-charges-kochi",
    title: "Plumber charges in Kochi (2026): a fair price for common jobs",
    description: "How much a plumber costs in Kochi for a leaking tap, a blocked drain or a half-day job — and why there's a minimum call-out charge.",
    service: "plumbing", ask: "I need a plumber", updated: "2026-10-09",
    sections: [
      ["The short answer", ["On WeAid, a small plumbing job in Kochi — a leaking tap, a blocked sink, a running toilet — is ₹628. A half-day job (around 4 hours) is ₹820, and a full day is ₹1,592. Evening visits are ₹714 for a small job, and an urgent same-day call-out is ₹917."]],
      ["Why is there a minimum charge?", ["A plumber crossing Kochi for twenty minutes of work has still lost a large part of the morning to travel. That's why small jobs are charged at a minimum of three hours' work. A price that ignores the travel usually means nobody turns up."]],
      ["Parts and materials", ["Taps, pipes, valves and fittings are extra. A good plumber tells you what's needed and what it costs before buying it — or tells you what to buy yourself. Agree it before the work starts."]],
      ["Common jobs", { list: ["Leaking tap or washer — usually under an hour", "Blocked kitchen sink or bathroom drain — 1–3 hours", "Fitting a new tap, shower or flush — 1–2 hours", "Water tank or motor connection — half a day", "A leak inside a wall — often most of a day, because the wall has to be opened and closed"] }],
      ["Before the plumber arrives", { list: ["Note where the main water valve is", "Take a photo of the problem — it helps the plumber bring the right parts", "Clear the area under the sink or around the toilet"] }],
    ],
  },
  {
    slug: "home-nurse-charges-kerala",
    title: "Home nurse charges in Kochi: 12-hour vs 24-hour care (2026)",
    description: "What a home nurse costs in Kochi per day and per month, the difference between a home nurse and an elder caregiver, and what to check before you hire.",
    service: "nursing", ask: "I need a home nurse", updated: "2026-10-09",
    sections: [
      ["The short answer", ["On WeAid, a home nurse in Kochi is ₹1,200 for a 12-hour shift or ₹1,800 for 24 hours. Monthly care is ₹30,000 for 12-hour days or ₹45,000 for round-the-clock care. Elder care — companionship and daily help rather than nursing — is ₹1,100 a day or ₹28,000 a month."]],
      ["Home nurse or elder caregiver?", ["A home nurse helps with medical needs: medicines on schedule, checking vitals, wound dressing, feeding tubes, and care after a hospital stay. An elder caregiver helps with daily life: bathing, moving around, meals, company and getting to appointments. Many families start with a nurse after a hospital discharge and move to an elder caregiver once things are stable."]],
      ["12 hours or 24 hours?", ["12-hour care suits someone who needs help during the day and is safe at night, or has family at home in the evening. 24-hour, live-in care is for someone bedridden, at risk of falls, or recovering from surgery. If nights are the hard part, ask for a night shift."]],
      ["What to check before you hire anyone", { list: ["A government photo ID — and see their face matches", "A Kerala Police clearance certificate (from the Thuna portal) — for anyone staying in your home", "Experience with the condition (stroke, dementia, post-surgery)", "Who to call if they fall sick or don't turn up — and whether a replacement is arranged"] }],
      ["For families abroad", ["Many WeAid bookings for elder care come from children working in the Gulf, the UK or elsewhere. You can book online from anywhere and see the carer's photo and checks on your phone."]],
    ],
  },
  {
    slug: "roof-leak-before-monsoon-kerala",
    title: "How to fix a roof leak before the monsoon in Kerala",
    description: "Find out why your roof leaks, what you can check yourself, when to call a roofer — and why you should book in January to April, not June.",
    service: "roofing", ask: "I need a roofing contractor for a leak", updated: "2026-10-09",
    sections: [
      ["Book before the rain, not during it", ["In Kerala, searches for roofers peak in May — right before the monsoon — and the good teams get booked out. The dry months, January to April, are the best time: surfaces are dry enough for sealants and waterproofing to work properly."]],
      ["Common causes of leaks", { list: ["GI or aluminium sheets: rusted sheets, loose or rusted screws, worn washers, gaps at the ridge", "Mangalore tile roofs: cracked or slipped tiles, rotten battens, blocked valleys", "Concrete terraces: cracks, failed waterproofing, water pooling near the drain outlet", "Blocked gutters and downpipes, which push water back under the roof"] }],
      ["What you can check safely", { list: ["From inside, note exactly where the water drips and photograph the stains", "Clear leaves from gutters and terrace drains — the cheapest fix there is", "On a terrace, look for cracks and places where water stands after rain", "Don't walk on sheet or tile roofs yourself — that's how most roofing accidents happen"] }],
      ["How WeAid prices roofing", ["A roofer visits first (₹99, taken off the bill if you go ahead), finds the cause and sends you a written, itemised quote with materials included. You pay 35% to book — refundable until work starts — and the rest only after you've checked the finished work."]],
    ],
  },
  {
    slug: "packers-and-movers-cost-kochi",
    title: "Packers and movers cost in Kochi (2026): local shifting guide",
    description: "What local shifting costs in Kochi, what affects the price, and a checklist for moving house without breakages or surprises.",
    service: "movers", ask: "I need packers and movers", updated: "2026-10-09",
    sections: [
      ["The short answer", ["On WeAid, local shifting within Kochi starts at ₹1,754. The final price depends on how much you're moving, the distance, how many floors (and whether there's a lift), and whether you want packing materials and packing done for you."]],
      ["What changes the price", { list: ["The amount — a 1BHK and a 3BHK need different vehicles and crews", "Floors and stairs — carrying a fridge down three floors takes more people", "Packing — boxes, bubble wrap and dismantling furniture cost extra", "Distance and timing — weekends and month-ends are busiest"] }],
      ["Moving checklist", { list: ["Book a week ahead, and two weeks around April–May (school-year moves)", "Photograph furniture and appliances before packing", "Pack valuables, documents and medicines yourself and carry them", "Defrost and dry the fridge a day before", "Keep a box of essentials for the first night: phone chargers, bedding, a kettle"] }],
      ["Before you agree a price", ["Get the price in writing before moving day, ask what's included, and agree how breakages are handled. On WeAid you see the price first and pay through WeAid, so if something goes wrong there's someone to call."]],
    ],
  },
];

export const GUIDE_BY_SLUG = Object.fromEntries(GUIDES.map((g) => [g.slug, g]));

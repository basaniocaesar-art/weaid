import { supabase } from "../../lib/supabase.js";
import { calculatePrice } from "../../lib/pricing.js";

const SERVICE_DATA = {
  electrical: { name: "Electrical Work", keywords: ["electrician", "wiring", "switch", "fan", "light", "mcb", "socket", "inverter"], icon: "⚡" },
  plumbing: { name: "Plumbing", keywords: ["plumber", "pipe", "tap", "leak", "drain", "toilet", "basin", "geyser", "water"], icon: "🔧" },
  cleaning: { name: "Deep Cleaning", keywords: ["clean", "wash", "mop", "dust", "sanitize", "bathroom", "kitchen", "sofa"], icon: "🧹" },
  ac: { name: "AC & Appliance Repair", keywords: ["ac", "air conditioner", "fridge", "washing machine", "appliance", "repair", "service"], icon: "❄️" },
  carpentry: { name: "Carpentry", keywords: ["carpenter", "wood", "furniture", "door", "wardrobe", "shelf", "cabinet", "bed"], icon: "🪚" },
  renovation: { name: "Home Renovation", keywords: ["renovate", "remodel", "paint", "tile", "flooring", "bathroom", "kitchen", "interior"], icon: "🏠" },
  pickup: { name: "Airport Transfers", keywords: ["airport", "pickup", "drop", "cab", "taxi", "travel", "transport", "car"], icon: "✈️" },
  caretaking: { name: "Property Caretaking", keywords: ["caretaker", "property", "nri", "maintenance", "bills", "monthly", "visit"], icon: "🏡" },
  painting: { name: "Painting", keywords: ["paint", "wall", "colour", "waterproof", "exterior", "interior"], icon: "🎨" },
  pest_control: { name: "Pest Control", keywords: ["pest", "cockroach", "termite", "ant", "mosquito", "rat", "bed bug"], icon: "🐛" },
  cctv: { name: "CCTV & Security", keywords: ["cctv", "camera", "security", "surveillance", "alarm", "smart lock"], icon: "📹" },
  movers: { name: "Packers & Movers", keywords: ["movers", "packers", "shifting", "moving", "truck", "relocation", "house shift", "transport"], icon: "🚚" },
  tutor: { name: "Home Tutors", keywords: ["tutor", "tuition", "teacher", "classes", "coaching", "study", "maths", "science", "music"], icon: "📚" },
  nursing: { name: "Nurses & Elder Care", keywords: ["nurse", "nursing", "elder", "care", "physio", "patient", "medical", "attendant", "home care"], icon: "🩺" },
  laundry: { name: "Laundry & Dry Clean", keywords: ["laundry", "wash", "iron", "dry clean", "clothes", "pickup"], icon: "🧺" },
  food: { name: "Food Delivery", keywords: ["food", "restaurant", "meal", "delivery", "biryani", "lunch", "dinner"], icon: "🍔" },
  homefood: { name: "Home Food", keywords: ["home food", "tiffin", "home chef", "homemade", "meals", "cook", "kerala meals"], icon: "🍱" },
  appliance: { name: "Appliance Repair", keywords: ["washing machine", "fridge", "refrigerator", "tv", "microwave", "oven", "geyser", "appliance"], icon: "🔌" },
  ro_service: { name: "Water Purifier Service", keywords: ["ro", "purifier", "water filter", "aquaguard", "kent"], icon: "💧" },
  inverter: { name: "Inverter & Battery", keywords: ["inverter", "ups", "battery", "power backup"], icon: "🔋" },
  gas_stove: { name: "Gas Stove Repair", keywords: ["gas stove", "stove", "burner", "hob", "chimney"], icon: "🔥" },
  motor_repair: { name: "Motor & Pump Repair", keywords: ["motor", "pump", "rewinding", "water pump", "borewell pump"], icon: "⚙️" },
  locksmith: { name: "Locksmith", keywords: ["lock", "key", "locksmith", "locked out", "duplicate key"], icon: "🔑" },
  computer_repair: { name: "Laptop & Computer Repair", keywords: ["laptop", "computer", "pc", "printer", "wifi"], icon: "💻" },
  mobile_repair: { name: "Mobile Repair", keywords: ["mobile", "phone", "screen", "iphone"], icon: "📱" },
  solar: { name: "Solar Installation", keywords: ["solar", "panel", "net metering", "solar heater"], icon: "☀️" },
  tank_cleaning: { name: "Water Tank & Septic Cleaning", keywords: ["tank", "septic", "sump", "water tank"], icon: "🚰" },
  well_cleaning: { name: "Well & Borewell", keywords: ["well", "borewell", "well cleaning"], icon: "🪣" },
  welding: { name: "Welding & Fabrication", keywords: ["welding", "welder", "gate", "grill", "railing", "fabrication"], icon: "🔩" },
  aluminium: { name: "Aluminium, Glass & Nets", keywords: ["aluminium", "glass", "mosquito net", "partition", "sliding window"], icon: "🪟" },
  gardening: { name: "Gardening & Coconut Climbing", keywords: ["garden", "gardener", "lawn", "landscaping", "coconut", "tree"], icon: "🌴" },
  sofa_cleaning: { name: "Sofa & Carpet Cleaning", keywords: ["sofa", "carpet", "mattress", "upholstery"], icon: "🛋️" },
  interior: { name: "Interiors & Modular Kitchen", keywords: ["interior", "modular kitchen", "wardrobe", "false ceiling"], icon: "📐" },
  vehicle_service: { name: "Car & Bike Service", keywords: ["car", "bike", "mechanic", "car wash", "scooter", "service"], icon: "🚗" },
  tailoring: { name: "Tailoring", keywords: ["tailor", "stitching", "blouse", "alteration", "churidar"], icon: "🧵" },
  photography: { name: "Photography", keywords: ["photographer", "photography", "wedding photo", "video", "shoot"], icon: "📷" },
  event_decor: { name: "Event Decoration", keywords: ["decoration", "decorator", "stage", "balloon", "flower decoration"], icon: "🎈" },
  makeup: { name: "Makeup & Beauty", keywords: ["makeup", "bridal", "beautician", "facial", "salon"], icon: "💄" },
  physio: { name: "Physiotherapy at Home", keywords: ["physio", "physiotherapy", "back pain", "rehab"], icon: "🦵" },
  pet_grooming: { name: "Pet Grooming", keywords: ["pet", "dog", "cat", "grooming"], icon: "🐾" },
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { q, city } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: "Query must be at least 2 characters" });
    }

    const query = q.toLowerCase().trim();
    const results = { services: [], jobs: [] };

    // 1. Match services by keyword
    for (const [id, svc] of Object.entries(SERVICE_DATA)) {
      const nameMatch = svc.name.toLowerCase().includes(query);
      const keywordMatch = svc.keywords.some((k) => k.includes(query) || query.includes(k));
      if (nameMatch || keywordMatch) {
        const entry = { id, name: svc.name, icon: svc.icon };
        if (city) {
          try {
            const price = calculatePrice({ service: id, city, scope: "small" });
            entry.startingPrice = price.total;
          } catch (e) {}
        }
        results.services.push(entry);
      }
    }

    // 2. Search marketplace jobs
    const { data: jobs } = await supabase
      .from("marketplace_jobs")
      .select("id, title, category, city, budget_min, budget_max, fixed_price, bid_count, urgent, when_needed, created_at")
      .eq("status", "open")
      .or(`title.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%`)
      .order("created_at", { ascending: false })
      .limit(10);

    results.jobs = jobs || [];

    return res.status(200).json(results);
  } catch (err) {
    console.error("[search]", err);
    return res.status(500).json({ error: err.message });
  }
}

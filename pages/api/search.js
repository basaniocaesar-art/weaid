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

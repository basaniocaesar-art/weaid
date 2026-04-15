import { insertJob } from "../../../lib/supabase.js";
import { calculatePrice } from "../../../lib/pricing.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, category, city, description, budgetMin, budgetMax, whenNeeded, skills, scope, customer, pricingMode = "both" } = req.body;

    if (!title || !category || !city || !customer?.name || !customer?.phone) {
      return res.status(400).json({ error: "Missing required fields: title, category, city, customer name and phone" });
    }

    // Calculate fixed price if applicable
    let fixedPrice = null;
    if (pricingMode === "fixed" || pricingMode === "both") {
      try {
        const price = calculatePrice({ service: category, city, scope: scope || "small" });
        fixedPrice = price.total;
      } catch (e) {
        // Category may not match a pricing service — that's OK for bid-only jobs
      }
    }

    const job = await insertJob({
      title,
      category,
      description: description || null,
      city,
      budget_min: budgetMin || null,
      budget_max: budgetMax || null,
      when_needed: whenNeeded || "flexible",
      skills: skills || [],
      scope: scope || "small",
      customer_id: customer.id || null,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email || null,
      status: "open",
      urgent: whenNeeded === "today",
      fixed_price: fixedPrice,
      pricing_mode: pricingMode,
    });

    return res.status(201).json({ jobId: job.id, fixedPrice, status: "open" });
  } catch (err) {
    console.error("[jobs/create]", err);
    return res.status(500).json({ error: err.message });
  }
}

import { insertLead } from "../../../lib/supabase.js";

// Logged whenever a customer contacts a provider (Call / WhatsApp / profile view-to-contact).
// Foundation for the per-job lead fee — fee_status starts 'free' until billing is switched on.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { providerId, service, city, channel, customerPhone } = req.body;
    if (!providerId) return res.status(400).json({ error: "Missing providerId" });

    const lead = await insertLead({
      provider_id: providerId,
      service: service || null,
      city: city || null,
      channel: channel || "whatsapp",
      customer_phone: customerPhone || null,
      fee_amount: 0,
      fee_status: "free",
    });
    return res.status(201).json({ ok: true, leadId: lead.id });
  } catch (err) {
    console.error("[provider/lead]", err);
    return res.status(500).json({ error: err.message });
  }
}

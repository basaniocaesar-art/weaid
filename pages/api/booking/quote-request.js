import { insertQuoteRequest } from "../../../lib/supabase.js";
import { placeConfirmationCall } from "../../../lib/voice.js";

// Big / multi-person jobs: instead of a blind fixed price, capture a lead and
// have the sales agent (Sarvam / Maya) call the customer to scope it and quote.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { service, city, description, workers, scheduledAt, customer } = req.body;
    if (!customer?.name || !customer?.phone) {
      return res.status(400).json({ error: "Missing customer name or phone" });
    }

    const q = await insertQuoteRequest({
      service: service || null,
      city: city || null,
      description: description || null,
      workers: Math.max(1, Number(workers) || 3),
      customer_name: customer.name,
      customer_phone: customer.phone,
      scheduled_at: scheduledAt || null,
      status: "new",
    });

    // Kick off the sales/qualification call (no-ops if voice isn't configured yet).
    placeConfirmationCall({
      to: customer.phone,
      role: "sales",
      booking: { id: q.id, service, city, description, customer_name: customer.name },
    }).catch(() => {});

    return res.status(201).json({ ok: true, id: q.id });
  } catch (err) {
    console.error("[booking/quote-request]", err);
    return res.status(500).json({ error: err.message });
  }
}

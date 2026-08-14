import { getProviderByEditToken, getDispatchableBookings, getProviderActiveJobs, getBooking } from "../../../lib/supabase.js";
import { providerAcceptJob, completeJob } from "../../../lib/orchestrator.js";

// Token-gated: uses the provider's private edit_token (from their manage link).
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function shape(b, provider) {
  const dist =
    b.customer_lat != null && b.customer_lng != null && provider.lat != null && provider.lng != null
      ? distanceKm(provider.lat, provider.lng, b.customer_lat, b.customer_lng)
      : null;
  return {
    id: b.id,
    service: b.service,
    city: b.city,
    scope: b.scope,
    slot: b.slot,
    total: b.total,
    provider_earnings: b.provider_earnings,
    timing_mode: b.timing_mode,
    scheduled_at: b.scheduled_at,
    customer_name: b.customer_name,
    customer_phone: b.customer_phone,
    status: b.status,
    created_at: b.created_at,
    distanceKm: dist,
  };
}

export default async function handler(req, res) {
  try {
    const token = req.query.token || req.body?.token;
    if (!token) return res.status(401).json({ error: "Missing token" });
    const provider = await getProviderByEditToken(token);
    if (!provider) return res.status(404).json({ error: "Listing not found" });

    if (req.method === "GET") {
      const [incoming, active] = await Promise.all([
        getDispatchableBookings(provider.services || [], provider.city),
        getProviderActiveJobs(provider.id),
      ]);
      // Nearest first for incoming
      const inc = incoming
        .map((b) => shape(b, provider))
        .sort((a, z) => (a.distanceKm ?? 1e9) - (z.distanceKm ?? 1e9));
      return res.status(200).json({ incoming: inc, active: active.map((b) => shape(b, provider)) });
    }

    if (req.method === "POST") {
      const { bookingId, action } = req.body;
      if (!bookingId || !action) return res.status(400).json({ error: "Missing bookingId or action" });

      if (action === "accept") {
        try {
          const booking = await providerAcceptJob(bookingId, provider.id);
          return res.status(200).json({ ok: true, status: booking.status });
        } catch (e) {
          if (e.code === "ALREADY_TAKEN") {
            return res.status(409).json({ error: e.message, alreadyTaken: true });
          }
          throw e;
        }
      }

      if (action === "complete") {
        const booking = await getBooking(bookingId);
        if (!booking || booking.provider_id !== provider.id) {
          return res.status(403).json({ error: "Not your job" });
        }
        await completeJob(bookingId);
        return res.status(200).json({ ok: true, status: "completed" });
      }

      return res.status(400).json({ error: "action must be 'accept' or 'complete'" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[provider/jobs]", err);
    return res.status(500).json({ error: err.message });
  }
}

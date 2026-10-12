/**
 * What the customer is allowed to see about their own booking, while they wait.
 *
 * Powers the map that appears after an "as soon as possible" booking: who was
 * asked, and — once somebody takes it — who is coming and when. It is polled
 * every few seconds from the page, so it stays deliberately small.
 *
 * The booking id is a uuid and is the only credential, which is fine for
 * reading your own job but not for reading anybody else's details: before a
 * provider accepts, this returns the shortlist's names and rough positions and
 * no phone numbers at all. A phone number appears only for the provider who
 * actually took the job, and only to whoever holds that booking id.
 */
import { supabase } from "../../../lib/supabase.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const id = String(req.query.id || "");
  if (!UUID.test(id)) return res.status(400).json({ error: "Not a booking id" });

  const { data: b, error } = await supabase
    .from("bookings")
    .select("id, service, city, status, timing_mode, scheduled_at, agreed_at, eta_minutes, provider_id, provider_name, provider_phone, customer_lat, customer_lng, total, workers")
    .eq("id", id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!b) return res.status(404).json({ error: "No such booking" });

  const taken = b.status === "accepted" || b.status === "completed";

  // Who is being asked. Pins on the map, so only what a pin needs.
  const { data: shortlist } = await supabase
    .from("providers")
    .select("id, name, areas, lat, lng, rating, review_count, verified")
    .eq("available", true)
    .contains("services", [b.service])
    .ilike("city", b.city || "kochi")
    .not("lat", "is", null)
    .limit(12);

  return res.status(200).json({
    status: b.status,
    timingMode: b.timing_mode,
    scheduledAt: b.scheduled_at,
    agreedAt: b.agreed_at,
    etaMinutes: b.eta_minutes,
    customer: b.customer_lat != null ? { lat: b.customer_lat, lng: b.customer_lng } : null,
    // Named and placed, never contactable, until one of them owns the job.
    nearby: (shortlist || []).map((p) => ({
      id: p.id, name: p.name, lat: p.lat, lng: p.lng,
      rating: p.rating, reviews: p.review_count, verified: p.verified,
      accepted: taken && p.id === b.provider_id,
    })),
    provider: taken
      ? { name: b.provider_name, phone: b.provider_phone }
      : null,
  });
}

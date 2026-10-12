/**
 * Proof of work — so "he never fixed it" can be answered with evidence.
 *
 *   arrival   the pro's GPS when they enter the arrival code, compared with the
 *             customer's pin (stored on the "arrived" event; >500 m is flagged)
 *   photos    before (optional) and after (required to finish), in the private
 *             "job-photos" bucket; rows in job_photos (url = storage path)
 *   confirm   the customer confirms and rates on the tracking page. That is a
 *             real, job-verified review (reviews + provider_reviews). Silence
 *             for 24 hours after "done" counts as confirmed; a complaint holds it.
 *
 * Payout is "ready" only once confirmed (or auto-confirmed) with no open complaint.
 */
import { supabase, recomputeProviderRating } from "./supabase.js";
import { haversineKm } from "./geo.js";
import { openTicket } from "./followup.js";
import { logEvent } from "./jobs.js";

const BUCKET = "job-photos";
export const AUTO_CONFIRM_HOURS = 24;
export const FAR_METRES = 500;

export async function savePhoto(booking, kind, mime, data) {
  if (!["before", "after", "progress", "pickup", "delivery"].includes(kind)) throw new Error("Unknown photo type.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Please send a photo.");
  const bytes = Buffer.from(String(data || "").replace(/^data:[^,]+,/, ""), "base64");
  if (bytes.length < 5_000) throw new Error("That photo looks empty. Please try again.");
  if (bytes.length > 4_500_000) throw new Error("That photo is too big.");
  const { count } = await supabase.from("job_photos").select("id", { count: "exact", head: true }).eq("booking_id", booking.id);
  if ((count || 0) >= 60) throw new Error("That's enough photos for this job.");
  const path = `${booking.id}/${kind}-${Date.now()}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, cacheControl: "0" });
  if (error) throw new Error(`upload: ${error.message}`);
  // uploaded_by is a UUID column: the assigned provider's id (null for a hand-assigned pro).
  const { error: rowErr } = await supabase.from("job_photos").insert({ booking_id: booking.id, type: kind, url: path, uploaded_by: booking.provider_id || null });
  if (rowErr) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`Couldn't save the photo: ${rowErr.message}`);
  }
  return photoCounts(booking.id);
}

export async function photoCounts(bookingId) {
  const { data } = await supabase.from("job_photos").select("type").eq("booking_id", bookingId);
  const n = (t) => (data || []).filter((p) => p.type === t).length;
  return { before: n("before"), after: n("after"), progress: n("progress"), pickup: n("pickup"), delivery: n("delivery") };
}

/** Signed (10-minute) links to a job's photos. */
export async function photoLinks(bookingId) {
  const { data } = await supabase.from("job_photos").select("type,url,created_at").eq("booking_id", bookingId).order("created_at");
  const out = [];
  for (const p of data || []) {
    const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(p.url, 600);
    if (s?.signedUrl) out.push({ type: p.type, url: s.signedUrl, at: p.created_at });
  }
  return out;
}

/** How far the pro was from the customer's pin when they arrived. */
export function arrivalDistance(booking, lat, lng) {
  if (booking.customer_lat == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return Math.round(haversineKm(booking.customer_lat, booking.customer_lng, lat, lng) * 1000);
}

/** Where a finished job stands with the customer and for the pro's payout. */
export function confirmation(booking, events) {
  const done = events.find((e) => e.event === "done");
  const conf = events.find((e) => e.event === "confirmed");
  const issue = events.some((e) => e.event === "issue_reported");
  const arrived = events.find((e) => e.event === "arrived");
  const metres = arrived?.data?.metres ?? null;
  if (!done) return { state: "not_done", metres };
  const auto = !conf && !issue && Date.now() - Date.parse(done.created_at) > AUTO_CONFIRM_HOURS * 3600e3;
  return {
    state: conf ? "confirmed" : auto ? "auto_confirmed" : issue ? "disputed" : "waiting",
    rating: conf?.data?.rating ?? null,
    comment: conf?.data?.comment ?? "",
    payout: issue ? "on_hold" : conf || auto ? "ready" : "waiting",
    metres,
    far: metres != null && metres > FAR_METRES,
  };
}

/** The customer confirms the job and rates the pro. */
export async function confirmJob(booking, events, rating, comment) {
  if (!events.some((e) => e.event === "done")) throw new Error("The pro hasn't marked the job done yet.");
  if (events.some((e) => e.event === "confirmed")) throw new Error("You've already rated this job — thank you!");
  const r = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
  if (!r) throw new Error("Please choose a star rating.");
  const text = String(comment || "").trim().slice(0, 1000);
  await logEvent(booking.id, "confirmed", { rating: r, comment: text });
  if (booking.provider_id) {
    await supabase.from("reviews").insert({ booking_id: booking.id, provider_id: booking.provider_id, rating: r, comment: text || null });
    await supabase.from("provider_reviews").insert({ provider_id: booking.provider_id, customer_name: (booking.customer_name || "WeAid customer").split(" ")[0], customer_phone: booking.customer_phone || null, rating: r, comment: text || null });
    await recomputeProviderRating(booking.provider_id).catch(() => {});
  }
  if (r <= 2) {
    await logEvent(booking.id, "issue_reported", { ref: "low-rating" });
    await openTicket({ kind: "complaint", phone: booking.customer_phone, name: booking.customer_name, bookingId: booking.id, source: "web",
      summary: `Rated ${r}★${text ? `: "${text}"` : ""}`, details: { pro: booking.provider_name || "" } });
  }
  return { ok: true, rating: r };
}

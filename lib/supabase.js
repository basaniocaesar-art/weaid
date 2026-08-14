import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

/* ── Helper queries ── */

export async function insertBooking(booking) {
  const { data, error } = await supabase
    .from("bookings")
    .insert(booking)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBooking(id, updates) {
  const { data, error } = await supabase
    .from("bookings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getBooking(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getProvidersByService(service, city) {
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .contains("services", [service])
    .eq("city", city)
    .eq("available", true);
  if (error) throw error;
  return data;
}

// Atomic "first accept wins": only succeeds if the booking is still open
// (status pending + no provider). Returns the booking if this caller won, else null.
export async function acceptBookingIfOpen(bookingId, { providerId, providerName, providerPhone }) {
  const { data, error } = await supabase
    .from("bookings")
    .update({
      status: "accepted",
      provider_id: providerId,
      provider_name: providerName || null,
      provider_phone: providerPhone || null,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("status", "pending")
    .is("provider_id", null)
    .select();
  if (error) throw error;
  return data && data.length ? data[0] : null; // null = already taken
}

/* ── Trips (rides + courier) ── */

export async function insertTrip(trip) {
  const { data, error } = await supabase.from("trips").insert(trip).select().single();
  if (error) throw error;
  return data;
}

export async function getTrip(id) {
  const { data } = await supabase.from("trips").select("*").eq("id", id).single();
  return data;
}

export async function updateTrip(id, updates) {
  const { data, error } = await supabase
    .from("trips")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// First-accept-wins for a trip.
export async function acceptTripIfOpen(tripId, { driverId, driverName, driverPhone }) {
  const { data, error } = await supabase
    .from("trips")
    .update({ status: "accepted", driver_id: driverId, driver_name: driverName || null, driver_phone: driverPhone || null, accepted_at: new Date().toISOString() })
    .eq("id", tripId)
    .eq("status", "searching")
    .is("driver_id", null)
    .select();
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

// Open trips a driver could accept (searching), matching the trip types they run.
export async function getDispatchableTrips(types, limit = 20) {
  if (!types || !types.length) return [];
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("status", "searching")
    .in("type", types)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getAvailableDriversByType(type) {
  const { data, error } = await supabase.from("providers").select("*").contains("services", [type]).eq("available", true);
  if (error) throw error;
  return data || [];
}

export async function getDriverActiveTrips(driverId) {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("driver_id", driverId)
    .in("status", ["accepted", "arrived", "picked_up", "in_transit"])
    .order("accepted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertDriverLocation(driverId, { lat, lng, tripId }) {
  const { error } = await supabase.from("driver_locations").upsert(
    { driver_id: driverId, lat, lng, trip_id: tripId || null, updated_at: new Date().toISOString() },
    { onConflict: "driver_id" }
  );
  if (error) throw error;
}

export async function getDriverLocation(driverId) {
  const { data } = await supabase.from("driver_locations").select("*").eq("driver_id", driverId).single();
  return data;
}

/* ── Food: menus + orders ── */

export async function insertMenuItem(item) {
  const { data, error } = await supabase.from("menu_items").insert(item).select().single();
  if (error) throw error;
  return data;
}
export async function listMenuItems(providerId, onlyAvailable = false) {
  let q = supabase.from("menu_items").select("*").eq("provider_id", providerId).order("sort", { ascending: true }).order("created_at", { ascending: true });
  if (onlyAvailable) q = q.eq("available", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
export async function updateMenuItem(id, providerId, updates) {
  const { data, error } = await supabase.from("menu_items").update(updates).eq("id", id).eq("provider_id", providerId).select().single();
  if (error) throw error;
  return data;
}
export async function deleteMenuItem(id, providerId) {
  const { error } = await supabase.from("menu_items").delete().eq("id", id).eq("provider_id", providerId);
  if (error) throw error;
}
export async function getFoodProviders(city) {
  let q = supabase.from("providers").select("*").eq("available", true).or("services.cs.{food},services.cs.{homefood}");
  if (city) q = q.ilike("city", `%${city}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
export async function insertFoodOrder(order) {
  const { data, error } = await supabase.from("food_orders").insert(order).select().single();
  if (error) throw error;
  return data;
}
export async function getFoodOrder(id) {
  const { data } = await supabase.from("food_orders").select("*").eq("id", id).single();
  return data;
}
export async function updateFoodOrder(id, updates) {
  const { data, error } = await supabase.from("food_orders").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}
export async function getFoodOrdersForProvider(providerId, active = true) {
  let q = supabase.from("food_orders").select("*").eq("provider_id", providerId).order("created_at", { ascending: false }).limit(30);
  if (active) q = q.in("status", ["placed", "accepted", "preparing", "ready", "out_for_delivery"]);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/* ── Carpool ── */

export async function insertCarpool(c) {
  const { data, error } = await supabase.from("carpools").insert(c).select().single();
  if (error) throw error;
  return data;
}

export async function listCarpools({ to } = {}) {
  let q = supabase.from("carpools").select("*").eq("status", "open").gt("seats_left", 0).order("depart_at", { ascending: true }).limit(50);
  if (to) q = q.ilike("to_address", `%${to}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getCarpool(id) {
  const { data } = await supabase.from("carpools").select("*").eq("id", id).single();
  return data;
}

// Book a seat: insert rider + decrement seats_left only if a seat is still free.
export async function joinCarpool(carpoolId, rider) {
  const cp = await getCarpool(carpoolId);
  if (!cp || cp.seats_left < 1) return null;
  const { error: sErr } = await supabase.from("carpool_seats").insert({ carpool_id: carpoolId, rider_name: rider.name, rider_phone: rider.phone });
  if (sErr) throw sErr;
  const left = cp.seats_left - 1;
  await supabase.from("carpools").update({ seats_left: left, status: left <= 0 ? "full" : "open" }).eq("id", carpoolId);
  return { ...cp, seats_left: left };
}

export async function insertQuoteRequest(q) {
  const { data, error } = await supabase.from("quote_requests").insert(q).select().single();
  if (error) throw error;
  return data;
}

// Accepted, scheduled jobs starting within the window that haven't been reminded yet.
export async function getUpcomingScheduledBookings(withinMinutes = 120) {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + withinMinutes * 60000).toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "accepted")
    .eq("timing_mode", "scheduled")
    .is("reminded_at", null)
    .gte("scheduled_at", now)
    .lte("scheduled_at", until);
  if (error) throw error;
  return data || [];
}

export async function getPendingBookings() {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getCompletedPayouts(since) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, providers(*)")
    .eq("status", "completed")
    .eq("provider_paid", false)
    .gte("completed_at", since);
  if (error) throw error;
  return data;
}

/* ── Affiliate helpers ── */

export async function insertAffiliate(affiliate) {
  const { data, error } = await supabase.from("affiliates").insert(affiliate).select().single();
  if (error) throw error;
  return data;
}

export async function getAffiliateByEmail(email) {
  const { data } = await supabase.from("affiliates").select("*").eq("email", email).single();
  return data;
}

export async function getAffiliateByRefCode(refCode) {
  const { data } = await supabase.from("affiliates").select("*").eq("ref_code", refCode).single();
  return data;
}

export async function getAffiliateById(id) {
  const { data } = await supabase.from("affiliates").select("*").eq("id", id).single();
  return data;
}

export async function getAffiliateReferrals(affiliateId, page = 1, limit = 20) {
  const from = (page - 1) * limit;
  const { data, error, count } = await supabase
    .from("referrals")
    .select("*", { count: "exact" })
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  return { referrals: data, total: count };
}

export async function getAffiliatePayouts(affiliateId) {
  const { data, error } = await supabase
    .from("affiliate_payouts")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getLeaderboard(month) {
  const { data, error } = await supabase
    .from("affiliate_competitions")
    .select("*, affiliates(name, tier)")
    .eq("month", month)
    .order("referral_count", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data;
}

export async function getMonthlyStats(affiliateId, month) {
  const { data } = await supabase
    .from("affiliate_competitions")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .eq("month", month)
    .single();
  return data;
}

export async function getAffiliatesForPayout(minAmount = 100) {
  const { data, error } = await supabase
    .from("affiliates")
    .select("*")
    .eq("status", "approved")
    .gte("pending_payout", minAmount);
  if (error) throw error;
  return data;
}

export async function getEarnedReferrals(affiliateId) {
  const { data, error } = await supabase
    .from("referrals")
    .select("*")
    .eq("affiliate_id", affiliateId)
    .eq("status", "earned");
  if (error) throw error;
  return data;
}

export async function markReferralsPaid(referralIds) {
  const { error } = await supabase
    .from("referrals")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .in("id", referralIds);
  if (error) throw error;
}

export async function insertAffiliatePayout(payout) {
  const { data, error } = await supabase.from("affiliate_payouts").insert(payout).select().single();
  if (error) throw error;
  return data;
}

export async function resetAffiliatePendingPayout(affiliateId) {
  const { error } = await supabase
    .from("affiliates")
    .update({ pending_payout: 0 })
    .eq("id", affiliateId);
  if (error) throw error;
}

export async function getAllCompetitionEntries(month) {
  const { data, error } = await supabase
    .from("affiliate_competitions")
    .select("*, affiliates(id, name, tier, total_earnings)")
    .eq("month", month)
    .order("referral_count", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateAffiliateTier(affiliateId, tier) {
  const { error } = await supabase
    .from("affiliates")
    .update({ tier })
    .eq("id", affiliateId);
  if (error) throw error;
}

/* ── Job Marketplace helpers ── */

export async function insertJob(job) {
  const { data, error } = await supabase.from("marketplace_jobs").insert(job).select().single();
  if (error) throw error;
  return data;
}

export async function getJobs({ category, city, status = "open", page = 1, limit = 20 } = {}) {
  let q = supabase.from("marketplace_jobs").select("*", { count: "exact" }).eq("status", status).order("created_at", { ascending: false });
  if (category) q = q.eq("category", category);
  if (city) q = q.ilike("city", `%${city}%`);
  const from = (page - 1) * limit;
  q = q.range(from, from + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { jobs: data, total: count };
}

export async function getJobById(id) {
  const { data, error } = await supabase.from("marketplace_jobs").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function updateJob(id, updates) {
  const { data, error } = await supabase.from("marketplace_jobs").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function insertBid(bid) {
  const { data, error } = await supabase.from("job_bids").insert(bid).select().single();
  if (error) throw error;
  return data;
}

export async function getBidsByJob(jobId) {
  const { data, error } = await supabase.from("job_bids").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateBid(id, updates) {
  const { data, error } = await supabase.from("job_bids").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function rejectOtherBids(jobId, acceptedBidId) {
  const { error } = await supabase.from("job_bids").update({ status: "rejected" }).eq("job_id", jobId).neq("id", acceptedBidId).eq("status", "pending");
  if (error) throw error;
}

/* ── Provider Directory helpers ── */

export async function insertProvider(provider) {
  const { data, error } = await supabase.from("providers").insert(provider).select().single();
  if (error) throw error;
  return data;
}

export async function getProviderBySlug(slug) {
  const { data } = await supabase.from("providers").select("*").eq("slug", slug).single();
  return data;
}

export async function slugExists(slug) {
  const { data } = await supabase.from("providers").select("id").eq("slug", slug).maybeSingle();
  return !!data;
}

// Directory search: filter available providers by service/city/keyword.
// Ranking (featured → new-signup boost → newest → rating) is applied by the caller.
export async function searchProviders({ service, city, q, limit = 200 } = {}) {
  let query = supabase.from("providers").select("*").eq("available", true);
  if (service) query = query.contains("services", [service]);
  if (city) query = query.ilike("city", `%${city}%`);
  if (q) query = query.or(`name.ilike.%${q}%,bio.ilike.%${q}%`);
  query = query.order("created_at", { ascending: false }).limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function updateProvider(id, updates) {
  const { data, error } = await supabase
    .from("providers")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getProviderById(id) {
  const { data } = await supabase.from("providers").select("*").eq("id", id).single();
  return data;
}

export async function getProviderByEditToken(token) {
  const { data } = await supabase.from("providers").select("*").eq("edit_token", token).single();
  return data;
}

// Open bookings a provider could accept: paid + waiting, matching their
// services and city.
export async function getDispatchableBookings(services, city, teamSize = 1, limit = 30) {
  if (!services || !services.length) return [];
  let q = supabase
    .from("bookings")
    .select("*")
    .eq("status", "pending")
    .in("service", services)
    .lte("workers", Math.max(1, teamSize)) // only jobs this pro can staff
    .order("created_at", { ascending: false })
    .limit(limit);
  if (city) q = q.ilike("city", `%${city}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Jobs this provider has accepted and not yet completed.
export async function getProviderActiveJobs(providerId, limit = 30) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("provider_id", providerId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/* ── Reviews ── */

export async function insertReview(review) {
  const { data, error } = await supabase.from("provider_reviews").insert(review).select().single();
  if (error) throw error;
  return data;
}

export async function getReviewsByProvider(providerId, limit = 50) {
  const { data, error } = await supabase
    .from("provider_reviews")
    .select("*")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Recompute a provider's average rating + review count from its reviews.
export async function recomputeProviderRating(providerId) {
  const { data, error } = await supabase
    .from("provider_reviews")
    .select("rating")
    .eq("provider_id", providerId);
  if (error) throw error;
  const count = data.length;
  const avg = count ? data.reduce((s, r) => s + r.rating, 0) / count : 0;
  await updateProvider(providerId, { rating: Math.round(avg * 10) / 10, review_count: count });
  return { rating: Math.round(avg * 10) / 10, review_count: count };
}

/* ── Leads (foundation for per-job lead fee) ── */

export async function insertLead(lead) {
  const { data, error } = await supabase.from("provider_leads").insert(lead).select().single();
  if (error) throw error;
  return data;
}

export async function getLeadsByProvider(providerId, limit = 100) {
  const { data, error } = await supabase
    .from("provider_leads")
    .select("*")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

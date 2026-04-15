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

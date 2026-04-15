/* ── Affiliate / Referral helpers ── */

import { supabase } from "./supabase.js";

export const AFFILIATE_COMMISSION_RATES = {
  bronze: 0.10,
  silver: 0.10,
  gold: 0.12,
  platinum: 0.15,
};

export const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 5,
  gold: 15,
  platinum: 30,
};

export const TIER_BONUSES = {
  bronze: 0,
  silver: 500,
  gold: 2000,
  platinum: 5000,
};

export const COMPETITION_PRIZES = [3000, 1500, 750]; // 1st, 2nd, 3rd

const REF_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRefCode(name) {
  const prefix = (name || "WA").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += REF_CODE_CHARS[Math.floor(Math.random() * REF_CODE_CHARS.length)];
  }
  return prefix + suffix;
}

export function calculateAffiliateTier(monthlyReferrals) {
  if (monthlyReferrals >= TIER_THRESHOLDS.platinum) return "platinum";
  if (monthlyReferrals >= TIER_THRESHOLDS.gold) return "gold";
  if (monthlyReferrals >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

export function calculateAffiliateCommission(platformCommission, tier = "bronze") {
  const rate = AFFILIATE_COMMISSION_RATES[tier] || 0.10;
  return Math.round(platformCommission * rate);
}

export async function creditAffiliateCommission(booking) {
  if (!booking.affiliate_id) return null;

  const { data: affiliate } = await supabase
    .from("affiliates")
    .select("id, tier, total_earnings, pending_payout, total_referrals")
    .eq("id", booking.affiliate_id)
    .eq("status", "approved")
    .single();

  if (!affiliate) return null;

  const commission = calculateAffiliateCommission(booking.commission, affiliate.tier);

  // Insert referral record
  const { data: referral } = await supabase.from("referrals").insert({
    affiliate_id: affiliate.id,
    booking_id: booking.id,
    ref_code: booking.ref_code,
    service: booking.service,
    booking_total: booking.total,
    platform_commission: booking.commission,
    affiliate_commission: commission,
    status: "earned",
    earned_at: new Date().toISOString(),
  }).select().single();

  // Update affiliate totals
  await supabase
    .from("affiliates")
    .update({
      total_earnings: affiliate.total_earnings + commission,
      pending_payout: affiliate.pending_payout + commission,
      total_referrals: affiliate.total_referrals + 1,
    })
    .eq("id", affiliate.id);

  // Upsert monthly competition entry
  const month = new Date().toISOString().slice(0, 7); // "2026-04"
  const { data: existing } = await supabase
    .from("affiliate_competitions")
    .select("id, referral_count, total_value")
    .eq("month", month)
    .eq("affiliate_id", affiliate.id)
    .single();

  if (existing) {
    await supabase
      .from("affiliate_competitions")
      .update({
        referral_count: existing.referral_count + 1,
        total_value: existing.total_value + commission,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("affiliate_competitions").insert({
      month,
      affiliate_id: affiliate.id,
      referral_count: 1,
      total_value: commission,
    });
  }

  return { referral, commission };
}

export async function lookupAffiliateByRefCode(refCode) {
  if (!refCode) return null;
  const { data } = await supabase
    .from("affiliates")
    .select("id, status, name")
    .eq("ref_code", refCode.toUpperCase())
    .single();
  return data && data.status === "approved" ? data : null;
}

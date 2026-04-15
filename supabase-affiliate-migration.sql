-- ============================================
-- WeAid Affiliate System — Supabase Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. AFFILIATES TABLE
CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  ref_code TEXT UNIQUE NOT NULL,
  upi_id TEXT,
  bank_account TEXT,
  bank_ifsc TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
  total_earnings INTEGER NOT NULL DEFAULT 0,
  pending_payout INTEGER NOT NULL DEFAULT 0,
  total_referrals INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_affiliates_ref_code ON affiliates(ref_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates(status);
CREATE INDEX IF NOT EXISTS idx_affiliates_email ON affiliates(email);

-- 2. REFERRALS TABLE
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id),
  ref_code TEXT NOT NULL,
  service TEXT NOT NULL,
  booking_total INTEGER NOT NULL,
  platform_commission INTEGER NOT NULL,
  affiliate_commission INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','earned','paid','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  earned_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_affiliate ON referrals(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- 3. AFFILIATE PAYOUTS TABLE
CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  amount INTEGER NOT NULL,
  referral_ids UUID[] NOT NULL DEFAULT '{}',
  method TEXT NOT NULL DEFAULT 'upi' CHECK (method IN ('upi','bank_transfer','bonus')),
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','completed','failed')),
  transaction_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate ON affiliate_payouts(affiliate_id);

-- 4. AFFILIATE COMPETITIONS TABLE (monthly leaderboard)
CREATE TABLE IF NOT EXISTS affiliate_competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month TEXT NOT NULL,
  affiliate_id UUID NOT NULL REFERENCES affiliates(id),
  referral_count INTEGER NOT NULL DEFAULT 0,
  total_value INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  bonus_awarded INTEGER NOT NULL DEFAULT 0,
  UNIQUE(month, affiliate_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_competitions_month ON affiliate_competitions(month);

-- 5. ADD COLUMNS TO EXISTING BOOKINGS TABLE
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ref_code TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES affiliates(id);

CREATE INDEX IF NOT EXISTS idx_bookings_affiliate ON bookings(affiliate_id);

-- 6. ENABLE ROW LEVEL SECURITY (optional but recommended)
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_competitions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (your API uses service key)
CREATE POLICY "Service role full access" ON affiliates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON referrals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON affiliate_payouts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON affiliate_competitions FOR ALL USING (true) WITH CHECK (true);

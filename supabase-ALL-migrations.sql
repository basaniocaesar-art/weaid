-- WeAid — ALL migrations combined. Safe to re-run. Paste into Supabase SQL Editor and press Run.

-- ============================================================
-- supabase-auth-migration.sql
-- ============================================================
-- ============================================
-- WeAid Authentication — Supabase Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- Ensure users table has role and phone_verified columns
-- (users table may already exist from Supabase Auth — this adds columns if missing)

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "Service role full access on users" ON users;
CREATE POLICY "Service role full access on users" ON users
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- supabase-providers-migration.sql
-- ============================================================
-- ============================================
-- WeAid Provider Directory — Supabase Migration
-- Run this in Supabase SQL Editor
-- Safe to run against an existing `providers` table (idempotent).
-- ============================================

-- 1. PROVIDER DIRECTORY LISTINGS
-- Create the table if it does not exist yet...
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ...then ensure every directory column exists (adds only what's missing).
ALTER TABLE providers ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS areas TEXT[] DEFAULT '{}';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS years_experience INTEGER;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS rating NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS review_count INTEGER NOT NULL DEFAULT 0;
-- Free "new signup" front-of-search window (set to created_at + 30 days on signup)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS listing_boost_until TIMESTAMPTZ;
-- 'signup' = provider self-registered; 'seed' = imported/unclaimed listing
ALTER TABLE providers ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'signup';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS claimed BOOLEAN NOT NULL DEFAULT true;
-- Capability token for the provider's private "manage your listing" link
ALTER TABLE providers ADD COLUMN IF NOT EXISTS edit_token UUID DEFAULT gen_random_uuid();
-- Approximate location for distance / "near me" ranking (area centroid, NOT exact home)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
-- How many workers this pro can bring (crew capacity for multi-person jobs)
ALTER TABLE providers ADD COLUMN IF NOT EXISTS team_size INTEGER NOT NULL DEFAULT 1;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- plan_tier is limited to 'free' | 'featured' (added as a NOT VALID-safe constraint)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_plan_tier_check') THEN
    ALTER TABLE providers ADD CONSTRAINT providers_plan_tier_check
      CHECK (plan_tier IN ('free','featured'));
  END IF;
END $$;

-- Unique slug (used for the public listing URL /provider/<slug>)
CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_slug ON providers(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_providers_city ON providers(city);
CREATE INDEX IF NOT EXISTS idx_providers_services ON providers USING GIN (services);
CREATE INDEX IF NOT EXISTS idx_providers_available ON providers(available);

-- 2. ROW LEVEL SECURITY
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'providers' AND policyname = 'Service role full access on providers'
  ) THEN
    CREATE POLICY "Service role full access on providers" ON providers
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================
-- supabase-bookings-base-migration.sql
-- ============================================================
-- ============================================
-- WeAid Bookings + Users — BASE tables
-- Run this BEFORE supabase-bookings-scheduling-migration.sql and
-- supabase-auth-migration.sql. Safe/idempotent (IF NOT EXISTS).
-- (Your existing Supabase already has these; this makes a fresh
--  deploy reproducible from migrations alone.)
-- ============================================

-- 1. USERS (public profile table, keyed to Supabase auth user id)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  phone TEXT,
  email TEXT,
  role TEXT DEFAULT 'customer',
  name TEXT,
  phone_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. BOOKINGS
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  city TEXT NOT NULL,
  scope TEXT DEFAULT 'small',
  slot TEXT DEFAULT 'standard',
  workers INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  photos TEXT[] DEFAULT '{}',
  address TEXT,
  customer_confirmed BOOLEAN NOT NULL DEFAULT false,
  provider_confirmed BOOLEAN NOT NULL DEFAULT false,
  reminded_at TIMESTAMPTZ,
  mask_number TEXT,
  mask_session_id TEXT,
  customer_id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  subtotal INTEGER,
  platform_fee INTEGER,
  total INTEGER,
  commission INTEGER,
  provider_earnings INTEGER,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','pending','accepted','completed','cancelled','refunded')),
  provider_id UUID,
  payment_gateway TEXT,
  ref_code TEXT,
  affiliate_id UUID,
  stripe_session_id TEXT,
  stripe_payment_intent TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  provider_paid BOOLEAN NOT NULL DEFAULT false,
  refund_id TEXT,
  refund_reason TEXT,
  rejection_log TEXT,
  escalated BOOLEAN NOT NULL DEFAULT false,
  admin_override BOOLEAN NOT NULL DEFAULT false,
  admin_note TEXT,
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_city ON bookings(service, city);

-- 2b. QUOTE REQUESTS (big / multi-person jobs — sales agent calls to scope & quote)
CREATE TABLE IF NOT EXISTS quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT,
  city TEXT,
  description TEXT,
  workers INTEGER DEFAULT 3,
  customer_name TEXT,
  customer_phone TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','called','quoted','won','lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status);

-- 3. RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='quote_requests' AND policyname='Service role full access on quote_requests') THEN
    CREATE POLICY "Service role full access on quote_requests" ON quote_requests FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='Service role full access on users') THEN
    CREATE POLICY "Service role full access on users" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings' AND policyname='Service role full access on bookings') THEN
    CREATE POLICY "Service role full access on bookings" ON bookings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================
-- supabase-bookings-scheduling-migration.sql
-- ============================================================
-- ============================================
-- WeAid Bookings — scheduling + location + dispatch
-- Run this in Supabase SQL Editor (safe/idempotent)
-- ============================================

-- When the customer wants the job done: NULL/asap = right now, else a timestamp
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS timing_mode TEXT DEFAULT 'asap' CHECK (timing_mode IN ('asap','scheduled'));

-- Customer location (for nearest-first dispatch)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_lat DOUBLE PRECISION;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_lng DOUBLE PRECISION;

-- Dispatch bookkeeping
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_phone TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- What the job actually is (so the pro knows what to do) + confirmation/reminders
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS provider_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

-- Number masking (call privacy) for booked jobs
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mask_number TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mask_session_id TEXT;

-- Crew size (multi-person jobs)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS workers INTEGER NOT NULL DEFAULT 1;


-- ============================================================
-- supabase-trips-migration.sql
-- ============================================================
-- ============================================
-- WeAid Trips — Rides + Courier (pickup → drop, fare, live-track, token)
-- Run in Supabase SQL Editor. Safe/idempotent.
-- ============================================

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'ride' CHECK (type IN ('ride','courier')),
  vehicle TEXT DEFAULT 'car' CHECK (vehicle IN ('bike','auto','car','courier')),

  pickup_address TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  drop_address TEXT,
  drop_lat DOUBLE PRECISION,
  drop_lng DOUBLE PRECISION,
  distance_km NUMERIC,

  fare INTEGER,
  commission INTEGER,
  provider_earnings INTEGER,

  item_description TEXT,          -- courier: what's being sent

  customer_name TEXT,
  customer_phone TEXT,

  status TEXT NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching','accepted','arrived','picked_up','in_transit','completed','cancelled')),
  driver_id UUID,
  driver_name TEXT,
  driver_phone TEXT,
  mask_number TEXT,

  pickup_token TEXT,              -- courier handover OTPs
  delivery_token TEXT,
  pickup_verified BOOLEAN NOT NULL DEFAULT false,
  delivery_verified BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);

-- Live driver position (one row per driver, updated as they move)
CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id UUID PRIMARY KEY,
  trip_id UUID,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carpool: someone going somewhere posts a ride; others join & split the cost.
CREATE TABLE IF NOT EXISTS carpools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_name TEXT NOT NULL,
  driver_phone TEXT NOT NULL,
  from_address TEXT, from_lat DOUBLE PRECISION, from_lng DOUBLE PRECISION,
  to_address TEXT, to_lat DOUBLE PRECISION, to_lng DOUBLE PRECISION,
  depart_at TIMESTAMPTZ,
  seats_total INTEGER NOT NULL DEFAULT 3,
  seats_left INTEGER NOT NULL DEFAULT 3,
  price_per_seat INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpools_status ON carpools(status);
CREATE TABLE IF NOT EXISTS carpool_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carpool_id UUID NOT NULL REFERENCES carpools(id),
  rider_name TEXT NOT NULL,
  rider_phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE carpools ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_seats ENABLE ROW LEVEL SECURITY;

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='trips' AND policyname='Service role full access on trips') THEN
    CREATE POLICY "Service role full access on trips" ON trips FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_locations' AND policyname='Service role full access on driver_locations') THEN
    CREATE POLICY "Service role full access on driver_locations" ON driver_locations FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='carpools' AND policyname='Service role full access on carpools') THEN
    CREATE POLICY "Service role full access on carpools" ON carpools FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='carpool_seats' AND policyname='Service role full access on carpool_seats') THEN
    CREATE POLICY "Service role full access on carpool_seats" ON carpool_seats FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================
-- supabase-food-migration.sql
-- ============================================================
-- ============================================
-- WeAid Food — menus + orders (Food Delivery & Home Food)
-- Delivery leg reuses the courier trip system. Run in Supabase SQL Editor.
-- ============================================

-- Dishes a food provider (restaurant / home chef) offers
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  veg BOOLEAN NOT NULL DEFAULT true,
  photo_url TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  sort INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_provider ON menu_items(provider_id);

-- A customer's food order (items snapshotted as JSON)
CREATE TABLE IF NOT EXISTS food_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  provider_name TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address TEXT,
  address_lat DOUBLE PRECISION,
  address_lng DOUBLE PRECISION,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  commission INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed','accepted','preparing','ready','out_for_delivery','delivered','cancelled')),
  trip_id UUID,                 -- the courier delivery trip
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_orders_provider ON food_orders(provider_id);
CREATE INDEX IF NOT EXISTS idx_food_orders_status ON food_orders(status);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_orders ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='menu_items' AND policyname='Service role full access on menu_items') THEN
    CREATE POLICY "Service role full access on menu_items" ON menu_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='food_orders' AND policyname='Service role full access on food_orders') THEN
    CREATE POLICY "Service role full access on food_orders" ON food_orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================
-- supabase-jobs-migration.sql
-- ============================================================
-- ============================================
-- WeAid Job Marketplace — Supabase Migration
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. MARKETPLACE JOBS TABLE
CREATE TABLE IF NOT EXISTS marketplace_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  city TEXT NOT NULL,
  budget_min INTEGER,
  budget_max INTEGER,
  when_needed TEXT DEFAULT 'flexible' CHECK (when_needed IN ('today','this_week','next_week','flexible')),
  skills TEXT[] DEFAULT '{}',
  scope TEXT DEFAULT 'small' CHECK (scope IN ('small','medium','large')),
  customer_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  urgent BOOLEAN NOT NULL DEFAULT false,
  bid_count INTEGER NOT NULL DEFAULT 0,
  fixed_price INTEGER,
  pricing_mode TEXT NOT NULL DEFAULT 'both' CHECK (pricing_mode IN ('bid','fixed','both')),
  accepted_bid_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON marketplace_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON marketplace_jobs(category);
CREATE INDEX IF NOT EXISTS idx_jobs_city ON marketplace_jobs(city);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON marketplace_jobs(customer_id);

-- 2. JOB BIDS TABLE
CREATE TABLE IF NOT EXISTS job_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES marketplace_jobs(id),
  provider_id UUID REFERENCES providers(id),
  provider_name TEXT NOT NULL,
  provider_phone TEXT NOT NULL,
  amount INTEGER NOT NULL,
  message TEXT,
  is_fixed_price BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bids_job ON job_bids(job_id);
CREATE INDEX IF NOT EXISTS idx_bids_provider ON job_bids(provider_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON job_bids(status);

-- 3. ROW LEVEL SECURITY
ALTER TABLE marketplace_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON marketplace_jobs;
CREATE POLICY "Service role full access" ON marketplace_jobs FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON job_bids;
CREATE POLICY "Service role full access" ON job_bids FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- supabase-reviews-migration.sql
-- ============================================================
-- ============================================
-- WeAid Reviews & Leads — Supabase Migration
-- Run this AFTER supabase-providers-migration.sql
-- ============================================

-- 1. PROVIDER REVIEWS
CREATE TABLE IF NOT EXISTS provider_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_provider ON provider_reviews(provider_id);

-- 2. LEADS — logged whenever a customer contacts a provider (Call / WhatsApp).
-- This is the foundation for the per-job lead fee.
CREATE TABLE IF NOT EXISTS provider_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  service TEXT,
  city TEXT,
  channel TEXT DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','call','profile')),
  customer_phone TEXT,
  fee_amount INTEGER DEFAULT 0,
  fee_status TEXT NOT NULL DEFAULT 'free' CHECK (fee_status IN ('free','pending','charged','waived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_provider ON provider_leads(provider_id);
CREATE INDEX IF NOT EXISTS idx_leads_created ON provider_leads(created_at);

-- 3. RLS
ALTER TABLE provider_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_leads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='provider_reviews' AND policyname='Service role full access on provider_reviews') THEN
    CREATE POLICY "Service role full access on provider_reviews" ON provider_reviews FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='provider_leads' AND policyname='Service role full access on provider_leads') THEN
    CREATE POLICY "Service role full access on provider_leads" ON provider_leads FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================================
-- supabase-affiliate-migration.sql
-- ============================================================
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
DROP POLICY IF EXISTS "Service role full access" ON affiliates;
CREATE POLICY "Service role full access" ON affiliates FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON referrals;
CREATE POLICY "Service role full access" ON referrals FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON affiliate_payouts;
CREATE POLICY "Service role full access" ON affiliate_payouts FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON affiliate_competitions;
CREATE POLICY "Service role full access" ON affiliate_competitions FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- supabase-payouts-migration.sql
-- ============================================================
-- WeAid — provider payouts, earnings & KYC
-- Marketplace-collected model: WeAid collects the full booking total; the
-- provider is paid their net (subtotal − commission) via a payout. This file
-- adds the payout ledger and provider verification fields.

-- Ensure the completion timestamp exists (completeJob stamps it).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Provider verification (KYC) — manual review, no third-party vendor needed.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'none'
  CHECK (kyc_status IN ('none','submitted','verified','rejected'));
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_id_type TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_id_number TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_doc_url TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ;

-- Payout requests: a provider asks to withdraw their pending balance.
-- amount is captured in paise-free rupees (INTEGER), matching the rest of the app.
CREATE TABLE IF NOT EXISTS payout_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_id  UUID NOT NULL,
  user_id      UUID,
  amount       INTEGER NOT NULL,
  jobs_count   INTEGER NOT NULL DEFAULT 0,
  method       TEXT,                       -- 'upi' | 'bank' | free text
  destination  TEXT,                       -- UPI id / masked acct, provider-supplied
  status       TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','processing','paid','rejected')),
  processed_at TIMESTAMPTZ,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_payout_requests_provider ON payout_requests(provider_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);

-- When a payout is marked paid, the included bookings are stamped provider_paid.
-- (bookings already has provider_paid BOOLEAN + paid_at from the base migration.)


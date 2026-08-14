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

-- 3. RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='Service role full access on users') THEN
    CREATE POLICY "Service role full access on users" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings' AND policyname='Service role full access on bookings') THEN
    CREATE POLICY "Service role full access on bookings" ON bookings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

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

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

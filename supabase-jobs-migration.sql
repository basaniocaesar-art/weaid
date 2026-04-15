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

CREATE POLICY "Service role full access" ON marketplace_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON job_bids FOR ALL USING (true) WITH CHECK (true);

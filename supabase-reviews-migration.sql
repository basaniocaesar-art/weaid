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

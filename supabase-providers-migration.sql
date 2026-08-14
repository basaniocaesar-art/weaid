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

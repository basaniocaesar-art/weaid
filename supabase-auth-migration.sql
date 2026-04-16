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
CREATE POLICY "Service role full access on users" ON users
  FOR ALL USING (true) WITH CHECK (true);

-- WeAid Pro app: phones that receive job offers, and when each pro was last online.
-- Paste into Supabase → SQL Editor → Run. Safe to run twice.
CREATE TABLE IF NOT EXISTS provider_devices (
  fcm_token TEXT PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  platform TEXT DEFAULT 'android',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_devices_provider ON provider_devices (provider_id);
ALTER TABLE provider_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref TEXT NOT NULL, kind TEXT NOT NULL, source TEXT,
  customer_name TEXT, customer_phone TEXT, booking_id UUID,
  summary TEXT, details JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

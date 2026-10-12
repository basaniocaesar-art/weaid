-- Complaints, callbacks and "call to arrange payment" tasks from the phone line
-- and the website assistant (lib/followup.js). Every ticket is ALSO emailed to
-- the team, so this table is the record, not the alarm. Safe to run twice.
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref TEXT NOT NULL,
  kind TEXT NOT NULL,          -- callback | payment | complaint | site_visit | provider
  source TEXT,                 -- phone | web
  customer_name TEXT,
  customer_phone TEXT,
  booking_id UUID,
  summary TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',   -- open | done
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_tickets_open ON support_tickets (status, created_at DESC);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_tickets' AND policyname='Service role full access on support_tickets') THEN
    CREATE POLICY "Service role full access on support_tickets" ON support_tickets FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

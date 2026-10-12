-- Carpool v2: verified drivers, cost-share pricing, pay-to-book seats, ride codes, payouts.
-- Paste into Supabase → SQL Editor → Run (weaid-production). Safe to run twice.
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES providers(id);
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS car_model TEXT;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS car_number TEXT;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS stops JSONB DEFAULT '[]'::jsonb;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS distance_km NUMERIC;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS fee_per_seat INTEGER NOT NULL DEFAULT 25;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE carpools ADD COLUMN IF NOT EXISTS payout_sent_at TIMESTAMPTZ;

ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS seats INTEGER NOT NULL DEFAULT 1;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;   -- what the rider pays (seats x price + fees)
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS fee INTEGER NOT NULL DEFAULT 0;      -- WeAid's booking fee inside amount
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_payment'; -- pending_payment | confirmed | boarded | cancelled | refunded | no_show
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS pickup TEXT;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS refund_amount INTEGER;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE carpool_seats ADD COLUMN IF NOT EXISTS boarded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS carpool_seats_ride ON carpool_seats (carpool_id);
CREATE INDEX IF NOT EXISTS carpools_depart ON carpools (status, depart_at);

-- ============================================
-- WeAid Trips — Rides + Courier (pickup → drop, fare, live-track, token)
-- Run in Supabase SQL Editor. Safe/idempotent.
-- ============================================

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL DEFAULT 'ride' CHECK (type IN ('ride','courier')),
  vehicle TEXT DEFAULT 'car' CHECK (vehicle IN ('bike','auto','car','courier')),

  pickup_address TEXT,
  pickup_lat DOUBLE PRECISION,
  pickup_lng DOUBLE PRECISION,
  drop_address TEXT,
  drop_lat DOUBLE PRECISION,
  drop_lng DOUBLE PRECISION,
  distance_km NUMERIC,

  fare INTEGER,
  commission INTEGER,
  provider_earnings INTEGER,

  item_description TEXT,          -- courier: what's being sent

  customer_name TEXT,
  customer_phone TEXT,

  status TEXT NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching','accepted','arrived','picked_up','in_transit','completed','cancelled')),
  driver_id UUID,
  driver_name TEXT,
  driver_phone TEXT,
  mask_number TEXT,

  pickup_token TEXT,              -- courier handover OTPs
  delivery_token TEXT,
  pickup_verified BOOLEAN NOT NULL DEFAULT false,
  delivery_verified BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);

-- Live driver position (one row per driver, updated as they move)
CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id UUID PRIMARY KEY,
  trip_id UUID,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Carpool: someone going somewhere posts a ride; others join & split the cost.
CREATE TABLE IF NOT EXISTS carpools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_name TEXT NOT NULL,
  driver_phone TEXT NOT NULL,
  from_address TEXT, from_lat DOUBLE PRECISION, from_lng DOUBLE PRECISION,
  to_address TEXT, to_lat DOUBLE PRECISION, to_lng DOUBLE PRECISION,
  depart_at TIMESTAMPTZ,
  seats_total INTEGER NOT NULL DEFAULT 3,
  seats_left INTEGER NOT NULL DEFAULT 3,
  price_per_seat INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpools_status ON carpools(status);
CREATE TABLE IF NOT EXISTS carpool_seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carpool_id UUID NOT NULL REFERENCES carpools(id),
  rider_name TEXT NOT NULL,
  rider_phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE carpools ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_seats ENABLE ROW LEVEL SECURITY;

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='trips' AND policyname='Service role full access on trips') THEN
    CREATE POLICY "Service role full access on trips" ON trips FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='driver_locations' AND policyname='Service role full access on driver_locations') THEN
    CREATE POLICY "Service role full access on driver_locations" ON driver_locations FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='carpools' AND policyname='Service role full access on carpools') THEN
    CREATE POLICY "Service role full access on carpools" ON carpools FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='carpool_seats' AND policyname='Service role full access on carpool_seats') THEN
    CREATE POLICY "Service role full access on carpool_seats" ON carpool_seats FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

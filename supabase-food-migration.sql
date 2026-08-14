-- ============================================
-- WeAid Food — menus + orders (Food Delivery & Home Food)
-- Delivery leg reuses the courier trip system. Run in Supabase SQL Editor.
-- ============================================

-- Dishes a food provider (restaurant / home chef) offers
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  veg BOOLEAN NOT NULL DEFAULT true,
  photo_url TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  sort INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_menu_provider ON menu_items(provider_id);

-- A customer's food order (items snapshotted as JSON)
CREATE TABLE IF NOT EXISTS food_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id),
  provider_name TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address TEXT,
  address_lat DOUBLE PRECISION,
  address_lng DOUBLE PRECISION,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  commission INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed','accepted','preparing','ready','out_for_delivery','delivered','cancelled')),
  trip_id UUID,                 -- the courier delivery trip
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_orders_provider ON food_orders(provider_id);
CREATE INDEX IF NOT EXISTS idx_food_orders_status ON food_orders(status);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_orders ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='menu_items' AND policyname='Service role full access on menu_items') THEN
    CREATE POLICY "Service role full access on menu_items" ON menu_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='food_orders' AND policyname='Service role full access on food_orders') THEN
    CREATE POLICY "Service role full access on food_orders" ON food_orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

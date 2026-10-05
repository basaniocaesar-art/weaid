-- Google's data, kept separate from WeAid's own.
--
-- A seeded listing carries the star rating Google shows publicly. Putting that
-- into providers.rating would present somebody else's reputation as ours, and
-- the first provider to spot it would be right to object. So it lives here,
-- labelled, and the directory can show "4.6 on Google" or nothing at all.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS google_rating NUMERIC;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS google_reviews INTEGER;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS website TEXT;

-- A listing nobody asked for needs a way out that takes one click and no login.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS removal_reason TEXT;

CREATE INDEX IF NOT EXISTS providers_services_idx ON providers USING GIN (services);
CREATE INDEX IF NOT EXISTS providers_city_idx ON providers (city);

-- WeAid Jobs (job portal, WorkIndia-style). Paste in Supabase → SQL Editor → Run (weaid-production). Safe to run twice.
CREATE TABLE IF NOT EXISTS jp_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL DEFAULT gen_random_uuid(),         -- private login link
  name TEXT NOT NULL, phone TEXT NOT NULL, whatsapp TEXT, email TEXT,
  gender TEXT, age INTEGER, role TEXT, roles TEXT[] DEFAULT '{}',
  experience_years NUMERIC, education TEXT, languages TEXT[] DEFAULT '{}',
  area TEXT, city TEXT DEFAULT 'kochi', expected_salary INTEGER, about TEXT,
  photo_path TEXT, cv_path TEXT, voice_path TEXT,
  provider_id UUID REFERENCES providers(id),               -- if also a WeAid pro (shares ID check)
  verified BOOLEAN DEFAULT FALSE, open_to_work BOOLEAN DEFAULT TRUE, removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jp_candidates_phone ON jp_candidates (phone);
CREATE INDEX IF NOT EXISTS jp_candidates_role ON jp_candidates (role);

CREATE TABLE IF NOT EXISTS jp_employers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL, contact_name TEXT, phone TEXT NOT NULL, email TEXT,
  area TEXT, city TEXT DEFAULT 'kochi', kind TEXT,                 -- business | household
  approved BOOLEAN DEFAULT FALSE,                                   -- first post screened by owner
  plan TEXT, plan_until TIMESTAMPTZ, unlocks_left INTEGER DEFAULT 0, boosts_left INTEGER DEFAULT 0,
  removed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jp_employers_phone ON jp_employers (phone);

CREATE TABLE IF NOT EXISTS jp_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES jp_employers(id),
  title TEXT NOT NULL, role TEXT, description TEXT,
  area TEXT, city TEXT DEFAULT 'kochi',
  salary_min INTEGER, salary_max INTEGER, experience TEXT, education TEXT, shift TEXT, openings INTEGER DEFAULT 1,
  gender TEXT, job_type TEXT DEFAULT 'full_time',                    -- full_time | part_time | contract
  status TEXT NOT NULL DEFAULT 'review',                             -- review | live | paused | closed | rejected
  screen JSONB, boosted_until TIMESTAMPTZ, slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jp_jobs_live ON jp_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS jp_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jp_jobs(id),
  candidate_id UUID NOT NULL REFERENCES jp_candidates(id),
  status TEXT NOT NULL DEFAULT 'applied',                            -- applied | shortlisted | interview | hired | rejected | withdrawn
  slots JSONB DEFAULT '[]'::jsonb, slot_chosen TIMESTAMPTZ, note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jp_applications_once ON jp_applications (job_id, candidate_id);

CREATE TABLE IF NOT EXISTS jp_unlocks (
  employer_id UUID NOT NULL REFERENCES jp_employers(id),
  candidate_id UUID NOT NULL REFERENCES jp_candidates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employer_id, candidate_id)
);
ALTER TABLE jp_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_employers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE jp_unlocks ENABLE ROW LEVEL SECURITY;

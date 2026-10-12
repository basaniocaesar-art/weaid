-- Errands: a job we are arranging for somebody by ringing round.
--
-- Separate from bookings on purpose. A booking is a paid job against a WeAid
-- provider with a price from our own list. An errand is "my fan has stopped in
-- a town we don't cover" — the businesses come from a map search, nobody has
-- an account, and no money moves through us. Same shape, different thing, and
-- putting them in one table would mean every booking query carrying "...and
-- not an errand".

create table if not exists errands (
  id                uuid primary key default gen_random_uuid(),

  -- what somebody wants done, in their own words
  what              text not null,
  area              text,
  city              text,

  -- when they want it. `wanted_by` is the hard edge, `wanted_window` is how
  -- they said it ("tomorrow morning"), kept because that is what the agent
  -- should say out loud.
  wanted_window     text,
  wanted_by         timestamptz,

  -- who it is for
  customer_name     text,
  customer_phone    text not null,
  owner_ref         text,                    -- the Lenz AI account that asked

  -- everyone we could ring, newest search first: [{name, phone, rating, reviews}]
  candidates        jsonb not null default '[]'::jsonb,
  -- phones already rung, so a widening round never rings the same shop twice
  tried             jsonb not null default '[]'::jsonb,

  status            text not null default 'ringing',
                    -- ringing | arranged | nobody | cancelled
  round_at          timestamptz,             -- when the current round went out

  -- who said yes
  provider_name     text,
  provider_phone    text,
  agreed_time       text,
  agreed_price      text,
  summary           text,

  -- the call back to the customer telling them it is sorted
  customer_told_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists errands_open on errands (status, round_at);
create index if not exists errands_owner on errands (owner_ref, created_at desc);

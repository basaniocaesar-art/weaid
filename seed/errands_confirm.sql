-- Two-sided confirmation.
--
-- A shop saying "yes, Thursday at ten, five hundred" is not a booking — the
-- customer has not seen it yet. So the shop is told we will ring back once the
-- customer confirms, and nobody holds a slot on a maybe.
--
-- Safe to run twice.

alter table errands add column if not exists customer_said   text;          -- agreed | refused | unclear
alter table errands add column if not exists confirmed_at    timestamptz;   -- the provider has been told it is on
alter table errands add column if not exists declined_phones jsonb not null default '[]'::jsonb;

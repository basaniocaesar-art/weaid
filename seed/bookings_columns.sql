-- WeAid: make the bookings table match what the booking code actually writes.
--
-- Why this exists: /api/booking/create inserts nine columns the table has never
-- had, so every insert failed with
--
--     Could not find the 'commission' column of 'bookings' in the schema cache
--
-- and the table is empty — not one booking has ever been taken, from the
-- dashboard or from the concierge. The code is right and the table is behind:
-- lib/orchestrator.js notifies on customer_phone, emails customer_email, pays
-- providers out of provider_earnings and refunds against total, and
-- pages/api/provider/jobs.js shows the pro their share. So the columns are
-- added rather than the eight files rewritten, and the empty table means there
-- is nothing to migrate.
--
-- Paste into Supabase → SQL Editor → Run. Safe to run twice.

alter table public.bookings
  -- Who to ring. The concierge books people who have no account at all, so a
  -- name and a number have to live on the booking itself and not only behind a
  -- user_id. user_id stays for signed-in customers.
  add column if not exists customer_id    uuid,
  add column if not exists customer_name  text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text,

  -- The money, split the way lib/pricing.js splits it. platform_fee already
  -- exists; these are the other four figures it returns.
  add column if not exists subtotal          numeric(10,2),
  add column if not exists total             numeric(10,2),
  add column if not exists commission        numeric(10,2),
  add column if not exists provider_earnings numeric(10,2),

  -- Which gateway took the money, and its reference, so a payment can be found
  -- again from either end when someone disputes a charge.
  add column if not exists payment_gateway       text,
  add column if not exists razorpay_order_id     text,
  add column if not exists razorpay_payment_id   text,
  add column if not exists stripe_payment_intent text,
  add column if not exists refund_id             text,
  add column if not exists refunded_at           timestamptz,
  add column if not exists refund_reason         text,

  -- Why a provider handed the job back. Written by providerRejectJob, which
  -- would otherwise fail the whole update and leave the job stuck on a pro who
  -- has already said no.
  add column if not exists rejection_log         text,

  -- When the provider actually agreed to turn up. Accepting a job and agreeing
  -- a time are one decision: without these the customer is told somebody took
  -- the job and nothing about when, which is the complaint about every trade.
  -- eta_minutes is what they said for an as-soon-as-possible job; agreed_at is
  -- the hour it works out to, and is what the page counts down to.
  add column if not exists agreed_at             timestamptz,
  add column if not exists eta_minutes           integer;

-- A customer ringing about "my booking" is found by their number, and the
-- dispatcher lists today's unaccepted jobs. Both are index scans now.
create index if not exists bookings_customer_phone_idx on public.bookings (customer_phone);
create index if not exists bookings_status_created_idx  on public.bookings (status, created_at desc);

-- One payment can only ever pay for one booking.
create unique index if not exists bookings_razorpay_payment_id_key
  on public.bookings (razorpay_payment_id) where razorpay_payment_id is not null;

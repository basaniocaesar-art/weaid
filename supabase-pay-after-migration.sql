-- WeAid — book first, pay after the job
--
-- Until now a booking reached no provider until the customer had paid in full,
-- so a repair booked by someone who did not want to pay a stranger up front sat
-- in pending_payment for ever. This adds what the pay-after model needs:
--
--   payment_mode   prepaid    the old flow: paid first, then dispatched
--                  pay_after  dispatched at once; collected when the job is done
--                  visit_fee  the ₹99 site-visit jobs (lib/quotes.js), unchanged
--   confirmed_at   "outreach may start" — set by payment (prepaid) or by the
--                  booking itself (pay_after). Every provider-facing query keys
--                  on this instead of paid_at.
--   provider_ledger  what a pro owes WeAid when they took cash for a job
--                  (the commission), and what has been netted off their payouts.
--
-- Safe to re-run. No status values are added: a pay-after job goes straight to
-- 'pending' and a finished-but-unpaid one is 'completed' with paid_at null.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'prepaid';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_payment_mode_check') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_payment_mode_check
      CHECK (payment_mode IN ('prepaid', 'pay_after', 'visit_fee'));
  END IF;
END $$;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
-- Jobs paid for before this migration were dispatched at the moment of payment.
UPDATE bookings SET confirmed_at = paid_at WHERE confirmed_at IS NULL AND paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed ON bookings(status, confirmed_at);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_phone ON bookings(customer_phone);

-- One row per rupee movement between a pro and WeAid outside the normal payout:
--   commission_due   +amount  the pro took cash for a job and owes WeAid its share
--   netted           -amount  taken off a weekly payout
--   settled          -amount  the pro paid WeAid directly (owner records it in Ops)
--   adjustment       ±amount  owner's correction, with a note
-- balance = SUM(amount); above PRO_OWED_LIMIT (default ₹1000) the pro gets no new offers.
CREATE TABLE IF NOT EXISTS provider_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_id  UUID NOT NULL,
  booking_id   UUID,
  kind         TEXT NOT NULL CHECK (kind IN ('commission_due', 'netted', 'settled', 'adjustment')),
  amount       INTEGER NOT NULL,          -- rupees; positive = the pro owes WeAid
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_ledger_provider ON provider_ledger(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_ledger_booking ON provider_ledger(booking_id);
ALTER TABLE provider_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on provider_ledger" ON provider_ledger;
CREATE POLICY "Service role full access on provider_ledger" ON provider_ledger
  FOR ALL USING (true) WITH CHECK (true);

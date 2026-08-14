-- WeAid — provider payouts, earnings & KYC
-- Marketplace-collected model: WeAid collects the full booking total; the
-- provider is paid their net (subtotal − commission) via a payout. This file
-- adds the payout ledger and provider verification fields.

-- Ensure the completion timestamp exists (completeJob stamps it).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Provider verification (KYC) — manual review, no third-party vendor needed.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'none'
  CHECK (kyc_status IN ('none','submitted','verified','rejected'));
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_id_type TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_id_number TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_doc_url TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ;

-- Payout requests: a provider asks to withdraw their pending balance.
-- amount is captured in paise-free rupees (INTEGER), matching the rest of the app.
CREATE TABLE IF NOT EXISTS payout_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_id  UUID NOT NULL,
  user_id      UUID,
  amount       INTEGER NOT NULL,
  jobs_count   INTEGER NOT NULL DEFAULT 0,
  method       TEXT,                       -- 'upi' | 'bank' | free text
  destination  TEXT,                       -- UPI id / masked acct, provider-supplied
  status       TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','processing','paid','rejected')),
  processed_at TIMESTAMPTZ,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_payout_requests_provider ON payout_requests(provider_id);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);

-- When a payout is marked paid, the included bookings are stamped provider_paid.
-- (bookings already has provider_paid BOOLEAN + paid_at from the base migration.)

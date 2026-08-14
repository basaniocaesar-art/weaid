# WeAid — Go-Live Checklist

Plain-English steps to switch WeAid from "built" to "taking real bookings and payments."
Work top to bottom. You only need a browser — no coding.

---

## Step 1 — Create your database (Supabase)

This is the backbone. Nothing (login, bookings, provider app) works without it.

1. Go to **supabase.com** → sign up (free) → **New project**. Pick a name and a strong database password (save it).
2. Once it's ready, open **Project Settings → API**. Copy these three values — you'll paste them in Step 3:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (secret) → `SUPABASE_SERVICE_KEY`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Step 2 — Create the tables (run the migrations)

In Supabase, open the **SQL Editor** (left menu). For each file below, open it from this repo,
copy all the text, paste it into a new query, and click **Run**. Do them in this order:

1. `supabase-auth-migration.sql`
2. `supabase-providers-migration.sql`
3. `supabase-bookings-base-migration.sql`
4. `supabase-bookings-scheduling-migration.sql`
5. `supabase-trips-migration.sql`
6. `supabase-food-migration.sql`
7. `supabase-jobs-migration.sql`
8. `supabase-reviews-migration.sql`
9. `supabase-affiliate-migration.sql`
10. `supabase-payouts-migration.sql`  ← **new: earnings, payouts & verification**

Each is safe to re-run (they use "IF NOT EXISTS"). If one says "already exists," that's fine.

## Step 3 — Turn on login

In Supabase → **Authentication → Providers**, enable **Email** (and **Phone** if you want OTP login).
That's what powers the customer and provider apps.

## Step 4 — Paste your keys into Vercel

In your Vercel project → **Settings → Environment Variables**, add the values below,
then **Redeploy**. Grouped by what each unlocks.

### Required — the app runs
| Key | What it is |
|-----|-----------|
| `SUPABASE_URL` | From Step 1 |
| `SUPABASE_SERVICE_KEY` | From Step 1 (keep secret) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Step 1 |
| `NEXT_PUBLIC_URL` | Your live site, e.g. `https://weaid.in` |

### Required to take payments (marketplace-collected)
You collect the full amount; providers are paid their net later. Use Razorpay for India.
| Key | Where to get it |
|-----|-----------------|
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks (point it at `https://weaid.in/api/webhook/razorpay`) |
| `STRIPE_SECRET_KEY` | *(optional — only if you also take international cards)* |
| `STRIPE_WEBHOOK_SECRET` | *(optional)* Stripe → Webhooks → `https://weaid.in/api/webhook/stripe` |

### Recommended — emails (booking confirmations, payout & KYC alerts to you)
| Key | What it is |
|-----|-----------|
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | Your email sending account (e.g. Gmail app password, or a service like Resend/Zoho) |
| `EMAIL_FROM` | e.g. `WeAid <noreply@weaid.in>` |
| `ADMIN_EMAIL` | **Your** inbox — payout requests & ID submissions land here |

### Optional — extra features (add anytime)
| Feature | Keys |
|---------|------|
| Private masked calls | `MASKING_API_URL`, `MASKING_API_KEY`, `MASKING_TTL_MIN` (Exotel/Edesy) |
| WhatsApp notifications | `WHATSAPP_API_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_FROM_NUMBER` |
| AI voice caller | `SARVAM_*`, `VOICE_*` |
| Admin/cron protection | `ADMIN_SECRET`, `CRON_SECRET` (set to any long random strings) |

## Step 5 — Test the money flow end to end

1. Sign up as a **customer**, book a service, and pay with a Razorpay **test card**.
   Confirm the booking shows in Supabase → `bookings` with `status = paid/accepted`.
2. Sign up as a **provider** (`/provider-signup`), accept the job, mark it **complete**.
3. Open the provider **Earnings** tab — the completed job's net amount should appear as
   **pending payout**. Tap **Withdraw** → you (ADMIN_EMAIL) get a payout-request email.
4. Submit **Verify identity** as the provider → you get the KYC email. Approve it in Supabase
   (`providers.kyc_status = 'verified'`) and the ✓ badge appears.

---

## How the money works (so it's clear)

- Customer pays the **full amount** into your Razorpay/Stripe account.
- Each completed job credits the provider their **net** (service price − your commission).
  Commission is 8–20% depending on service (see `lib/pricing.js`), plus the ₹49 platform fee.
- Providers request a **payout** of their pending balance; you pay them and mark it paid.
  Because you only ever pay them the net, **your commission is captured automatically.**

## Notes
- **Distance/fare** now uses real road distance (OSRM). At higher ride volume, swap in your own
  router or Google Directions in `lib/geo.js` (one file).
- **Payout automation** (auto-paying providers via Razorpay Payouts / Stripe Connect) is a future
  upgrade — today payouts are requested in-app and you settle them manually. Fine for launch.

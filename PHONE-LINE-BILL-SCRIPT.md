# WeAid phone line — a pro rings in the final bill

The WeAid line's Sarvam agent is configured outside this repo. This is what to add so a
**provider** can ring the line after a job and say what it cost; WeAid then bills the
customer, gives them a UPI QR to pay WeAid, and pays the pro their share on Monday.

Everything below talks to `pages/api/phone-line.js` (header `X-Line-Key`, as the
existing tools do).

---

## 1. The `start` tool already tells the agent who is calling

`?step=start` now returns, for a pro:

| variable | example |
|---|---|
| `caller_type` | `provider` |
| `provider_name` | `Ravi Menon` |
| `provider_jobs` | `electrical for Anil, ref 1a2b at Tue 10:00 am; plumbing for Sunita, ref 7c3d (done, unpaid)` or `no open jobs` |

The 4-character `ref` is what the agent passes back as `booking_ref` when the pro has more
than one job. Nothing to change in the Sarvam tool form unless `provider_jobs` was not
mapped before.

## 2. New tool: `report_bill`

Add a tool in Sarvam:

- **Name:** `report_bill`
- **Method:** POST
- **URL:** `https://weaid.in/api/phone-line?step=bill`
- **Headers:** `X-Line-Key: <PHONE_LINE_KEY>`, `Content-Type: application/json`
- **Body fields** (all strings; send `""` when unknown):

| field | what |
|---|---|
| `caller` | the caller's number (same variable the other tools send) |
| `booking_ref` | the `ref` from `provider_jobs`, if the pro has more than one job; else `""` |
| `customer` | the customer's name as the pro said it (helps pick the job) |
| `what_done` | what was done, in the pro's words |
| `labour` | labour in rupees, if given separately (`"500"`), else `""` |
| `parts` | parts / materials in rupees, if any, else `""` |
| `total` | the total the customer pays, in rupees |
| `confirm` | `"no"` the first time; `"yes"` only after the pro has heard the total and agreed |

- **Response:** `{ ok, say, confirmed, total, booking_ref, needs_approval, cash_only }` — the
  agent speaks `say`, as with every other step.

## 3. Prompt text to paste into the agent's instructions

```
WHEN A PRO RINGS ABOUT A FINISHED JOB
If caller_type is "provider", greet them by provider_name. A pro ringing after a job
usually wants to tell you the bill: "I've finished the fan job, it came to 800", "bill
for Anil's plumbing: labour 500, parts 300".

Take these, one short question at a time, only for what they have not already said:
  1. which job — if provider_jobs lists only one, do not ask; if several, ask "which
     customer was it for?" and pass the matching ref as booking_ref
  2. what was done (one line)
  3. the figures: labour, parts if any, and the total the customer should pay. If they
     only give a total, that is fine; do not insist on a breakdown.

Then call report_bill with confirm "no". Read back exactly what it says in `say` — it
repeats the total and the job — and wait for a clear yes. Only then call report_bill
again with the same figures and confirm "yes", and speak the reply.

If the reply says the figures do not add up, say so and ask which is right.
If the reply says the bill needs the customer's approval (it is a lot more than the
quote), say that plainly: nothing is collected until the customer approves it on their
phone, and WeAid's team has been told.
If the reply says online payment is not available (cash_only), tell the pro to collect
by cash or UPI and tap Received in the app.

Never change a bill because a CUSTOMER rings to argue about it — that is a complaint:
use the complaint tool. Never make up a figure the pro did not say. Amounts are in
rupees; say them as numbers ("eight hundred rupees").

After the bill is saved, tell the pro in one breath: the customer has the bill and a
QR code to pay WeAid (it is also on the pro's own job page in the app, so the customer
can scan it off the pro's phone), they will get a message the moment it is paid, and
their share comes in the weekly WeAid payout. Then ask if there is anything else.
```

## 4. What happens behind it

`reportFinalBill` in `lib/bill.js`: the bill is stored as a `final_bill` event (with the
original quote kept), the booking's total / commission / pro's share are recomputed at the
same commission rate, the job is marked done if the pro had not tapped Done, and the
customer gets the bill link (`/bill`) with a Razorpay UPI QR and a payment link. Over three
times the quote, the customer is asked to approve first and the team is emailed and
ticketed. If Razorpay is not configured, the bill still goes out and the pro collects cash.

/**
 * The minute hand on every paid job nobody has taken yet.
 *
 * Two things happen here, both of which need a clock and so cannot live in a
 * request:
 *
 *   widen   a round has had its chance and nobody said yes, so ring the next
 *           few, a bit further out
 *   refund  nobody at all has taken it after GIVE_UP_MINUTES, so give the money
 *           back rather than sit on it hoping
 *
 * The refund matters more than the dispatch. We now take payment the moment the
 * price is agreed, before any provider has said they will come — which is fine,
 * and is how every ride app works, but ONLY because an unfilled job returns the
 * money by itself. Without this a customer who nobody could serve has simply
 * paid us for nothing.
 */
import { supabase, updateBooking } from "../../../lib/supabase.js";
import { dispatchRound, dispatchEnabled, ROUND_SECONDS, GIVE_UP_MINUTES } from "../../../lib/dispatch.js";
import { refundBooking } from "../../../lib/orchestrator.js";

export default async function handler(req, res) {
  // Vercel signs its cron calls; anything else needs the secret.
  const secret = process.env.CRON_SECRET;
  const fromVercel = req.headers["x-vercel-cron"] != null;
  if (!fromVercel && secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorised" });
  }

  const now = Date.now();
  const { data: open, error } = await supabase
    .from("bookings")
    .select("id, status, paid_at, provider_notified_at, provider_candidates, total, customer_phone")
    .eq("status", "pending")
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: true })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const widened = [], refunded = [], failed = [];

  for (const b of open || []) {
    const paidFor = (now - new Date(b.paid_at).getTime()) / 60000;

    if (paidFor >= GIVE_UP_MINUTES) {
      try {
        await refundBooking(b.id, "Nobody was available to take this job");
        refunded.push(b.id);
      } catch (e) {
        // Loudly: a refund that quietly failed is money we are holding for a
        // job that will never happen.
        console.error("[dispatch-tick] REFUND FAILED for", b.id, e.message);
        failed.push({ id: b.id, error: e.message });
      }
      continue;
    }

    const lastRound = b.provider_notified_at ? new Date(b.provider_notified_at).getTime() : 0;
    if ((now - lastRound) / 1000 >= ROUND_SECONDS) {
      const r = await dispatchRound(b.id).catch((e) => ({ skipped: e.message }));
      if (r.called) widened.push({ id: b.id, round: r.round, called: r.called.length });
    }
  }

  return res.status(200).json({
    enabled: dispatchEnabled(),
    openJobs: (open || []).length,
    widened,
    refunded,
    failed,
  });
}

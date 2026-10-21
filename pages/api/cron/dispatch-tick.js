/**
 * The minute hand on every paid job nobody has taken yet.
 *
 * Four things happen here, all of which need a clock and so cannot live in a
 * request:
 *
 *   offers  move the WeAid Pro app's offer rounds on, so a job nobody is
 *           polling still reaches the phone calls (offers.js → noPros)
 *   settle  read the call log; the first pro who said yes gets the job
 *   widen   a round has had its chance and nobody said yes, so ring the next
 *           few, a bit further out
 *   give up nobody at all has taken it after GIVE_UP_MINUTES, or there is
 *           nobody left to ring: hand it to the owner (FORWARD_TO_OWNER, on
 *           unless "false"), else give the money back rather than sit on it
 *
 * The refund matters more than the dispatch. We now take payment the moment the
 * price is agreed, before any provider has said they will come — which is fine,
 * and is how every ride app works, but ONLY because an unfilled job returns the
 * money by itself. Without this a customer who nobody could serve has simply
 * paid us for nothing.
 */
import { supabase, updateBooking } from "../../../lib/supabase.js";
import { dispatchRound, dispatchEnabled, settleDispatch, ROUND_SECONDS, GIVE_UP_MINUTES } from "../../../lib/dispatch.js";
import { refundBooking } from "../../../lib/orchestrator.js";
import { advanceOffers, noPros } from "../../../lib/offers.js";

export default async function handler(req, res) {
  // Vercel signs its cron calls; anything else needs the secret.
  const secret = process.env.CRON_SECRET;
  const fromVercel = req.headers["x-vercel-cron"] != null;
  if (!fromVercel && secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorised" });
  }

  await advanceOffers().catch((e) => console.error("[dispatch-tick] offers", e.message));

  const now = Date.now();
  const { data: open, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "pending")
    .is("provider_id", null)
    .is("provider_name", null)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: true })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const widened = [], awarded = [], forwarded = [], refunded = [], failed = [];

  // Nobody could take it: the owner first, while WeAid is small enough that he
  // can; the money back only when he has switched that off.
  async function giveUp(b) {
    if (process.env.FORWARD_TO_OWNER !== "false") {
      await noPros(b, { afterCalls: true });
      forwarded.push(b.id);
      return;
    }
    try {
      await refundBooking(b.id, "Nobody was available to take this job");
      refunded.push(b.id);
    } catch (e) {
      // Loudly: a refund that quietly failed is money we are holding for a
      // job that will never happen.
      console.error("[dispatch-tick] REFUND FAILED for", b.id, e.message);
      failed.push({ id: b.id, error: e.message });
    }
  }

  for (const b of open || []) {
    const s = await settleDispatch(b).catch((e) => ({ error: e.message }));
    if (s.awarded) { awarded.push({ id: b.id, to: s.awarded }); continue; }
    if (s.alreadyTaken) continue;

    const paidFor = (now - new Date(b.paid_at).getTime()) / 60000;
    if (paidFor >= GIVE_UP_MINUTES) { await giveUp(b); continue; }

    // Only jobs already being rung round are widened; the first round is
    // started by offers.js once the app has had its chance.
    if (!(b.provider_candidates || []).length) continue;
    const lastRound = b.provider_notified_at ? new Date(b.provider_notified_at).getTime() : 0;
    if ((now - lastRound) / 1000 >= ROUND_SECONDS) {
      const r = await dispatchRound(b).catch((e) => ({ skipped: e.message }));
      if (r.called) widened.push({ id: b.id, round: r.round, called: r.called.length });
      // The last round has had its chance and there is nobody left to ring.
      else if (r.exhausted) await giveUp(b);
    }
  }

  return res.status(200).json({
    enabled: dispatchEnabled(),
    openJobs: (open || []).length,
    awarded,
    widened,
    forwarded,
    refunded,
    failed,
  });
}

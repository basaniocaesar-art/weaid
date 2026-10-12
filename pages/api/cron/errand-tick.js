/**
 * The minute hand on every errand we are still ringing round about.
 *
 * Three things happen here, all of which need a clock and so cannot live in a
 * request:
 *
 *   settle   somebody said yes — record it and stop ringing
 *   tell     ring the customer back with a name and a time
 *   widen    the round has had its chance, so ring the next few
 *   give up  nobody at all, so ring the customer and say so honestly
 *
 * "Tell" is the one that matters. Everything else is plumbing; being rung back
 * with "Cool Wing are coming between ten and eleven, five hundred for the
 * visit" is the entire product. Without it the customer is watching a chat
 * window waiting for a machine to finish ringing plumbers, which is worse than
 * ringing them himself.
 */
import { supabase } from "../../../lib/supabase.js";
import {
  openErrands, ringRound, settle, tellCustomer, askedEnough, releaseOthers,
  confirmProvider, readCustomerAnswer, reopen,
  ROUND_SECONDS, GIVE_UP_MINUTES, withinCallingHours,
} from "../../../lib/errands.js";

export default async function handler(req, res) {
  // Vercel signs its cron calls; anything else needs the secret.
  const secret = process.env.CRON_SECRET;
  const fromVercel = req.headers["x-vercel-cron"] != null;
  if (!fromVercel && secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorised" });
  }

  const now = Date.now();
  const open = await openErrands(30);
  const out = { settled: [], told: [], confirmed: [], reopened: [], released: [], widened: [], gaveUp: [], skipped: 0 };

  for (const e of open) {
    try {
      /*
       * Arranged means a shop said yes, NOT that it is booked. The shop was
       * told we would ring back to confirm, so the loop is only closed once
       * the customer has said the time suits and the shop has been told.
       */
      if (e.status === "arranged") {
        if (!e.customer_told_at) {
          const t = await tellCustomer(e);
          if (t.calling) out.told.push({ id: e.id, to: t.calling });
          continue;
        }

        const answer = await readCustomerAnswer(e);
        if (answer.pending) continue;          // still on the phone to them

        if (answer.said === "agreed") {
          const c = await confirmProvider(e);
          if (c.confirming) out.confirmed.push({ id: e.id, to: c.confirming });
          continue;
        }

        // They did not want that time. Back out it goes, minus that shop.
        const again = await reopen(e);
        if (again) out.reopened.push({ id: e.id, without: e.provider_name });
        continue;
      }

      const s = await settle(e);
      if (s.arranged) {
        out.settled.push({ id: e.id, who: s.arranged.provider_name });
        // The customer first — they are the one waiting. Then anyone else who
        // said yes, so nobody holds a slot for a job that is already covered.
        const t = await tellCustomer(s.arranged);
        if (t.calling) out.told.push({ id: e.id, to: t.calling });
        const r = await releaseOthers(s.arranged).catch(() => ({ released: [] }));
        if (r.released?.length) out.released.push({ id: e.id, who: r.released });
        continue;
      }

      const age = now - new Date(e.created_at).getTime();
      const since = e.round_at ? now - new Date(e.round_at).getTime() : Infinity;

      // Time alone is not enough: ten people have to have been asked before
      // "nobody could take it" is a true sentence.
      if (age > GIVE_UP_MINUTES * 60_000 && askedEnough(e)) {
        await supabase
          .from("errands")
          .update({ status: "nobody", updated_at: new Date().toISOString() })
          .eq("id", e.id)
          .eq("status", "ringing");
        /*
         * Told, not left hanging.
         *
         * A customer who was promised a call back and never gets one is worse
         * off than one who was told no at the start — he has spent the
         * afternoon assuming it was handled.
         */
        await tellCustomer({
          ...e,
          provider_name: null,
          what: e.what,
          agreed_time: null,
          agreed_price: null,
          customer_told_at: null,
        }).catch(() => {});
        out.gaveUp.push({ id: e.id });
        continue;
      }

      if (since > ROUND_SECONDS * 1000) {
        const r = await ringRound(e);
        if (r.called) out.widened.push({ id: e.id, called: r.called.length });
        else out.skipped++;
      }
    } catch (err) {
      console.error("[errand-tick]", e.id, err?.message);
    }
  }

  return res.status(200).json({ open: open.length, callingHours: withinCallingHours(), ...out });
}

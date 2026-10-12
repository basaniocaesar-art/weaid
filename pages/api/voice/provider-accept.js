/**
 * Where a provider's "yes" lands.
 *
 * The AI agent rings a provider, reads out the job and what they earn, and asks
 * whether they want it and how soon they can be there. If they say yes it POSTs
 * here. The job is awarded by the same atomic guard the dashboard uses, so the
 * first yes wins and everyone else is told it has gone — whether they said yes
 * on the phone, in the app, or both at once.
 *
 * This endpoint hands out paid work, so it is not open: the agent must present
 * DISPATCH_WEBHOOK_SECRET, and without that secret configured it refuses
 * outright rather than defaulting to trusting anybody.
 *
 *   POST { bookingId, providerId, accepted, etaMinutes?, agreedAt? }
 *   header: x-dispatch-secret: <DISPATCH_WEBHOOK_SECRET>
 */
import crypto from "crypto";
import { providerAcceptJob } from "../../../lib/orchestrator.js";

function authorised(req) {
  const want = process.env.DISPATCH_WEBHOOK_SECRET || "";
  // Fails closed. An unset secret means nobody can award a job, which is the
  // safe direction to be wrong in.
  if (want.length < 16) return false;
  const got = String(req.headers["x-dispatch-secret"] || "");
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!authorised(req)) return res.status(401).json({ error: "unauthorised" });

  const { bookingId, providerId, accepted, etaMinutes, agreedAt } = req.body || {};
  if (!bookingId || !providerId) return res.status(400).json({ error: "Missing bookingId or providerId" });

  // A no is worth recording, not just ignoring: it is why the next round goes
  // out, and over time it is how we learn who never takes work.
  if (accepted === false) {
    console.log("[dispatch] declined", bookingId, providerId);
    return res.status(200).json({ ok: true, awarded: false });
  }

  const eta = etaMinutes == null ? null : Math.max(5, Math.min(600, Number(etaMinutes) || 0));
  const when = agreedAt || (eta ? new Date(Date.now() + eta * 60000).toISOString() : null);

  try {
    const booking = await providerAcceptJob(bookingId, providerId, { agreedAt: when, etaMinutes: eta });
    return res.status(200).json({ ok: true, awarded: true, agreedAt: booking.agreed_at });
  } catch (e) {
    if (e.code === "ALREADY_TAKEN") {
      // Not an error as far as the agent is concerned — it just has to tell the
      // person on the phone that somebody else got there first.
      return res.status(409).json({ ok: true, awarded: false, reason: "already_taken" });
    }
    console.error("[dispatch] accept failed", e);
    return res.status(500).json({ error: e.message });
  }
}

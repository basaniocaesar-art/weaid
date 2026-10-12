/**
 * Carpool (hidden until launch) — riders. See lib/carpool.js for the rules.
 *   POST { action: "search", from:{lat,lng}, to:{lat,lng}, date? }
 *   POST { action: "book", rideId, name, phone, seats, pickup }
 *   POST { action: "paid", seatId, k, razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *   GET  ?s=<seatId>&k=<token>                       the rider's booking page
 *   POST { action: "cancel", seatId, k }
 */
import { searchRides, bookSeat, seatView, checkSeatToken, riderCancel, confirmSeat, expireHolds } from "../../../lib/carpool.js";
import { verifySignature } from "../../../lib/razorpay.js";
import { trustCard } from "../../../lib/verify.js";
import { supabase } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    expireHolds().catch(() => {});
    if (req.method === "GET") {
      if (!checkSeatToken(req.query.s, req.query.k)) return res.status(404).json({ error: "not_found" });
      const v = await seatView(req.query.s);
      if (!v) return res.status(404).json({ error: "not_found" });
      if (v.ride?.driver?.providerId) v.ride.driver.trust = await trustCard(v.ride.driver.providerId).catch(() => null);
      return res.status(200).json(v);
    }
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.action === "search") {
      const rides = await searchRides(b);
      for (const r of rides) {
        const t = await trustCard(r.providerId).catch(() => null);
        r.verified = Boolean(t?.idChecked); r.police = Boolean(t?.police); r.photo = t?.photo || null; delete r.providerId;
      }
      return res.status(200).json({ rides });
    }
    if (b.action === "book") return res.status(200).json(await bookSeat(b));
    if (b.action === "paid") {
      if (!checkSeatToken(b.seatId, b.k)) return res.status(404).json({ error: "not_found" });
      const { data: s } = await supabase.from("carpool_seats").select("razorpay_order_id").eq("id", b.seatId).maybeSingle();
      if (!s || s.razorpay_order_id !== b.razorpay_order_id || !verifySignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
        return res.status(400).json({ error: "Payment couldn't be verified." });
      }
      await confirmSeat(b.seatId, { paymentId: b.razorpay_payment_id });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "cancel") {
      if (!checkSeatToken(b.seatId, b.k)) return res.status(404).json({ error: "not_found" });
      return res.status(200).json(await riderCancel(b.seatId));
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

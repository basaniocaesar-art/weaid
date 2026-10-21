/**
 * GET /api/bill?b=<booking id>&k=<token>
 *
 * What the customer's bill page (/bill) shows: the bill number, the items,
 * the total, what is paid and due, and — while unpaid — the UPI QR and the
 * payment link. The bill token (lib/jobs.js jobLinks) or the customer's own
 * tracking token both open it; the pro's token does not, so a job link
 * forwarded on cannot be mistaken for the customer's bill.
 */
import { getBooking } from "../../lib/supabase.js";
import { checkToken, eventsFor } from "../../lib/jobs.js";
import { billView } from "../../lib/bill.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const { b, k } = req.query;
  if (!checkToken("bill", b, k) && !checkToken("cust", b, k)) return res.status(404).json({ error: "not_found" });
  res.setHeader("Cache-Control", "no-store");
  try {
    const booking = await getBooking(b);
    if (!booking) return res.status(404).json({ error: "not_found" });
    const events = await eventsFor(b);
    const bill = billView(booking, events);
    if (!bill) return res.status(404).json({ error: "no_bill", reason: "This job was paid when it was booked, so there is no separate bill." });
    return res.status(200).json(bill);
  } catch (e) {
    console.error("[bill]", e);
    return res.status(500).json({ error: "failed" });
  }
}

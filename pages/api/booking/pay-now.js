/**
 * POST /api/booking/pay-now { bookingId }
 *
 * A pay-after job the customer would rather pay online — the "Pay now instead"
 * button on the home page, or the Pay button on their tracking page. Opens a
 * Razorpay order for what is still due and hands back what checkout.js needs.
 * The payment lands at /api/booking/verify-razorpay (and the webhook as a
 * backstop), where fulfillPaidBooking records it against the job.
 *
 * The booking id is the only credential, as it is for /api/booking/status:
 * knowing it lets you pay somebody's bill, which is not a secret worth keeping.
 */
import { getBooking } from "../../../lib/supabase.js";
import { eventsFor } from "../../../lib/jobs.js";
import { amountDue } from "../../../lib/payafter.js";
import { createOrder, razorpayKeyId, razorpayConfigured } from "../../../lib/razorpay.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const id = String(body.bookingId || "");
  if (!UUID.test(id)) return res.status(400).json({ error: "Not a booking id" });
  try {
    const booking = await getBooking(id).catch(() => null);
    if (!booking) return res.status(404).json({ error: "No such booking" });
    if (booking.payment_mode !== "pay_after") return res.status(400).json({ error: "This booking is paid another way." });
    if (!["pending", "accepted", "completed"].includes(booking.status)) return res.status(409).json({ error: "This booking is closed." });
    const due = amountDue(booking, await eventsFor(id));
    if (due <= 0) return res.status(200).json({ paid: true, amount: 0 });
    if (!razorpayConfigured()) return res.status(503).json({ error: "Online payment isn't available right now — pay the pro by cash or UPI." });
    const order = await createOrder(due, `job_${id}`.slice(0, 40), { booking_id: id, what: "job" });
    return res.status(200).json({
      bookingId: id, amount: due,
      payment: { gateway: "razorpay", orderId: order.id, key: razorpayKeyId, amount: order.amount, currency: order.currency },
    });
  } catch (e) {
    console.error("[booking/pay-now]", e);
    return res.status(500).json({ error: e.message });
  }
}

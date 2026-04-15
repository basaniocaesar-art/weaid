import { updateBooking, getBooking } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bookingId, overrideTotal, overrideCommission, adminNote } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: "Missing bookingId" });
    }

    const booking = await getBooking(bookingId);

    const updates = { admin_override: true, admin_note: adminNote };

    if (overrideTotal != null) {
      updates.total = overrideTotal;
      updates.provider_earnings = overrideTotal - (overrideCommission ?? booking.commission) - booking.platform_fee;
    }
    if (overrideCommission != null) {
      updates.commission = overrideCommission;
      updates.provider_earnings = (updates.total ?? booking.total) - overrideCommission - booking.platform_fee;
    }

    const updated = await updateBooking(bookingId, updates);

    return res.status(200).json({ bookingId: updated.id, updates });
  } catch (err) {
    console.error("[admin/override]", err);
    return res.status(500).json({ error: err.message });
  }
}

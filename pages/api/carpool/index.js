import { insertCarpool, listCarpools, joinCarpool, getCarpool } from "../../../lib/supabase.js";
import { sendMessage } from "../../../lib/whatsapp.js";

// One endpoint: GET lists open carpools; POST create | join.
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const carpools = await listCarpools({ to: req.query.to });
      return res.status(200).json({ carpools });
    }
    if (req.method === "POST") {
      const { action } = req.body;

      if (action === "create") {
        const { driver, from, to, departAt, seats, pricePerSeat, notes } = req.body;
        if (!driver?.name || !driver?.phone || !from?.address || !to?.address) {
          return res.status(400).json({ error: "Missing driver, from or to" });
        }
        const n = Math.max(1, Number(seats) || 3);
        const cp = await insertCarpool({
          driver_name: driver.name, driver_phone: driver.phone,
          from_address: from.address, from_lat: from.lat || null, from_lng: from.lng || null,
          to_address: to.address, to_lat: to.lat || null, to_lng: to.lng || null,
          depart_at: departAt || null, seats_total: n, seats_left: n,
          price_per_seat: Math.max(0, Number(pricePerSeat) || 0), notes: notes || null,
        });
        return res.status(201).json({ id: cp.id });
      }

      if (action === "join") {
        const { carpoolId, rider } = req.body;
        if (!carpoolId || !rider?.name || !rider?.phone) return res.status(400).json({ error: "Missing carpoolId or rider" });
        const cp = await joinCarpool(carpoolId, rider);
        if (!cp) return res.status(409).json({ error: "No seats left" });
        // Notify the driver a rider joined (they coordinate; WeAid fee applied at settlement)
        await sendMessage(cp.driver_phone, `🧑‍🤝‍🧑 ${rider.name} joined your carpool to ${cp.to_address} (${cp.seats_left} seat(s) left). Contact: ${rider.phone}`).catch(() => {});
        return res.status(200).json({ ok: true, seatsLeft: cp.seats_left, driverContact: cp.driver_phone });
      }

      return res.status(400).json({ error: "Unknown action" });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[carpool]", err);
    return res.status(500).json({ error: err.message });
  }
}

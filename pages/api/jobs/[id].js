import { getJobById, getBidsByJob } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Missing job ID" });
    }

    const job = await getJobById(id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const bids = await getBidsByJob(id);

    // Mask provider details for public view
    const maskedBids = bids.map((b) => ({
      id: b.id,
      providerName: b.provider_name.split(" ")[0] + " " + (b.provider_name.split(" ")[1]?.[0] || "") + ".",
      amount: b.amount,
      message: b.message,
      isFixedPrice: b.is_fixed_price,
      status: b.status,
      createdAt: b.created_at,
    }));

    return res.status(200).json({ job, bids: maskedBids });
  } catch (err) {
    console.error("[jobs/detail]", err);
    return res.status(500).json({ error: err.message });
  }
}

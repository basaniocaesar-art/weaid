import { insertBid, getJobById, updateJob } from "../../../lib/supabase.js";
import { sendEmail } from "../../../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { jobId, providerId, providerName, providerPhone, amount, message, isFixedPrice } = req.body;

    if (!jobId || !providerName || !providerPhone || !amount) {
      return res.status(400).json({ error: "Missing required fields: jobId, providerName, providerPhone, amount" });
    }

    const job = await getJobById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "open") return res.status(400).json({ error: "Job is no longer accepting bids" });

    const bid = await insertBid({
      job_id: jobId,
      provider_id: providerId || null,
      provider_name: providerName,
      provider_phone: providerPhone,
      amount,
      message: message || null,
      is_fixed_price: isFixedPrice || false,
      status: "pending",
    });

    // Increment bid count
    await updateJob(jobId, { bid_count: job.bid_count + 1 });

    return res.status(201).json({ bidId: bid.id, status: "pending" });
  } catch (err) {
    console.error("[jobs/bid]", err);
    return res.status(500).json({ error: err.message });
  }
}

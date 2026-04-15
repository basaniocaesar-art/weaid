import { getJobById, updateJob, updateBid, rejectOtherBids } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { jobId, bidId } = req.body;

    if (!jobId || !bidId) {
      return res.status(400).json({ error: "Missing jobId or bidId" });
    }

    const job = await getJobById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "open") return res.status(400).json({ error: "Job is no longer open" });

    // Accept the winning bid
    const acceptedBid = await updateBid(bidId, { status: "accepted" });

    // Reject all other pending bids
    await rejectOtherBids(jobId, bidId);

    // Update job status
    await updateJob(jobId, { status: "in_progress", accepted_bid_id: bidId });

    return res.status(200).json({
      jobId,
      acceptedBid: {
        id: acceptedBid.id,
        providerName: acceptedBid.provider_name,
        amount: acceptedBid.amount,
      },
      status: "in_progress",
    });
  } catch (err) {
    console.error("[jobs/accept-bid]", err);
    return res.status(500).json({ error: err.message });
  }
}

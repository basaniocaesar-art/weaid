import { getJobs } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { category, city, status = "open", page = 1, limit = 20 } = req.query;

    const result = await getJobs({
      category: category || null,
      city: city || null,
      status,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return res.status(200).json({
      jobs: result.jobs,
      total: result.total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error("[jobs/list]", err);
    return res.status(500).json({ error: err.message });
  }
}

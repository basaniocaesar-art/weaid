/** Nightly: close listed jobs whose original posting is gone; keep live ones up (lib/job-feed.js). */
import { clean } from "../../../lib/job-feed.js";
export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "Unauthorized" });
  return res.status(200).json(await clean());
}

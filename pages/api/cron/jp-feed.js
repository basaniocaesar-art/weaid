/** Daily: new Kochi jobs from Adzuna and Jooble onto the WeAid Jobs boards (lib/job-feed.js). */
import { feed } from "../../../lib/job-feed.js";
export const config = { maxDuration: 300 };
export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: "Unauthorized" });
  const part = req.query.part != null ? Number(req.query.part) % 3 : undefined;
  return res.status(200).json(await feed(part != null ? { part } : {}));
}

/**
 * The owner's call list (header X-Ops-Key = OPS_KEY). See lib/leads.js.
 *
 *   GET  /api/leads                                  every lead + what happened on the call
 *   POST /api/leads { action: "import", rows }       add a sweep's CSV rows (parsed in the browser)
 *   POST /api/leads { action: "status", phone, status, note }
 */
import { checkOpsKey } from "../../lib/jobs.js";
import { listLeads, importLeads, setLeadStatus } from "../../lib/leads.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

export default async function handler(req, res) {
  if (!checkOpsKey(req)) return res.status(401).json({ error: "unauthorized" });
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") return res.status(200).json(await listLeads());
    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.action === "import") return res.status(200).json(await importLeads(body.rows));
    if (body.action === "status") return res.status(200).json({ ok: true, status: await setLeadStatus(body.phone, body.status, body.note) });
    return res.status(400).json({ error: "action?" });
  } catch (e) {
    console.error("[leads]", e.message);
    return res.status(500).json({ error: e.message });
  }
}

/**
 * WeAid Jobs API. Tokens: X-Cand-Token (candidate), X-Emp-Token (employer).
 *   GET  jobs?q&role&area                public job search
 *   GET  job?slug                        one job
 *   POST cand_save {profile}             create/update candidate → token
 *   GET  cand_me                         my profile + applications
 *   POST cand_file {kind, mime, data}    photo | cv | voice
 *   POST apply {jobId}
 *   POST choose_slot {appId, slot}
 *   POST emp_save {business}             create/update employer → token
 *   GET  emp_me                          jobs + applicants
 *   POST post_job {job} | job_status {jobId, status} | boost {jobId}
 *   POST slots {appId, slots[]} | app_status {appId, status}
 *   POST search {role, area, q} | unlock {candidateId}
 *   GET  meta                            roles + plans
 */
import { supabase } from "../../../lib/supabase.js";
import * as J from "../../../lib/jobportal.js";

export const config = { api: { bodyParser: { sizeLimit: "4.5mb" } } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Cand-Token, X-Emp-Token");
  if (req.method === "OPTIONS") return res.status(204).end();
  const a = req.query.action;
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  try {
    if (a === "meta") return res.status(200).json({ roles: J.ROLES, plans: J.PLANS });
    if (a === "jobs") return res.status(200).json({ jobs: await J.liveJobs({ q: String(req.query.q || "").slice(0, 60), role: req.query.role, area: req.query.area }) });
    if (a === "job") {
      const { data } = await supabase.from("jp_jobs").select("*, jp_employers!inner(business_name, kind)").eq("slug", String(req.query.slug || "")).maybeSingle();
      if (!data || !["live", "closed"].includes(data.status)) return res.status(404).json({ error: "not found" });
      return res.status(200).json({ job: J.publicJob(data), open: data.status === "live" });
    }

    // ---- candidates ----
    const cand = await J.candidateByToken(req.headers["x-cand-token"]);
    if (a === "cand_save") { const c = await J.saveCandidate(cand, b.profile || {}); return res.status(200).json({ token: c.token, candidate: await J.candidateCard(c, { showContact: true }) }); }
    if (["cand_me", "cand_file", "apply", "choose_slot"].includes(a)) {
      if (!cand) return res.status(401).json({ error: "Create your profile first." });
      if (a === "cand_me") {
        const { data: apps } = await supabase.from("jp_applications").select("*, jp_jobs!inner(title, area, slug, status, salary_min, salary_max, jp_employers!inner(business_name))").eq("candidate_id", cand.id).order("created_at", { ascending: false });
        return res.status(200).json({ candidate: await J.candidateCard(cand, { showContact: true }), raw: { ...cand, token: undefined }, applications: (apps || []).map((x) => ({ id: x.id, status: x.status, slots: x.slots, chosen: x.slot_chosen, job: { title: x.jp_jobs.title, area: x.jp_jobs.area, slug: x.jp_jobs.slug, employer: x.jp_jobs.jp_employers.business_name } })) });
      }
      if (a === "cand_file") return res.status(200).json({ path: await J.saveFile(cand.id, b.kind, b.mime, b.data) });
      if (a === "apply") return res.status(200).json(await J.apply(cand, b.jobId));
      if (a === "choose_slot") return res.status(200).json(await J.chooseSlot(cand, b.appId, b.slot));
    }

    // ---- employers ----
    const emp = await J.employerByToken(req.headers["x-emp-token"]);
    if (a === "emp_save") { const e = await J.saveEmployer(emp, b.business || {}); return res.status(200).json({ token: e.token }); }
    if (!emp) return res.status(401).json({ error: "Please open your employer link again." });
    if (a === "emp_me") {
      const { data: jobs } = await supabase.from("jp_jobs").select("*").eq("employer_id", emp.id).order("created_at", { ascending: false }).limit(30);
      const ids = (jobs || []).map((j) => j.id);
      const { data: apps } = ids.length ? await supabase.from("jp_applications").select("*, jp_candidates!inner(*)").in("job_id", ids).order("created_at", { ascending: false }) : { data: [] };
      const open = await J.contactRule(emp);
      const applicants = await Promise.all((apps || []).map(async (x) => ({ id: x.id, jobId: x.job_id, status: x.status, slots: x.slots, chosen: x.slot_chosen, at: x.created_at, locked: !open(x), candidate: await J.candidateCard(x.jp_candidates, { showContact: open(x) }) })));
      return res.status(200).json({
        employer: { name: emp.business_name, contact: emp.contact_name, phone: emp.phone, email: emp.email, area: emp.area, kind: emp.kind, plan: J.planActive(emp) ? { key: emp.plan, ...J.PLANS[emp.plan], until: emp.plan_until, unlocksLeft: emp.unlocks_left, boostsLeft: emp.boosts_left } : null },
        jobs: (jobs || []).map((j) => ({ ...J.publicJob(j), status: j.status, screen: j.screen?.verdict === "reject" ? j.screen.reason : null, applicants: applicants.filter((x) => x.jobId === j.id).length })),
        applicants, plans: J.PLANS,
      });
    }
    if (a === "post_job") return res.status(200).json({ job: await J.postJob(emp, b.job || {}) });
    if (a === "job_status") {
      const st = ["paused", "closed", "live"].includes(b.status) ? b.status : null;
      const { data: j } = await supabase.from("jp_jobs").select("status").eq("id", b.jobId).eq("employer_id", emp.id).maybeSingle();
      if (!j || !st || ["review", "rejected"].includes(j.status) || (st === "live" && j.status === "closed")) return res.status(400).json({ error: "Can't change this job." });
      await supabase.from("jp_jobs").update({ status: st }).eq("id", b.jobId); return res.status(200).json({ ok: true });
    }
    if (a === "boost") {
      if (!J.planActive(emp) || (emp.boosts_left || 0) <= 0) return res.status(400).json({ error: "No boosts left on your plan." });
      await supabase.from("jp_employers").update({ boosts_left: emp.boosts_left - 1 }).eq("id", emp.id);
      await supabase.from("jp_jobs").update({ boosted_until: new Date(Date.now() + 3 * 86400e3).toISOString() }).eq("id", b.jobId).eq("employer_id", emp.id);
      return res.status(200).json({ ok: true });
    }
    if (a === "slots") return res.status(200).json(await J.setSlots(emp, b.appId, b.slots));
    if (a === "app_status") {
      const st = ["shortlisted", "hired", "rejected"].includes(b.status) ? b.status : null;
      const { data: x } = await supabase.from("jp_applications").select("id, jp_jobs!inner(employer_id)").eq("id", b.appId).maybeSingle();
      if (!x || x.jp_jobs.employer_id !== emp.id || !st) return res.status(400).json({ error: "Can't update." });
      await supabase.from("jp_applications").update({ status: st, updated_at: new Date().toISOString() }).eq("id", b.appId); return res.status(200).json({ ok: true });
    }
    if (a === "search") return res.status(200).json({ candidates: await J.searchCandidates(emp, b) });
    if (a === "unlock") return res.status(200).json({ candidate: await J.unlock(emp, b.candidateId) });
    return res.status(404).json({ error: "unknown" });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}

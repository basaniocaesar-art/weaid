/**
 * Every 10 minutes: applicants to jobs WeAid listed from public postings
 * (lib/jp-listed.js). Finds the employer's email once, forwards each applicant
 * once, and two days after the first forward sends the "your account is ready"
 * email once. The owner gets a copy of what happened, or a "call them" when no
 * email could be found.
 */
import { supabase } from "../../../lib/supabase.js";
import { sendEmail, sendAdminNotification } from "../../../lib/email.js";
import { candidateCard, contactRule, isTopMatch } from "../../../lib/jobportal.js";
import { findContact, listedApplicantEmail, inviteEmail, sentEmail } from "../../../lib/jp-listed.js";

export const config = { maxDuration: 300 };
const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const D = 86400e3;

/** Merge into the job's screen without losing what jp-clean wrote meanwhile. */
async function patchScreen(jobId, patch) {
  const { data } = await supabase.from("jp_jobs").select("screen").eq("id", jobId).single();
  const screen = { ...(data?.screen || {}), ...patch };
  await supabase.from("jp_jobs").update({ screen }).eq("id", jobId);
  return screen;
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { data: apps } = await supabase.from("jp_applications")
    .select("id, candidate_id, created_at, jp_candidates!inner(*), jp_jobs!inner(id, title, area, screen, jp_employers!inner(*))")
    .eq("jp_jobs.screen->>seeded", "true").gte("created_at", new Date(Date.now() - 14 * D).toISOString())
    .order("created_at", { ascending: true }).limit(500);

  const byJob = new Map();
  for (const a of apps || []) {
    const j = a.jp_jobs;
    if (j.jp_employers.removed_at) continue;
    if (!byJob.has(j.id)) byJob.set(j.id, { job: j, emp: j.jp_employers, apps: [] });
    byJob.get(j.id).apps.push(a);
  }

  let looked = 0, forwarded = 0, invited = 0;
  const lookedUp = new Map(); // employer id → email, so one run doesn't search twice
  for (const { job, emp, apps: list } of byJob.values()) {
    let screen = job.screen || {};
    const fresh = list.filter((a) => !(screen.forwarded || []).includes(a.id));
    const dash = `${SITE()}/employer#t=${emp.token}`;

    // 1. Their email, looked up once per employer.
    let email = emp.email || lookedUp.get(emp.id) || null;
    if (!email && fresh.length && !screen.contact && !lookedUp.has(emp.id) && looked < 3) {
      looked++;
      const c = await findContact(emp, job).catch((e) => ({ email: null, note: `lookup failed: ${e.message.slice(0, 80)}` }));
      lookedUp.set(emp.id, c.email);
      screen = await patchScreen(job.id, { contact: { ...c, checked_at: new Date().toISOString() } });
      if (c.email) { email = c.email; await supabase.from("jp_employers").update({ email }).eq("id", emp.id); }
      else {
        await sendAdminNotification(`[WeAid Jobs] No email found for ${emp.business_name} — call them`,
          `<p style="font-family:sans-serif">${fresh.map((a) => `<b>${esc(a.jp_candidates.name)}</b> (${esc(a.jp_candidates.phone)})`).join(", ")} applied for <b>${esc(job.title)}</b> at ${esc(emp.business_name)}.<br>Automatic lookup: ${esc(c.note || "nothing found")}${c.phone ? `<br>Phone found: ${esc(c.phone)}` : ""}<br>Original posting: ${esc(screen.source_url || "")}<br><br>Add their email in Ops (jp_employers.email) and the applicants go out within 10 minutes.</p>`).catch(() => {});
      }
    }
    if (!email) continue;

    // 2. Forward the applicants not yet sent.
    if (fresh.length) {
      const open = await contactRule(emp);
      const items = await Promise.all(fresh.map(async (a) => ({ open: open(a), phone: a.jp_candidates.phone, top: isTopMatch(a.jp_candidates), card: await candidateCard(a.jp_candidates, { showContact: open(a) }) })));
      const m = listedApplicantEmail({ emp, job, items, dash });
      try { await sendEmail(email, m.subject, m.html); } catch { continue; }
      forwarded += fresh.length;
      screen = await patchScreen(job.id, { forwarded: [...(screen.forwarded || []), ...fresh.map((a) => a.id)], first_forwarded_at: screen.first_forwarded_at || new Date().toISOString() });
      for (const a of fresh) {
        if (a.jp_candidates.email) { const s = sentEmail({ cand: a.jp_candidates, job, emp }); await sendEmail(a.jp_candidates.email, s.subject, s.html).catch(() => {}); }
      }
      await sendAdminNotification(`[WeAid Jobs] Sent ${fresh.length} applicant${fresh.length > 1 ? "s" : ""} to ${emp.business_name}`,
        `<p style="font-family:sans-serif">${fresh.map((a) => esc(a.jp_candidates.name)).join(", ")} → <b>${esc(email)}</b> for ${esc(job.title)}.${screen.contact?.source ? `<br>Email found on: ${esc(screen.contact.source)}` : ""}<br>The "your account is ready" email follows in 2 days.</p>`).catch(() => {});
    }

    // 3. Two days after the first forward, invite them once.
    if (screen.first_forwarded_at && !screen.invited_at && Date.now() - Date.parse(screen.first_forwarded_at) >= 2 * D) {
      const m = inviteEmail({ emp, job, count: list.length, dash });
      await sendEmail(email, m.subject, m.html).then(async () => { invited++; await patchScreen(job.id, { invited_at: new Date().toISOString() }); }).catch(() => {});
    }
  }
  return res.status(200).json({ jobs: byJob.size, looked, forwarded, invited });
}

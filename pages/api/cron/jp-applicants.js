/**
 * Daily applicant emails to employers (10:00 IST).
 *
 *  • Yesterday's applicants, all jobs in one email — only when two or more came
 *    in, since each one already had its own email.
 *  • Applicants from two days ago (48–72 h) the employer hasn't answered — still
 *    "applied", no interview times offered. The window is a day wide and this
 *    runs once a day, so each applicant is chased once.
 *
 * Listed-from-public-posting employers (phone "seed:…") never signed up, so
 * they are not mailed.
 */
import { supabase } from "../../../lib/supabase.js";
import { sendEmail } from "../../../lib/email.js";
import { candidateCard, contactRule, isTopMatch, planActive, FREE_APPLICANTS } from "../../../lib/jobportal.js";
import { PLANS } from "../../../lib/jobs-config.js";
import { digestEmail, waitingEmail } from "../../../lib/jp-emails.js";

const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";
const H = 3600e3;

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const now = Date.now();
  const { data: apps } = await supabase.from("jp_applications")
    .select("id, candidate_id, status, slots, created_at, jp_candidates!inner(*), jp_jobs!inner(id, title, area, jp_employers!inner(*))")
    .gte("created_at", new Date(now - 72 * H).toISOString()).order("created_at", { ascending: true }).limit(2000);

  const byEmp = new Map();
  for (const a of apps || []) {
    const e = a.jp_jobs.jp_employers;
    if (!e.email || e.removed_at || String(e.phone || "").startsWith("seed:")) continue;
    const age = now - Date.parse(a.created_at);
    const kind = age < 24 * H ? "fresh" : age >= 48 * H && a.status === "applied" && !(a.slots || []).length ? "waiting" : null;
    if (!kind) continue;
    if (!byEmp.has(e.id)) byEmp.set(e.id, { emp: e, fresh: [], waiting: [] });
    byEmp.get(e.id)[kind].push(a);
  }

  let digests = 0, reminders = 0;
  for (const { emp, fresh, waiting } of byEmp.values()) {
    const open = await contactRule(emp);
    const locked = !planActive(emp);
    const item = async (a) => ({
      job: a.jp_jobs, open: open(a), phone: a.jp_candidates.phone, top: isTopMatch(a.jp_candidates),
      dash: `${SITE()}/employer#t=${emp.token}&a=${a.id}`, card: await candidateCard(a.jp_candidates, { showContact: open(a) }),
    });
    const ctx = { dash: `${SITE()}/employer#t=${emp.token}`, plans: PLANS, free: FREE_APPLICANTS, locked };
    if (fresh.length >= 2) {
      const m = digestEmail({ ...ctx, items: await Promise.all(fresh.map(item)) });
      await sendEmail(emp.email, m.subject, m.html).then(() => digests++).catch(() => {});
    }
    if (waiting.length) {
      const m = waitingEmail({ ...ctx, items: await Promise.all(waiting.map(item)) });
      await sendEmail(emp.email, m.subject, m.html).then(() => reminders++).catch(() => {});
    }
  }
  return res.status(200).json({ employers: byEmp.size, digests, reminders });
}

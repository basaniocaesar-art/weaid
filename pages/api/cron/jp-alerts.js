/**
 * Daily WeAid Jobs alerts (9:30 IST).
 *
 *  • The owner: who joined in the last 24 hours, by kind of work.
 *  • Each employer with an email: new people for the kinds of work they have
 *    posted — first name and initial, experience, area, expected pay; the
 *    number stays behind Unlock. One email a day at most, and only when there
 *    is someone new.
 */
import { supabase } from "../../../lib/supabase.js";
import { sendAdminNotification, sendEmail } from "../../../lib/email.js";
import { shortName } from "../../../lib/jobportal.js";

const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (n) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");
const line = (c) => `<b>${esc(shortName(c.name))}</b> — ${esc(c.role)}${c.experience_years != null ? `, ${c.experience_years} yr` : ""}${c.area ? `, ${esc(c.area)}` : ""}${c.expected_salary ? `, expects ${inr(c.expected_salary)}` : ""}`;

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data: fresh } = await supabase.from("jp_candidates").select("id,name,role,roles,experience_years,area,expected_salary,verified")
    .is("removed_at", null).eq("open_to_work", true).gte("created_at", since).order("created_at", { ascending: false }).limit(300);
  const people = fresh || [];
  if (!people.length) return res.status(200).json({ joined: 0, employersEmailed: 0 });

  // The owner's digest.
  const byRole = {};
  people.forEach((c) => { (byRole[c.role] ||= []).push(c); });
  const summary = Object.entries(byRole).sort((a, b) => b[1].length - a[1].length).map(([r, l]) => `${l.length} ${r.toLowerCase()}`).join(", ");
  await sendAdminNotification(`[WeAid Jobs] ${people.length} new ${people.length === 1 ? "person" : "people"} joined: ${summary}`,
    `<div style="font-family:sans-serif"><p>${people.length} joined WeAid Jobs in the last 24 hours.</p>${Object.entries(byRole).map(([r, l]) => `<h3 style="margin:14px 0 4px">${esc(r)} (${l.length})</h3>${l.map((c) => `<div>${line(c)}</div>`).join("")}`).join("")}</div>`).catch(() => {});

  // Employers: by the roles they have posted. Listed-from-public-posting employers
  // (phone "seed:…") never signed up, so they are not mailed.
  const { data: jobs } = await supabase.from("jp_jobs").select("role, jp_employers!inner(id,email,business_name,token,phone,removed_at)").not("role", "is", null).limit(2000);
  const emps = new Map();
  (jobs || []).forEach((j) => {
    const e = j.jp_employers;
    if (!e?.email || e.removed_at || String(e.phone || "").startsWith("seed:")) return;
    if (!emps.has(e.id)) emps.set(e.id, { e, roles: new Set() });
    emps.get(e.id).roles.add(j.role);
  });
  let mailed = 0;
  for (const { e, roles } of emps.values()) {
    const match = people.filter((c) => roles.has(c.role) || (c.roles || []).some((r) => roles.has(r))).slice(0, 15);
    if (!match.length) continue;
    const role = [...roles][0];
    const link = `${SITE()}/employer?tab=search&role=${encodeURIComponent(role)}#t=${e.token}`;
    await sendEmail(e.email, `${match.length} new ${match.length === 1 ? "person" : "people"} for ${[...roles].slice(0, 2).join(" / ")} on WeAid Jobs`,
      `<div style="font-family:sans-serif;max-width:560px"><p>New on WeAid Jobs since yesterday:</p>${match.map((c) => `<div style="padding:6px 0;border-bottom:1px solid #eee">${line(c)}${c.verified ? ' <span style="color:#0f766e">✓ ID checked</span>' : ""}</div>`).join("")}
      <p><a href="${link}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Unlock and call</a></p>
      <p style="color:#5b6573;font-size:13px">Numbers open on a WeAid Jobs plan (from ₹1,499 a month, 100 unlocks).</p></div>`).catch(() => {});
    mailed++;
  }
  return res.status(200).json({ joined: people.length, employersEmailed: mailed });
}

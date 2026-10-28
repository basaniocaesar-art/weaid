/**
 * Keeping the WeAid Jobs boards full without anyone copying jobs in by hand
 * (owner's call, 28 Oct 2026).
 *
 *   feed()   Each morning, ask Adzuna and Jooble — job search services with
 *            free official APIs — for Kochi openings in a third of the job
 *            types (so every type is refreshed every three days). New ones
 *            that pass the same rules the hand-picked lists did (a named
 *            employer, a monthly salary, Ernakulam district, no agencies, no
 *            Gulf recruitment) and the same AI scam check employers' posts get
 *            are listed with a link back to the original.
 *   clean()  Each night, look at the original posting of every listed job.
 *            Gone → close ours. Still there and about to expire → keep it up
 *            another two weeks. Can't tell → leave it alone.
 *
 * Listed jobs are marked screen.seeded, exactly like the hand-picked ones, so
 * the job page says where it came from and the owner hears about applicants.
 */
import { supabase } from "./supabase.js";
import { screenJob, slugify } from "./jobportal.js";
import { ROLES } from "./jobs-config.js";

/** What to search for, per job type. */
const SEARCH = {
  "Driver": ["driver"], "Delivery boy": ["delivery boy", "delivery executive"], "Cook": ["cook"], "Housemaid": ["housemaid", "house maid"],
  "Babysitter / nanny": ["nanny", "babysitter"], "Home nurse": ["home nurse", "home care nurse"], "Caregiver": ["caregiver", "patient care assistant"],
  "Security guard": ["security guard"], "Office assistant": ["office assistant"], "Receptionist": ["receptionist", "front office"],
  "Sales executive": ["sales executive"], "Telecaller": ["telecaller"], "Shop staff": ["sales staff", "store staff"], "Cashier": ["cashier"],
  "Accountant": ["accountant"], "Fitness trainer": ["fitness trainer", "gym trainer"], "Beautician": ["beautician"], "Hotel / restaurant staff": ["hotel staff", "barista"],
  "Waiter": ["waiter", "steward"], "Chef": ["chef", "commis"], "Kitchen helper": ["kitchen helper"], "Housekeeping": ["housekeeping"],
  "Electrician": ["electrician"], "Plumber": ["plumber"], "AC technician": ["ac technician", "hvac technician"], "Mechanic": ["mechanic", "automobile technician"],
  "Welder": ["welder", "fabricator"], "Carpenter": ["carpenter"], "Painter": ["painter"], "Mason": ["mason"], "Helper / labour": ["helper"],
  "Teacher / tutor": ["teacher", "tutor"], "Data entry": ["data entry"], "Field executive": ["field executive"], "Warehouse / packing": ["warehouse", "packing"],
  "Tailor": ["tailor"], "Software developer": ["software developer", "php developer", "flutter developer"], "IT support": ["it support", "system administrator"],
  "Data analyst": ["data analyst", "mis executive"], "UI/UX designer": ["ui ux designer"], "QA / tester": ["software tester", "qa engineer"],
  "Digital marketing": ["digital marketing", "social media"], "Marketing executive": ["marketing executive"], "Content writer": ["content writer"],
  "Graphic designer": ["graphic designer"], "Video editor": ["video editor"], "Staff nurse": ["staff nurse"], "Pharmacist": ["pharmacist"],
  "Lab technician": ["lab technician"], "Engineer": ["site engineer", "civil engineer", "mechanical engineer"], "Customer support": ["customer support", "customer service"],
  "HR / recruiter": ["hr executive"], "Barber / hair stylist": ["hair stylist", "barber"], "Gardener": ["gardener"], "Hospital attendant": ["hospital attendant"],
  "Cleaner / office boy": ["office boy", "cleaner"], "Photographer / videographer": ["photographer", "videographer"], "Event staff / promoter": ["event staff", "promoter"],
};

// Ernakulam district — anything else (Thrissur, Bengaluru, Dubai…) is not ours.
const PLACES = ["kochi", "cochin", "ernakulam", "kakkanad", "infopark", "smartcity", "edappally", "edapally", "kaloor", "vyttila", "vytilla", "palarivattom", "aluva", "alwaye",
  "kalamassery", "tripunithura", "thrippunithura", "angamaly", "angamali", "fort kochi", "mattancherry", "perumbavoor", "muvattupuzha", "kolenchery", "kadavanthra",
  "panampilly", "marine drive", "mg road", "thrikkakara", "maradu", "nettoor", "vypin", "willingdon", "nedumbassery", "kalady", "piravom", "piravam", "kothamangalam",
  "north paravur", "paravur", "varapuzha", "eloor", "eroor", "thoppumpady", "palluruthy", "chottanikkara", "vennala", "elamakkara", "cheranalloor", "kizhakkambalam"];
const AGENCY = /\b(consultan|placement|manpower|staffing|recruit|hr solutions|hr services|outsourc|overseas|abroad|gulf|dubai|uae|saudi|qatar|oman|kuwait|bahrain|visa|immigration)\b/i;
const BAD = /\b(registration fee|training fee|security deposit|deposit|investment|mlm|network marketing|work from home|wfh|remote|commission only|part[- ]time earn)\b/i;

const tidy = (s, n) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const placeOf = (loc) => { const l = String(loc || "").toLowerCase(); const hit = PLACES.find((p) => l.includes(p)); return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : null; };
/** Monthly rupees from whatever the service gave (yearly figures, "₹15,000 - ₹20,000 per month", "2 - 3 LPA"…). */
function monthly(min, max, text) {
  let a = Number(min) || 0, b = Number(max) || 0;
  if (!a && !b && text) {
    const t = String(text).toLowerCase().replace(/,/g, "");
    const lpa = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/);
    if (lpa) { a = lpa[1] * 1e5; b = lpa[2] * 1e5; }
    else { const n = (t.match(/\d{4,7}/g) || []).map(Number); [a, b] = [n[0] || 0, n[1] || n[0] || 0]; }
    if (/year|annum|p\.a|lpa|lakh/.test(t)) { a /= 12; b /= 12; }
  } else if (Math.max(a, b) > 150000) { a /= 12; b /= 12; } // yearly
  a = Math.round(a / 100) * 100; b = Math.round(b / 100) * 100;
  if (!a && b) a = b;
  if (!a || a < 5000 || a > 300000) return null;
  return [a, Math.max(a, b)];
}

async function adzuna(what) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return [];
  const u = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${id}&app_key=${key}&results_per_page=30&what=${encodeURIComponent(what)}&where=kochi&max_days_old=21&content-type=application/json`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r?.ok) return [];
  const d = await r.json().catch(() => ({}));
  return (d.results || []).map((j) => ({ source: "adzuna", sourceId: `adzuna:${j.id}`, title: j.title, employer: j.company?.display_name, location: j.location?.display_name,
    salary: monthly(j.salary_min, j.salary_max), description: j.description, url: j.redirect_url, type: j.contract_time }));
}
async function jooble(what) {
  const key = process.env.JOOBLE_KEY;
  if (!key) return [];
  const r = await fetch(`https://jooble.org/api/${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords: what, location: "Kochi, Kerala" }), signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r?.ok) return [];
  const d = await r.json().catch(() => ({}));
  return (d.jobs || []).slice(0, 30).map((j) => ({ source: "jooble", sourceId: `jooble:${j.id}`, title: j.title, employer: j.company, location: j.location,
    salary: monthly(0, 0, j.salary), description: j.snippet, url: j.link, type: j.type }));
}

export const feedConfigured = () => Boolean((process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY) || process.env.JOOBLE_KEY);

/** One morning's run over a third of the job types. */
export async function feed({ part = new Date().getUTCDate() % 3, maxNew = 40, perBoard = 40 } = {}) {
  if (!feedConfigured()) return { skipped: "no feed keys" };
  const roles = ROLES.filter((r, i) => SEARCH[r] && i % 3 === part);
  // What's already listed, so nothing goes up twice.
  const { data: have } = await supabase.from("jp_jobs").select("role,title,screen,status,jp_employers!inner(business_name)").in("status", ["live", "review", "closed", "rejected"]).limit(5000);
  const seenIds = new Set((have || []).map((j) => j.screen?.source_id).filter(Boolean));
  const seenKey = new Set((have || []).map((j) => `${slugify(j.title)}|${slugify(j.jp_employers?.business_name)}`));
  const liveByRole = {};
  (have || []).forEach((j) => { if (j.status === "live") liveByRole[j.role] = (liveByRole[j.role] || 0) + 1; });

  const found = [];
  for (const role of roles) {
    if ((liveByRole[role] || 0) >= perBoard) continue;
    for (const q of SEARCH[role]) {
      const list = [...(await adzuna(q)), ...(await jooble(q))];
      list.forEach((j) => found.push({ ...j, role }));
    }
  }

  let added = 0, skipped = 0;
  const reasons = {};
  const skip = (why) => { skipped++; reasons[why] = (reasons[why] || 0) + 1; };
  for (const j of found) {
    if (added >= maxNew) break;
    const employer = tidy(j.employer, 100), title = tidy(j.title, 80), area = placeOf(j.location) || placeOf(j.description);
    const key = `${slugify(title)}|${slugify(employer)}`;
    if (seenIds.has(j.sourceId) || seenKey.has(key)) { skip("already listed"); continue; }
    seenIds.add(j.sourceId); seenKey.add(key);
    if (!employer || !title || !j.url) { skip("no employer"); continue; }
    if (!area) { skip("not in Ernakulam"); continue; }
    if (!j.salary) { skip("no monthly salary"); continue; }
    if (AGENCY.test(`${employer} ${title} ${j.description}`)) { skip("agency or abroad"); continue; }
    if (BAD.test(`${title} ${j.description}`)) { skip("fee/remote/commission"); continue; }

    const job = { title, role: j.role, area, salary_min: j.salary[0], salary_max: j.salary[1], job_type: /part/i.test(j.type || "") ? "part_time" : /contract|temp/i.test(j.type || "") ? "contract" : "full_time",
      description: `${employer} is hiring: ${title} in ${area}. ${tidy(j.description, 400)}${/[.!?]$/.test(tidy(j.description, 400)) ? "" : "…"} Apply on WeAid and we pass your profile to the employer, or use the link to the original posting. WeAid never charges job seekers.` };
    const screen = await screenJob(job);
    if (screen.verdict !== "ok") { skip(`scam check: ${screen.verdict}`); continue; }

    const phone = `seed:${slugify(employer)}`;
    let { data: emp } = await supabase.from("jp_employers").select("id").eq("phone", phone).maybeSingle();
    if (!emp) ({ data: emp } = await supabase.from("jp_employers").insert({ business_name: employer, phone, area, kind: "business", approved: true }).select("id").single());
    if (!emp) { skip("employer not saved"); continue; }
    const { data: row, error } = await supabase.from("jp_jobs").insert({ ...job, employer_id: emp.id, status: "live", expires_at: new Date(Date.now() + 30 * 86400e3).toISOString(),
      screen: { ...screen, seeded: true, source_url: j.url, source_id: j.sourceId, source: j.source } }).select("id").single();
    if (error) { skip("not saved"); continue; }
    await supabase.from("jp_jobs").update({ slug: `${slugify(title)}-${slugify(area)}-${row.id.slice(0, 6)}` }).eq("id", row.id);
    added++;
  }
  return { part, roles: roles.length, found: found.length, added, skipped, reasons };
}

/** Is the original posting still up? true / false / null (couldn't tell). */
async function stillUp(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12000), headers: { "User-Agent": "WeAid-JobCheck/1.0 (+https://weaid.in)" } });
    if (r.status === 404 || r.status === 410) return false;
    if (!r.ok) return null; // 403/429/5xx: the site said nothing about the job
    const t = (await r.text()).slice(0, 400000).toLowerCase();
    if (/"expired"\s*:\s*true|this job has expired|job (is )?no longer available|position has been filled|no longer accepting applications|job not found|this job is closed/.test(t)) return false;
    return true;
  } catch { return null; }
}

/** One night's check of listed jobs, oldest-checked first. */
export async function clean({ limit = 60 } = {}) {
  const { data } = await supabase.from("jp_jobs").select("id,expires_at,screen").eq("status", "live").not("screen->>source_url", "is", null)
    .order("screen->>checked_at", { ascending: true, nullsFirst: true }).limit(limit);
  let closed = 0, extended = 0, unknown = 0, ok = 0;
  for (const j of data || []) {
    const up = await stillUp(j.screen.source_url);
    const screen = { ...j.screen, checked_at: new Date().toISOString() };
    const patch = { screen };
    if (up === false) { patch.status = "closed"; screen.closed_reason = "original posting gone"; closed++; }
    else if (up === true) { ok++; if (Date.parse(j.expires_at) - Date.now() < 3 * 86400e3) { patch.expires_at = new Date(Date.now() + 14 * 86400e3).toISOString(); extended++; } }
    else unknown++;
    await supabase.from("jp_jobs").update(patch).eq("id", j.id);
    await new Promise((r) => setTimeout(r, 1500)); // be gentle with the job sites
  }
  return { checked: (data || []).length, ok, closed, extended, unknown };
}

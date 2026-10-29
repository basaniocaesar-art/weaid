/**
 * WeAid Jobs — a local job portal on the WorkIndia model (owner's call, 9 Oct 2026).
 *
 *   Candidates  free. Profile, CV (PDF/photo), optional voice intro, apply.
 *               Their phone is hidden from employers until unlocked — except
 *               the employers of jobs they apply to, once on a plan.
 *   Employers   post jobs, get applications by email (CV + interview slots),
 *               search candidates and unlock contacts on a paid plan. Without
 *               a plan only their first FREE_APPLICANTS applicants show contacts.
 *   Screening   every job is read by Claude for scam signs (fees from
 *               candidates, MLM, unrealistic pay). A new employer's first post
 *               waits for the owner's approval; flagged posts always do.
 *
 * Login without SMS (DLT pending): a private token, kept on the device and
 * re-sent by email (employers) — candidate OTP comes with DLT.
 */
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase.js";
import { sendAdminNotification, sendEmail } from "./email.js";
import { opsLink } from "./followup.js";
import { PLANS, ROLES, slugify, publicJob } from "./jobs-config.js";
export { PLANS, ROLES, slugify, publicJob };

const BUCKET = "jp-files";
const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";
const client = new Anthropic();

const ten = (p) => { const d = String(p || "").replace(/\D/g, ""); const t = d.length > 10 ? d.slice(-10) : d; return /^[6-9]\d{9}$/.test(t) ? t : ""; };
const clean = (s, n = 200) => String(s ?? "").trim().slice(0, n);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- auth ---------------- */
export async function candidateByToken(t) {
  if (!/^[0-9a-f-]{36}$/i.test(String(t || ""))) return null;
  const { data } = await supabase.from("jp_candidates").select("*").eq("token", t).is("removed_at", null).maybeSingle();
  return data;
}
export async function employerByToken(t) {
  if (!/^[0-9a-f-]{36}$/i.test(String(t || ""))) return null;
  const { data } = await supabase.from("jp_employers").select("*").eq("token", t).is("removed_at", null).maybeSingle();
  return data;
}
export const planActive = (e) => Boolean(e?.plan_until && Date.parse(e.plan_until) > Date.now());

/* ---------------- files ---------------- */
const MIME = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/ogg": "ogg" };
export async function saveFile(candidateId, kind, mime, data) {
  if (!["photo", "cv", "voice"].includes(kind)) throw new Error("Unknown file.");
  if (!MIME[mime]) throw new Error("Please upload a PDF, a photo or a voice note.");
  if (kind === "photo" && !mime.startsWith("image/")) throw new Error("The profile photo must be an image.");
  if (kind === "voice" && !mime.startsWith("audio/")) throw new Error("That isn't a voice recording.");
  const bytes = Buffer.from(String(data || "").replace(/^data:[^,]+,/, ""), "base64");
  if (bytes.length < 2000) throw new Error("That file looks empty.");
  if (bytes.length > 4_500_000) throw new Error("That file is too big (max 4 MB).");
  const path = `candidates/${candidateId}/${kind}.${MIME[mime]}`;
  const { data: old } = await supabase.storage.from(BUCKET).list(`candidates/${candidateId}`);
  const stale = (old || []).filter((f) => f.name.startsWith(`${kind}.`)).map((f) => `candidates/${candidateId}/${f.name}`);
  if (stale.length) await supabase.storage.from(BUCKET).remove(stale);
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, cacheControl: "0" });
  if (error) throw new Error(error.message);
  await supabase.from("jp_candidates").update({ [`${kind}_path`]: path, updated_at: new Date().toISOString() }).eq("id", candidateId);
  return path;
}
export async function fileUrl(path, seconds = 3600) {
  if (!path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl || null;
}

/* ---------------- candidates ---------------- */
export async function saveCandidate(existing, b) {
  const phone = ten(b.phone);
  const row = {
    name: clean(b.name, 80), phone: phone ? `+91${phone}` : undefined, whatsapp: ten(b.whatsapp) ? `+91${ten(b.whatsapp)}` : undefined,
    email: clean(b.email, 120) || null, gender: clean(b.gender, 20) || null, age: Number(b.age) || null,
    role: clean(b.role, 60) || null, roles: (Array.isArray(b.roles) ? b.roles : []).map((r) => clean(r, 60)).filter(Boolean).slice(0, 5),
    experience_years: Number(b.experience_years) >= 0 ? Number(b.experience_years) : null, education: clean(b.education, 60) || null,
    languages: (Array.isArray(b.languages) ? b.languages : []).map((l) => clean(l, 20)).slice(0, 6),
    area: clean(b.area, 60) || null, expected_salary: Number(b.expected_salary) || null, about: clean(b.about, 600) || null,
    open_to_work: b.open_to_work !== false, updated_at: new Date().toISOString(),
  };
  if (!row.name || (!existing && !phone)) throw new Error("Add your name and 10-digit mobile number.");
  if (!row.role) throw new Error("Choose the job you're looking for.");
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  if (existing) {
    const { data, error } = await supabase.from("jp_candidates").update(row).eq("id", existing.id).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data: dup } = await supabase.from("jp_candidates").select("id").eq("phone", `+91${phone}`).maybeSingle();
  if (dup) throw new Error("This number already has a WeAid Jobs profile. Use your login link, or call 080 6426 7771 to get it back.");
  // Same person as a WeAid pro? Share their ID check.
  const { data: pro } = await supabase.from("providers").select("id,verified").or(`phone.eq.+91${phone},phone.eq.${phone}`).is("removed_at", null).limit(1);
  const { data, error } = await supabase.from("jp_candidates").insert({ ...row, provider_id: pro?.[0]?.id || null, verified: Boolean(pro?.[0]?.verified) }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

/** Fuller profiles first: an ID check, a voice intro, a CV, a photo and a few
 *  words about themselves are what employers act on — and it gives workers a
 *  free reason to complete theirs. Newest first among equals. */
export const profileScore = (c) => (c.verified ? 4 : 0) + (c.voice_path ? 2 : 0) + (c.cv_path ? 2 : 0) + (c.photo_path ? 1 : 0) + (c.about ? 1 : 0);
export const byProfile = (a, b) => profileScore(b) - profileScore(a) || Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0);

/** "Suresh K." — enough to talk about, not enough to look up and skip the unlock. */
export const shortName = (n) => { const p = String(n || "").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0] || ""; };
/** A phone number or email typed into "about me" would give the contact away. */
const scrub = (t) => (t ? String(t).replace(/(\+?\d[\d\s-]{7,}\d)/g, "[number hidden]").replace(/\S+@\S+\.\S+/g, "[email hidden]") : t);

/** What an employer sees about a candidate. Phone, full name and files only when allowed. */
export async function candidateCard(c, { showContact = false } = {}) {
  return {
    id: c.id, name: showContact ? c.name : shortName(c.name), role: c.role, roles: c.roles || [], experience: c.experience_years, education: c.education,
    languages: c.languages || [], area: c.area, expectedSalary: c.expected_salary, about: showContact ? c.about : scrub(c.about), gender: c.gender, age: c.age,
    verified: Boolean(c.verified), photo: await fileUrl(c.photo_path), hasCv: Boolean(c.cv_path), hasVoice: Boolean(c.voice_path),
    ...(showContact ? { phone: c.phone, whatsapp: c.whatsapp || c.phone, email: c.email, cv: await fileUrl(c.cv_path, 7 * 86400), voice: await fileUrl(c.voice_path, 7 * 86400) } : {}),
    updated: c.updated_at,
  };
}

/* ---------------- employers ---------------- */
export async function saveEmployer(existing, b) {
  const phone = ten(b.phone);
  const row = { business_name: clean(b.business_name, 100), contact_name: clean(b.contact_name, 60) || null, email: clean(b.email, 120) || null,
    area: clean(b.area, 60) || null, kind: b.kind === "household" ? "household" : "business" };
  if (!row.business_name) throw new Error("Add your business name (or your name, for a household).");
  if (existing) {
    const { data, error } = await supabase.from("jp_employers").update(row).eq("id", existing.id).select("*").single();
    if (error) throw new Error(error.message); return data;
  }
  if (!phone) throw new Error("Add a 10-digit mobile number.");
  const { data: dup } = await supabase.from("jp_employers").select("id,email,token").eq("phone", `+91${phone}`).maybeSingle();
  if (dup) {
    if (dup.email) await emailLogin(dup.email, dup.token);
    throw new Error(dup.email ? "This number already has an employer account — we've emailed your login link." : "This number already has an employer account. Call 080 6426 7771 to get your login link.");
  }
  const { data, error } = await supabase.from("jp_employers").insert({ ...row, phone: `+91${phone}` }).select("*").single();
  if (error) throw new Error(error.message);
  if (data.email) await emailLogin(data.email, data.token).catch(() => {});
  return data;
}
export async function emailLogin(email, token) {
  await sendEmail(email, "Your WeAid Jobs employer login",
    `<p style="font-family:sans-serif">Here's your private link to WeAid Jobs — post jobs and see applications:<br><br><a href="${SITE()}/employer#t=${token}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open my employer dashboard</a><br><br>Keep this email; don't share the link.</p>`);
}

/* ---------------- jobs ---------------- */
const SCREEN = {
  type: "object", additionalProperties: false,
  required: ["verdict", "asks_candidates_for_money", "looks_like_mlm_or_scam", "salary_realistic", "reason"],
  properties: {
    verdict: { type: "string", enum: ["ok", "review", "reject"] },
    asks_candidates_for_money: { type: "boolean" },
    looks_like_mlm_or_scam: { type: "boolean" },
    salary_realistic: { type: "boolean" },
    reason: { type: "string", description: "One short line for the WeAid owner." },
  },
};
export async function screenJob(job) {
  try {
    const msg = await client.messages.create({
      model: process.env.VERIFY_MODEL || "claude-sonnet-5-5", max_tokens: 400,
      output_config: { format: { type: "json_schema", schema: SCREEN } },
      messages: [{ role: "user", content: `A job post on WeAid Jobs, a local job portal in Kochi, India. Check it for scams before it goes live: asking candidates for registration/training/deposit fees, MLM or "investment" schemes, work-from-home earning promises, unrealistic salary for the role, adult or illegal work, or contact details hidden in the text to bypass the portal. Ordinary local jobs are "ok"; unclear → "review"; clearly a scam → "reject".\n\n${JSON.stringify({ title: job.title, role: job.role, description: job.description, salary: [job.salary_min, job.salary_max], area: job.area, type: job.job_type })}` }],
    });
    return JSON.parse(msg.content.find((c) => c.type === "text").text);
  } catch (e) {
    return { verdict: "review", reason: `Automatic check unavailable (${e.message.slice(0, 60)})` };
  }
}
export async function postJob(emp, b) {
  const job = {
    employer_id: emp.id, title: clean(b.title, 80), role: clean(b.role, 60) || null, description: clean(b.description, 2000) || null,
    area: clean(b.area, 60) || emp.area || null, salary_min: Number(b.salary_min) || null, salary_max: Number(b.salary_max) || Number(b.salary_min) || null,
    experience: clean(b.experience, 40) || null, education: clean(b.education, 40) || null, shift: clean(b.shift, 40) || null,
    openings: Math.max(1, Math.min(50, Number(b.openings) || 1)), gender: clean(b.gender, 10) || null,
    job_type: ["full_time", "part_time", "contract"].includes(b.job_type) ? b.job_type : "full_time",
  };
  if (!job.title || !job.area || !job.salary_min) throw new Error("Add the job title, area and salary.");
  if (!planActive(emp)) {
    const { count } = await supabase.from("jp_jobs").select("id", { count: "exact", head: true }).eq("employer_id", emp.id).in("status", ["live", "review"]);
    if ((count || 0) >= 1) throw new Error("Your free post is already active. Choose a plan to post more.");
  } else {
    const { count } = await supabase.from("jp_jobs").select("id", { count: "exact", head: true }).eq("employer_id", emp.id).eq("status", "live");
    if ((count || 0) >= 1) throw new Error("Your plan keeps 1 job active at a time. Close or pause your live job first.");
  }
  const screen = await screenJob(job);
  const status = screen.verdict === "reject" ? "rejected" : screen.verdict === "ok" && emp.approved ? "live" : "review";
  const { data, error } = await supabase.from("jp_jobs").insert({ ...job, screen, status, expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() }).select("*").single();
  if (error) throw new Error(error.message);
  await supabase.from("jp_jobs").update({ slug: `${slugify(job.title)}-${slugify(job.area)}-${data.id.slice(0, 6)}` }).eq("id", data.id);
  if (status === "review") {
    await sendAdminNotification(`[WeAid Jobs] Job to approve — ${job.title} (${emp.business_name})`,
      `<p style="font-family:sans-serif"><b>${esc(job.title)}</b> · ${esc(job.area)} · ₹${job.salary_min}${job.salary_max && job.salary_max !== job.salary_min ? `–${job.salary_max}` : ""}<br>${esc(emp.business_name)} ${esc(emp.phone)}<br>AI check: <b>${esc(screen.verdict)}</b> — ${esc(screen.reason)}<br><br><a href="${opsLink()}">Approve or reject in Ops → Jobs</a></p>`).catch(() => {});
  }
  return { ...data, status };
}

export async function liveJobs({ q, role, roles, area, limit = 60 } = {}) {
  let query = supabase.from("jp_jobs").select("*, jp_employers!inner(business_name, kind)").eq("status", "live").gt("expires_at", new Date().toISOString())
    .order("boosted_until", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
  if (role) query = query.eq("role", role);
  if (roles?.length) query = query.in("role", roles);
  if (area) query = query.ilike("area", `%${area}%`);
  if (q) query = query.or(`title.ilike.%${q}%,role.ilike.%${q}%,description.ilike.%${q}%`);
  const { data } = await query;
  return (data || []).map(publicJob);
}
/* ---------------- applications ---------------- */
/** A new employer sees their first 2 applicants' contacts free (owner's call,
 *  29 Oct 2026); the rest wait for a plan or an unlock — the reason to pay. */
export const FREE_APPLICANTS = 2;
/** Which of an employer's applications they may see contact details for. */
export async function contactRule(emp) {
  if (planActive(emp)) return () => true;
  const { data: jobs } = await supabase.from("jp_jobs").select("id").eq("employer_id", emp.id);
  const ids = (jobs || []).map((j) => j.id);
  const [{ data: first }, { data: un }] = await Promise.all([
    ids.length ? supabase.from("jp_applications").select("id").in("job_id", ids).order("created_at", { ascending: true }).limit(FREE_APPLICANTS) : { data: [] },
    supabase.from("jp_unlocks").select("candidate_id").eq("employer_id", emp.id),
  ]);
  const free = new Set((first || []).map((x) => x.id)), unlocked = new Set((un || []).map((u) => u.candidate_id));
  return (app) => free.has(app.id) || unlocked.has(app.candidate_id);
}
export async function apply(cand, jobId) {
  const { data: job } = await supabase.from("jp_jobs").select("*, jp_employers!inner(*)").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "live") throw new Error("This job isn't open any more.");
  const { data, error } = await supabase.from("jp_applications").insert({ job_id: jobId, candidate_id: cand.id }).select("*").single();
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "You've already applied for this job." : error.message);
  const emp = job.jp_employers;
  // A job WeAid listed from a public posting: the employer hasn't signed up, so
  // the owner hears about every applicant — it is the reason to call them.
  if (job.screen?.seeded) {
    await sendAdminNotification(`[WeAid Jobs] ${cand.name} applied for ${job.title} (${emp.business_name}) — listed job`,
      `<p style="font-family:sans-serif"><b>${esc(cand.name)}</b> (${esc(cand.phone)}) applied for <b>${esc(job.title)}</b> at ${esc(emp.business_name)}, a job WeAid listed from their public posting.<br>Employer contact: ${esc(String(emp.phone || "").startsWith("seed:") ? "no phone on file" : emp.phone)} ${esc(emp.email || "")}<br>Original posting: ${esc(job.screen.source_url || "")}<br><br>Tell them they have an applicant on WeAid — their first post is free.</p>`).catch(() => {});
  }
  if (emp.email) {
    const open = (await contactRule(emp))(data);
    const c = await candidateCard(cand, { showContact: open });
    const dash = `${SITE()}/employer#t=${emp.token}&a=${data.id}`;
    if (!open) {
      const { count } = await supabase.from("jp_applications").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      const from = Math.min(...Object.values(PLANS).map((p) => p.price));
      await sendEmail(emp.email, `${c.name} applied for ${job.title} — ${count} applicant${count === 1 ? "" : "s"} so far`,
        `<div style="font-family:sans-serif;max-width:560px">
          <h2 style="margin:0 0 4px">${esc(c.name)} applied for ${esc(job.title)}</h2>
          <p style="color:#5b6573;margin:0 0 12px">${esc(job.area)} · WeAid Jobs · ${count} applicant${count === 1 ? "" : "s"} so far</p>
          <table cellpadding="5" style="font-size:15px">
            <tr><td style="color:#5b6573">Role</td><td><b>${esc(c.role)}</b></td></tr>
            ${c.experience != null ? `<tr><td style="color:#5b6573">Experience</td><td>${c.experience} yr</td></tr>` : ""}
            ${c.education ? `<tr><td style="color:#5b6573">Education</td><td>${esc(c.education)}</td></tr>` : ""}
            ${c.expectedSalary ? `<tr><td style="color:#5b6573">Expects</td><td>₹${c.expectedSalary.toLocaleString("en-IN")}</td></tr>` : ""}
            <tr><td style="color:#5b6573">Area</td><td>${esc(c.area || "")}</td></tr>
            <tr><td style="color:#5b6573">Phone</td><td>🔒 hidden</td></tr>
          </table>
          <p>You've seen your ${FREE_APPLICANTS} free applicants. Choose a plan (from ₹${from.toLocaleString("en-IN")}) to see the phone number and CV of everyone who applies.</p>
          <p><a href="${dash}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">See applicants & plans</a></p></div>`).catch(() => {});
      return data;
    }
    await sendEmail(emp.email, `${c.name.split(" ")[0]} applied for ${job.title}${c.expectedSalary ? ` — expects ₹${c.expectedSalary.toLocaleString("en-IN")}` : ""}`,
      `<div style="font-family:sans-serif;max-width:560px">
        <h2 style="margin:0 0 4px">${esc(c.name)} applied for ${esc(job.title)}</h2>
        <p style="color:#5b6573;margin:0 0 12px">${esc(job.area)} · WeAid Jobs</p>
        <table cellpadding="5" style="font-size:15px">
          <tr><td style="color:#5b6573">Role</td><td><b>${esc(c.role)}</b></td></tr>
          ${c.experience != null ? `<tr><td style="color:#5b6573">Experience</td><td>${c.experience} yr</td></tr>` : ""}
          ${c.education ? `<tr><td style="color:#5b6573">Education</td><td>${esc(c.education)}</td></tr>` : ""}
          ${c.expectedSalary ? `<tr><td style="color:#5b6573">Expects</td><td>₹${c.expectedSalary.toLocaleString("en-IN")}</td></tr>` : ""}
          <tr><td style="color:#5b6573">Area</td><td>${esc(c.area || "")}</td></tr>
          <tr><td style="color:#5b6573">Phone</td><td><b>${esc(c.phone)}</b></td></tr>
          ${c.verified ? `<tr><td></td><td style="color:#0f766e"><b>✓ ID checked by WeAid</b></td></tr>` : ""}
        </table>
        ${c.cv ? `<p><a href="${c.cv}">📄 Open CV</a></p>` : ""}
        <p><a href="${dash}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Schedule interview</a>
           &nbsp;<a href="https://wa.me/91${ten(c.whatsapp)}" style="display:inline-block;background:#25d366;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">WhatsApp ${esc(c.name.split(" ")[0])}</a></p></div>`).catch(() => {});
  }
  return data;
}
export async function setSlots(emp, appId, slots) {
  const { data: a } = await supabase.from("jp_applications").select("*, jp_jobs!inner(employer_id)").eq("id", appId).maybeSingle();
  if (!a || a.jp_jobs.employer_id !== emp.id) throw new Error("Not your applicant.");
  if (!(await contactRule(emp))(a)) throw new Error("Choose a plan to contact this applicant.");
  const s = (slots || []).map((x) => Date.parse(x)).filter((t) => t > Date.now()).slice(0, 4).map((t) => new Date(t).toISOString());
  if (!s.length) throw new Error("Pick at least one future time.");
  await supabase.from("jp_applications").update({ slots: s, slot_chosen: null, status: "interview", updated_at: new Date().toISOString() }).eq("id", appId);
  return { ok: true };
}
export async function chooseSlot(cand, appId, slot) {
  const { data: a } = await supabase.from("jp_applications").select("*, jp_jobs!inner(title, employer_id, jp_employers!inner(email, business_name, token))").eq("id", appId).eq("candidate_id", cand.id).maybeSingle();
  if (!a) throw new Error("Not found.");
  if (!(a.slots || []).includes(slot)) throw new Error("Choose one of the offered times.");
  await supabase.from("jp_applications").update({ slot_chosen: slot, updated_at: new Date().toISOString() }).eq("id", appId);
  const e = a.jp_jobs.jp_employers;
  if (e.email) await sendEmail(e.email, `Interview confirmed: ${cand.name} — ${new Date(slot).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`,
    `<p style="font-family:sans-serif"><b>${esc(cand.name)}</b> (${esc(cand.phone)}) chose <b>${new Date(slot).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</b> for the ${esc(a.jp_jobs.title)} interview.<br><br><a href="${SITE()}/employer#t=${e.token}">Open dashboard</a></p>`).catch(() => {});
  return { ok: true };
}

/* ---------------- employer: search & unlock ---------------- */
export async function searchCandidates(emp, { role, area, q }) {
  let query = supabase.from("jp_candidates").select("*").is("removed_at", null).eq("open_to_work", true).order("updated_at", { ascending: false }).limit(200);
  if (role) query = query.or(`role.eq.${role},roles.cs.{"${role}"}`);
  if (area) query = query.ilike("area", `%${area}%`);
  if (q) query = query.or(`role.ilike.%${q}%,about.ilike.%${q}%,name.ilike.%${q}%`);
  const { data: all } = await query;
  const data = (all || []).sort(byProfile).slice(0, 40);
  const ids = data.map((c) => c.id);
  const { data: un } = ids.length ? await supabase.from("jp_unlocks").select("candidate_id").eq("employer_id", emp.id).in("candidate_id", ids) : { data: [] };
  const unlocked = new Set((un || []).map((u) => u.candidate_id));
  return Promise.all((data || []).map(async (c) => ({ ...(await candidateCard(c, { showContact: unlocked.has(c.id) })), unlocked: unlocked.has(c.id) })));
}
export async function unlock(emp, candidateId) {
  const { data: has } = await supabase.from("jp_unlocks").select("candidate_id").eq("employer_id", emp.id).eq("candidate_id", candidateId).maybeSingle();
  if (!has) {
    if (!planActive(emp)) throw new Error("Choose a plan to unlock candidates' contact details.");
    if ((emp.unlocks_left || 0) <= 0) throw new Error("You've used all your unlocks on this plan.");
    const { data: dec } = await supabase.from("jp_employers").update({ unlocks_left: emp.unlocks_left - 1 }).eq("id", emp.id).eq("unlocks_left", emp.unlocks_left).select("id").maybeSingle();
    if (!dec) throw new Error("Please try again.");
    await supabase.from("jp_unlocks").insert({ employer_id: emp.id, candidate_id: candidateId });
  }
  const { data: c } = await supabase.from("jp_candidates").select("*").eq("id", candidateId).maybeSingle();
  return candidateCard(c, { showContact: true });
}
export async function activatePlan(employerId, planKey) {
  const p = PLANS[planKey];
  if (!p) throw new Error("Unknown plan.");
  const { data: e } = await supabase.from("jp_employers").select("*").eq("id", employerId).maybeSingle();
  const from = planActive(e) ? Date.parse(e.plan_until) : Date.now();
  await supabase.from("jp_employers").update({ plan: planKey, plan_until: new Date(from + p.days * 86400e3).toISOString(), unlocks_left: (planActive(e) ? e.unlocks_left : 0) + p.unlocks, boosts_left: (planActive(e) ? e.boosts_left : 0) + p.boosts, approved: true }).eq("id", employerId);
  return { ok: true };
}

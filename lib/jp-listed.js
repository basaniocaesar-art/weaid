/**
 * WeAid Jobs — jobs WeAid listed from public postings (owner's call, 31 Oct 2026).
 *
 * The employer never signed up, so when someone applies:
 *   1. Find the employer's hiring email — Claude searches the web, and only an
 *      address published on the employer's own website counts. Looked up once
 *      per employer; the result (or "none found") is kept on the employer row.
 *   2. Email them the applicant, saying plainly how WeAid has their job.
 *   3. Two days after the first applicant went to them, one more email: their
 *      free WeAid employer account is already set up — here's the link.
 * Each applicant also hears (by email, when they gave one) that their details
 * went to the employer.
 *
 * State lives in jsonb, no migration: jp_employers has `email`; the lookup and
 * invite go on the job's `screen` (contact, forwarded[], invited_at).
 */
import Anthropic from "@anthropic-ai/sdk";
import { shell, applicantCard } from "./jp-emails.js";

const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const client = new Anthropic();

/** { email, phone, source, note } — email null when none is published. */
export async function findContact(emp, job) {
  const ask = `Find the hiring contact for this employer in Kerala, India. A nurse/worker applied to their job through WeAid Jobs and we need to send them the application.

Employer: ${emp.business_name}
Area: ${job.area || emp.area || "Ernakulam"}
Job: ${job.title}
Original posting: ${job.screen?.source_url || "unknown"}

Search the web. Prefer a careers/HR/recruitment email; otherwise their general enquiry email. Use ONLY an email address published on the employer's own website (their own domain). Do not use addresses from job boards, directories, LinkedIn or data brokers, and never guess an address. Be careful with similarly named businesses.

Reply with only a JSON object: {"email": string|null, "phone": string|null, "source": "URL of the employer's page showing the email, or null", "note": "one short line"}`;
  const messages = [{ role: "user", content: ask }];
  for (let i = 0; i < 4; i++) {
    const r = await client.beta.messages.create({
      model: process.env.JP_CONTACT_MODEL || "claude-opus-5-5", max_tokens: 16000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
    });
    if (r.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: r.content }); continue; }
    if (r.stop_reason === "refusal") return { email: null, phone: null, source: null, note: "lookup declined" };
    const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/g);
    const out = m ? JSON.parse(m[m.length - 1]) : {};
    const email = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out.email || "") ? out.email.trim().toLowerCase() : null;
    // The address must sit on the domain of the page it came from.
    const host = (() => { try { return new URL(out.source).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const ok = email && host && (host.endsWith(email.split("@")[1]) || email.split("@")[1].endsWith(host));
    return { email: ok ? email : null, phone: out.phone || null, source: out.source || null, note: ok || !email ? String(out.note || "").slice(0, 200) : `rejected ${email}: not on ${host || "the employer's site"}` };
  }
  return { email: null, phone: null, source: null, note: "lookup did not finish" };
}

const whyYou = (emp, job) => `WeAid Jobs is a free local job board in Kochi. We listed your <b>${esc(job.title)}</b> opening from your public posting${job.screen?.source_url ? ` (<a href="${esc(job.screen.source_url)}">original</a>)` : ""} so local job seekers can find it.`;

/** To the employer: one or more applicants for a listed job. items: [{ card, open, phone, top }] */
export function listedApplicantEmail({ emp, job, items, dash }) {
  const first = String(items[0].card.name || "").split(" ")[0];
  return {
    subject: items.length === 1 ? `${first} applied for your ${job.title} opening (via WeAid Jobs)` : `${items.length} people applied for your ${job.title} opening (via WeAid Jobs)`,
    html: shell({
      heading: items.length === 1 ? `${esc(first)} applied for your ${esc(job.title)} job` : `${items.length} applicants for your ${esc(job.title)} job`,
      sub: whyYou(emp, job),
      body: items.map((x) => applicantCard(x.card, { ...x, dash })).join(""),
      cta: { href: dash, label: "See applicants on WeAid — free" },
      foot: "No charge to you or the applicant. If this job is filled, just reply and we'll take it down.",
    }),
  };
}

/** To the employer, two days later: their account already exists. */
export function inviteEmail({ emp, job, count, dash }) {
  return {
    subject: `Your free WeAid Jobs account for ${emp.business_name}`,
    html: shell({
      heading: `${esc(emp.business_name)} is on WeAid Jobs`,
      sub: `${count === 1 ? "1 person has" : `${count} people have`} applied for your ${esc(job.title)} opening on WeAid. Your employer account is already set up — no sign-up form.`,
      body: `<div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;background:#fff;font:15px/1.6 sans-serif;color:#334155">
        With your account you can:<br>• see everyone who applies, with their profile<br>• post your next opening free — it goes live to job seekers across Kochi<br>• offer interview times, and applicants pick one</div>`,
      cta: { href: dash, label: "Open my employer account" },
      foot: "This link is private to you — keep this email. Not hiring any more? Reply and we'll close the job.",
    }),
  };
}

/** To the applicant, when they applied. */
export function appliedEmail({ cand, job, emp, listed }) {
  return {
    subject: `You applied for ${job.title} — ${emp.business_name}`,
    html: shell({
      heading: "Application received",
      sub: `${esc(cand.name.split(" ")[0])}, you applied for <b>${esc(job.title)}</b> at ${esc(emp.business_name)}.`,
      body: `<p style="font:15px/1.6 sans-serif;color:#334155;margin:0">${listed
        ? "This employer hasn't joined WeAid yet, so we're sending your details to their hiring team for you. We'll email you when that's done."
        : "The employer has your profile. If they want to meet you, they'll call or send interview times."} WeAid never charges job seekers.</p>`,
      cta: { href: `${SITE()}/candidate`, label: "Open my WeAid Jobs profile" },
      foot: "A full profile (CV, photo, voice intro) gets more calls.",
    }),
  };
}

/** To the applicant, once their details reached the employer. */
export function sentEmail({ cand, job, emp }) {
  return {
    subject: `Your application reached ${emp.business_name}`,
    html: shell({
      heading: "Sent to the employer",
      sub: `${esc(cand.name.split(" ")[0])}, we've emailed your details for <b>${esc(job.title)}</b> to ${esc(emp.business_name)}'s hiring team.`,
      body: `<p style="font:15px/1.6 sans-serif;color:#334155;margin:0">If they're interested they'll contact you directly. Keep your phone on, and keep applying — good jobs fill quickly.</p>`,
      cta: { href: `${SITE()}/jobs`, label: "See more jobs" },
    }),
  };
}

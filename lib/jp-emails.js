/**
 * WeAid Jobs — the emails employers get about their applicants (owner's call,
 * 29 Oct 2026, after WorkIndia's): big candidate cards, the number half-hidden
 * until a plan, "Top match" on strong profiles, one button to connect with all,
 * and a WeAid helper to call. Everything they say is true — no fake calls,
 * chats or confirmations.
 *
 * Cards take what candidateCard() returns, plus the raw phone for the mask.
 */
const SITE = () => process.env.NEXT_PUBLIC_URL || "https://weaid.in";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const inr = (n) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");
const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

/** "+91 9XXXX XX132" — real enough to trust, not enough to call. */
export const maskPhone = (p) => { const d = ten(p); return d.length === 10 ? `+91 ${d[0]}XXXX XX${d.slice(7)}` : ""; };

const BTN = "display:inline-block;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px";

/** One applicant. c = candidateCard() output; open = contact may be shown. */
export function applicantCard(c, { open, phone, top, dash, note }) {
  const first = esc(String(c.name || "").split(" ")[0]);
  const chips = [c.experience != null ? `${c.experience} yr experience` : "", c.education, c.area ? `📍 ${c.area}` : ""].filter(Boolean).map((x) => esc(x)).join(" &nbsp;·&nbsp; ");
  const actions = open
    ? `<a href="tel:${esc(c.phone)}" style="${BTN};background:#15803d;color:#fff">📞 Call ${first}</a>
       <a href="https://wa.me/91${ten(c.whatsapp || c.phone)}" style="${BTN};background:#25d366;color:#fff;margin-left:6px">WhatsApp</a>
       ${c.cv ? `<a href="${esc(c.cv)}" style="${BTN};background:#fff;color:#0f172a;border:1.5px solid #cbd5e1;margin-left:6px">📄 CV</a>` : ""}`
    : `<a href="${dash}" style="${BTN};background:#0f766e;color:#fff">View ${first}'s profile →</a>`;
  return `<div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:0 0 12px;background:#fff">
    <table cellpadding="0" cellspacing="0" style="width:100%"><tr>
      <td style="width:58px;vertical-align:top"><div style="width:48px;height:48px;border-radius:24px;background:#ccfbf1;color:#0f766e;font:700 22px/48px sans-serif;text-align:center">${esc((c.name || "?")[0].toUpperCase())}</div></td>
      <td style="vertical-align:top">
        <div style="font:700 18px sans-serif;color:#0f172a">${esc(c.name)}
          ${top ? `<span style="font:700 11px sans-serif;color:#15803d;background:#dcfce7;border-radius:6px;padding:2px 6px;margin-left:6px;vertical-align:middle">TOP MATCH</span>` : ""}
          ${c.verified ? `<span style="font:700 11px sans-serif;color:#0f766e;background:#ccfbf1;border-radius:6px;padding:2px 6px;margin-left:4px;vertical-align:middle">✓ ID CHECKED</span>` : ""}</div>
        <div style="font:15px sans-serif;color:#334155;margin-top:3px">${esc(c.role)}${c.expectedSalary ? ` · expects <b>${inr(c.expectedSalary)}</b>/month` : ""}</div>
        ${chips ? `<div style="font:13px sans-serif;color:#64748b;margin-top:4px">${chips}</div>` : ""}
        <div style="font:14px sans-serif;color:#334155;margin-top:6px">${open ? `📞 <b>${esc(c.phone)}</b>` : `📞 ${esc(maskPhone(phone))} 🔒`}${!open && c.hasCv ? " &nbsp;·&nbsp; 📄 CV attached" : ""}${!open && c.hasVoice ? " &nbsp;·&nbsp; 🎙 voice intro" : ""}</div>
        ${note ? `<div style="font:13px sans-serif;color:#b45309;margin-top:6px">${note}</div>` : ""}
        <div style="margin-top:12px">${actions}</div>
      </td></tr></table></div>`;
}

/** The frame every applicant email shares. */
export function shell({ heading, sub, body, cta, foot }) {
  return `<div style="background:#f1f5f9;padding:20px 10px"><div style="max-width:560px;margin:0 auto;font-family:sans-serif">
    <div style="text-align:center;margin-bottom:14px"><img src="${SITE()}/weaid-mark.png" alt="WeAid" width="36" height="36" style="vertical-align:middle"> <b style="font-size:18px;color:#0f766e;vertical-align:middle">WeAid Jobs</b></div>
    <h1 style="font-size:24px;margin:0 0 6px;text-align:center;color:#0f172a">${heading}</h1>
    <p style="font-size:15px;color:#475569;margin:0 0 18px;text-align:center">${sub}</p>
    ${body}
    ${cta ? `<a href="${cta.href}" style="display:block;text-align:center;background:#0f172a;color:#fff;padding:15px;border-radius:12px;text-decoration:none;font-weight:700;font-size:17px;margin-top:6px">${cta.label}</a>` : ""}
    ${foot ? `<p style="font-size:13px;color:#64748b;text-align:center;margin:8px 0 0">${foot}</p>` : ""}
    <div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px;margin-top:20px;background:#fff">
      <b style="font-size:15px">Need help choosing, or a plan for many hires?</b>
      <div style="font-size:13px;color:#64748b;margin:2px 0 10px">The WeAid team in Kochi will help you hire.</div>
      <a href="tel:+918064267771" style="${BTN};background:#15803d;color:#fff;font-size:14px">📞 Call 080 6426 7771</a>
      <a href="https://wa.me/918064267771?text=${encodeURIComponent("Hi WeAid, I need help hiring")}" style="${BTN};background:#fff;color:#15803d;border:1.5px solid #15803d;font-size:14px;margin-left:6px">WhatsApp us</a>
    </div></div></div>`;
}

const planFrom = (plans) => inr(Math.min(...Object.values(plans).map((p) => p.price)));
const unlockFoot = (plans, free) => `You've seen your ${free} free applicants. A plan from ${planFrom(plans)} shows the phone number and CV of everyone who applies.`;
const s = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The instant email when someone applies. */
export function newApplicantEmail({ job, card, open, phone, top, count, dash, plans, free }) {
  const first = String(card.name || "").split(" ")[0];
  return {
    subject: open ? `${first} applied for ${job.title}${card.expectedSalary ? ` — expects ${inr(card.expectedSalary)}` : ""}` : `${card.name} applied for ${job.title} — ${s(count, "applicant", "applicants")} so far`,
    html: shell({
      heading: `New applicant for ${esc(job.title)}`,
      sub: `${esc(job.area)} · ${s(count, "person has", "people have")} applied so far`,
      body: applicantCard(card, { open, phone, top, dash }),
      cta: open ? null : { href: dash, label: count > 1 ? `Connect with all ${count} applicants` : "See plans" },
      foot: open ? "Good candidates get many calls. Call early to hire faster." : unlockFoot(plans, free),
    }),
  };
}

/** Yesterday's applicants, all jobs together. items: [{ job, card, open, phone, top, dash }] */
export function digestEmail({ items, dash, plans, free, locked }) {
  const jobs = [...new Set(items.map((x) => x.job.title))];
  return {
    subject: `${s(items.length, "person", "people")} applied for your ${jobs.length === 1 ? jobs[0] : "jobs"} yesterday`,
    html: shell({
      heading: `${s(items.length, "new applicant", "new applicants")} yesterday`,
      sub: `For your ${esc(jobs.join(", "))} ${jobs.length === 1 ? "job" : "jobs"}. Good candidates get many calls — connect early to hire faster.`,
      body: items.map((x) => `<div style="font:700 12px sans-serif;color:#64748b;margin:0 0 4px;text-transform:uppercase">${esc(x.job.title)} · ${esc(x.job.area)}</div>${applicantCard(x.card, x)}`).join(""),
      cta: { href: dash, label: locked ? `Connect with all ${items.length}` : "Open your dashboard" },
      foot: locked ? unlockFoot(plans, free) : "",
    }),
  };
}

/** Applicants from two days ago nobody has answered. items as in digestEmail. */
export function waitingEmail({ items, dash, plans, free, locked }) {
  const first = String(items[0].card.name || "").split(" ")[0];
  return {
    subject: items.length === 1 ? `${first} is still waiting to hear about your ${items[0].job.title} job` : `${items.length} applicants are still waiting to hear from you`,
    html: shell({
      heading: items.length === 1 ? `${esc(first)} is still waiting` : `${items.length} applicants are still waiting`,
      sub: "They applied 2 days ago and haven't heard back yet. Good candidates take other jobs quickly.",
      body: items.map((x) => applicantCard(x.card, { ...x, note: `Applied for ${esc(x.job.title)} 2 days ago` })).join(""),
      cta: { href: dash, label: locked ? "Connect with them now" : "Reply to them now" },
      foot: locked ? unlockFoot(plans, free) : "",
    }),
  };
}

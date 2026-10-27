/** A single-field job board page (see lib/job-niches.js). Server-rendered list; the search filters in the browser. */
import Head from "next/head";
import { SITE } from "../lib/seo-config.js";

const money = (a, b) => (a ? `₹${a.toLocaleString("en-IN")}${b && b !== a ? ` – ₹${b.toLocaleString("en-IN")}` : ""}` : "Salary on request");
const ago = (iso) => {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400e3));
  return d === 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : "over a month ago";
};

const css = `
:root{--ink:#0b0f14;--mut:#5b6573;--line:#e7ebf0;--bg:#f7f9fc;--brand:#0d9488;--brand-d:#0f766e;--feat:#fffbeb;--feat-line:#fcd34d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"DM Sans",system-ui,-apple-system,sans-serif;line-height:1.5}
a{color:inherit}.w{max-width:860px;margin:0 auto;padding:0 16px}
.top{background:#fff;border-bottom:1px solid var(--line)}.top .w{display:flex;align-items:center;justify-content:space-between;height:60px;gap:10px}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;font-weight:800;font-size:17px;letter-spacing:-.01em}
.brand i{width:26px;height:26px;border-radius:8px;background:var(--brand);display:inline-grid;place-items:center;color:#fff;font-style:normal;font-size:14px}
.brand small{font-weight:600;color:var(--mut);font-size:12px}
.nav{display:flex;gap:14px;align-items:center;white-space:nowrap;font-size:14px;font-weight:600}.nav a{text-decoration:none;color:var(--mut)}
.nav a.post{background:var(--brand);color:#fff;padding:8px 14px;border-radius:10px}
@media(max-width:560px){.nav a.browse,.brand small{display:none}}
.hero{text-align:center;padding:44px 0 22px}
.pill{display:inline-block;background:#ecfdf5;color:var(--brand-d);font-weight:700;font-size:13px;padding:4px 12px;border-radius:999px}
h1{font-size:clamp(28px,5vw,42px);line-height:1.12;letter-spacing:-.03em;margin:14px 0 10px}h1 b{color:var(--brand)}
.sub{color:#475569;font-size:16px;max-width:600px;margin:0 auto}
.search{display:flex;gap:8px;max-width:640px;margin:22px auto 0;flex-wrap:wrap}
.search input,.search select{flex:2;min-width:180px;padding:12px 14px;border-radius:12px;border:1.5px solid var(--line);font:inherit;background:#fff}
.search select{flex:1;min-width:140px}
.bar{display:flex;justify-content:space-between;align-items:center;margin:26px 0 10px;font-size:14px;color:var(--mut)}
.job{display:block;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px;text-decoration:none}
.job:hover{border-color:var(--brand)}.job.f{background:var(--feat);border-color:var(--feat-line)}
.job .t{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.job b{font-size:16.5px}
.tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;margin-bottom:6px;display:inline-block}
.m{color:var(--mut);font-size:14px}.pay{font-weight:800;color:var(--brand-d)}
.row{display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-top:4px}
.chip{font-size:12px;font-weight:600;border:1px solid var(--line);border-radius:999px;padding:2px 9px;color:#475569;background:#fff}
.cols{display:grid;gap:12px;grid-template-columns:1fr;margin-top:26px}@media(min-width:700px){.cols{grid-template-columns:1fr 1fr}}
.box{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px}
.btn{display:inline-block;margin-top:10px;background:var(--ink);color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:12px;font-size:14px}
.btn.g{background:var(--brand)}
h2{font-size:20px;margin:34px 0 12px}
details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:8px}summary{font-weight:700;cursor:pointer}
.empty{text-align:center;padding:26px}
.foot{margin-top:44px;padding:24px 0 36px;border-top:1px solid var(--line);font-size:13px;color:var(--mut)}.foot a{color:var(--mut)}
`;

export default function NicheBoard({ n, slug, jobs }) {
  const url = `${SITE}/${slug}`;
  const title = `${n.headline} — ${jobs.length ? `${jobs.length} openings` : "apply free"} | ${n.brand}`;
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: n.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={n.sub} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} /><meta property="og:description" content={n.sub} /><meta property="og:url" content={url} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      </Head>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header className="top"><div className="w">
        <a className="brand" href={`/${slug}`}><i>+</i>{n.brand} <small>by WeAid</small></a>
        <nav className="nav"><a className="browse" href="#jobs">Browse jobs</a><a className="post" href={`/hire?role=${encodeURIComponent(n.postRole)}`}>Post a job — free</a></nav>
      </div></header>
      <main className="w">
        <section className="hero">
          <span className="pill">{jobs.length ? `${jobs.length} active opening${jobs.length === 1 ? "" : "s"}` : "New openings added every week"}</span>
          <h1>{n.headline}</h1>
          <p className="sub">{n.sub}</p>
          <form className="search" onSubmit={(e) => e.preventDefault()}>
            <input id="nbq" placeholder="Search by title, employer or area" autoComplete="off" />
            <select id="nba" defaultValue=""><option value="">All areas</option>{n.areas.map((a) => <option key={a}>{a}</option>)}</select>
          </form>
        </section>

        <div className="bar" id="jobs"><span id="nbc">{jobs.length} job{jobs.length === 1 ? "" : "s"}</span><span>Newest first · featured on top</span></div>
        {jobs.map((j) => (
          <a key={j.id} href={`/job/${j.slug}`} className={`job${j.boosted ? " f" : ""}`} data-s={`${j.title} ${j.employer} ${j.area}`.toLowerCase()} data-a={(j.area || "").toLowerCase()}>
            {j.boosted && <span className="tag">Featured</span>}
            <div className="t"><b>{j.title}</b><span className="pay">{money(j.salaryMin, j.salaryMax)}<span className="m" style={{ fontWeight: 400 }}>{j.salaryMin ? " /mo" : ""}</span></span></div>
            <div className="row">
              <span className="m">{j.household ? "Household" : j.employer} · {j.area}</span>
              <span style={{ display: "flex", gap: 6 }}>{j.type && <span className="chip">{j.type.replace("_", " ")}</span>}<span className="chip">{ago(j.posted)}</span></span>
            </div>
          </a>
        ))}
        <div className="box empty" id="nbe" style={{ display: jobs.length ? "none" : "block" }}>
          <b>No matching jobs right now</b>
          <div className="m">Make your free profile and employers looking for a {n.one} can find you.</div>
        </div>

        <div className="cols">
          <div className="box">
            <b>Looking for work?</b>
            <div className="m">Make one free profile — with your qualification, experience and expected salary — and apply to any job here with one tap. Employers hiring a {n.one} can also find you.</div>
            <a className="btn g" href="/candidate">Make my free profile</a>
          </div>
          <div className="box">
            <b>Hiring a {n.one}?</b>
            <div className="m">Post your opening in 2 minutes. Your first post is free; applicants' profiles and phone numbers come straight to your email.</div>
            <a className="btn" href={`/hire?role=${encodeURIComponent(n.postRole)}`}>Post a job — free</a>
          </div>
        </div>

        <h2>Questions</h2>
        {n.faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p className="m" style={{ marginBottom: 0 }}>{a}</p></details>)}
      </main>
      <footer className="foot"><div className="w">{n.brand} is part of <a href="/">WeAid</a>, Kochi. · <a href="/jobs-in-kochi">All jobs in Kochi</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></div></footer>
      <script dangerouslySetInnerHTML={{ __html: `
(function(){var q=document.getElementById('nbq'),a=document.getElementById('nba'),c=document.getElementById('nbc'),e=document.getElementById('nbe');
function f(){var s=q.value.trim().toLowerCase(),ar=a.value.toLowerCase(),n=0;
document.querySelectorAll('.job').forEach(function(el){var ok=(!s||el.dataset.s.indexOf(s)>-1)&&(!ar||el.dataset.a.indexOf(ar)>-1);el.style.display=ok?'':'none';if(ok)n++;});
c.textContent=n+' job'+(n===1?'':'s');e.style.display=n?'none':'block';}
q.addEventListener('input',f);a.addEventListener('change',f);})();` }} />
    </>
  );
}

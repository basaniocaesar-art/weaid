/**
 * /workers/<slug> — people available for one kind of work in Kochi, for anyone
 * who needs to hire (owner's call, 28 Oct 2026: employers rarely post jobs for
 * trades like construction, but they do go looking for workers).
 *
 * Public, so it shows only what a worker would put on a notice board: first
 * name and initial, the work, experience, area, expected pay. No photo, no
 * age, no phone — the phone is the thing an employer unlocks on a plan.
 */
import { Page, crumbsLd } from "../../components/Seo.js";
import { NICHES, nicheByWorkers } from "../../lib/job-niches.js";

const inr = (n) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");
export default function Workers({ slug, board, n, workers }) {
  const title = n.workers.title;
  const hireUrl = (role) => `/employer?tab=search&role=${encodeURIComponent(role || n.postRole)}`;
  return (
    <Page title={`Hire ${title} in Kochi — ${workers.length ? `${workers.length} available` : "available now"} | WeAid`}
      description={`Find ${title} in Kochi looking for work now. See experience, area and expected pay, then unlock their number and call. Or post a job free.`}
      path={`/workers/${slug}`} jsonLd={[crumbsLd([["Hire workers in Kochi", "/workers"], [title, `/workers/${slug}`]])]}>
      <div className="crumb"><a href="/workers">Hire workers in Kochi</a> › {title}</div>
      <h1>Hire {title} in Kochi</h1>
      <p className="lead">{workers.length ? `${workers.length} ${workers.length === 1 ? "person is" : "people are"} looking for this work right now.` : "People join every day."} See their experience, area and expected pay — then unlock a number and call them directly.</p>
      <div className="btns" style={{ maxWidth: 520 }}>
        <a className="btn call" href={hireUrl()}>Unlock and call workers</a>
        <a className="btn" href={`/hire?role=${encodeURIComponent(n.postRole)}`}>Post a job — free</a>
      </div>
      <div className="grid" style={{ marginTop: 18 }}>
        {workers.map((w) => (
          <div key={w.id} className="card">
            <div>{w.top && <span className="badge f">Top profile</span>}{w.verified && <span className="badge">ID checked</span>}{w.hasCv && <span className="badge">CV</span>}{w.hasVoice && <span className="badge">Voice intro</span>}</div>
            <h3>{w.name} — {w.role}</h3>
            <div className="meta">{[w.experience != null && `${w.experience} yr experience`, w.area, w.languages?.length && w.languages.join(", ")].filter(Boolean).join(" · ")}</div>
            {w.salary && <div style={{ fontWeight: 800, color: "#0f766e" }}>Expects {inr(w.salary)} <span className="meta" style={{ fontWeight: 400 }}>a month</span></div>}
            <div className="btns"><a className="btn call" href={hireUrl(w.role)}>🔓 Unlock number</a></div>
          </div>
        ))}
      </div>
      {!workers.length && <div className="box" style={{ textAlign: "center" }}><b>No one listed for this yet</b><div className="meta">Post your job free and we'll send it to people as they join.</div></div>}
      <h2>How it works</h2>
      <div className="box"><ul>
        <li>Workers make a free profile on WeAid Jobs with their work, experience and expected pay.</li>
        <li>You see everyone available here. Their phone number stays hidden until you unlock it.</li>
        <li>A plan (from ₹1,499 a month) unlocks up to 100 numbers, CVs and voice intros — or post a job free and applicants' numbers come to you.</li>
      </ul></div>
      <p className="meta" style={{ marginTop: 14 }}>Looking for this work yourself? <a href="/candidate">Make your free profile</a> · <a href={`/${board}`}>See {n.brand}</a></p>
    </Page>
  );
}
export async function getServerSideProps({ params, res }) {
  const hit = nicheByWorkers(params.slug);
  if (!hit) return { notFound: true };
  const [board, n] = hit;
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
  let workers = [];
  try {
    const { supabase } = await import("../../lib/supabase.js");
    const { shortName, byProfile, profileScore } = await import("../../lib/jobportal.js");
    const ors = n.roles.map((r) => `role.eq.${r},roles.cs.{"${r}"}`).join(",");
    const { data } = await supabase.from("jp_candidates").select("id,name,role,roles,experience_years,area,expected_salary,languages,verified,cv_path,voice_path,photo_path,about,updated_at")
      .is("removed_at", null).eq("open_to_work", true).or(ors).order("updated_at", { ascending: false }).limit(300);
    workers = (data || []).sort(byProfile).slice(0, 60).map((c) => ({ id: c.id, top: profileScore(c) >= 5, name: shortName(c.name), role: n.roles.includes(c.role) ? c.role : (c.roles || []).find((r) => n.roles.includes(r)) || c.role,
      experience: c.experience_years, area: c.area || null, salary: c.expected_salary || null, languages: c.languages || [], verified: Boolean(c.verified), hasCv: Boolean(c.cv_path), hasVoice: Boolean(c.voice_path) }));
  } catch {}
  return { props: { slug: params.slug, board, n, workers } };
}

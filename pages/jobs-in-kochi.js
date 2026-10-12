/** /jobs-in-kochi — WeAid Jobs: every live job, filterable (?role=&area=&q=). */
import { ROLES } from "../lib/jobs-config.js";
import { Page, crumbsLd } from "../components/Seo.js";

const money = (a, b) => (a ? `₹${a.toLocaleString("en-IN")}${b && b !== a ? ` – ₹${b.toLocaleString("en-IN")}` : ""}` : "");
export default function JobsList({ jobs, role, area, q }) {
  const where = [role, area].filter(Boolean).join(" in ");
  return (
    <Page title={`${role ? `${role} jobs` : "Jobs"} in ${area || "Kochi"} — apply free | WeAid Jobs`}
      description={`${jobs.length} live ${role ? role.toLowerCase() + " " : ""}jobs in ${area || "Kochi"}. Apply free with your phone — no fees, ever. Verified local employers on WeAid Jobs.`}
      path={`/jobs-in-kochi${role || area || q ? `?${new URLSearchParams({ ...(role && { role }), ...(area && { area }), ...(q && { q }) })}` : ""}`} jsonLd={[crumbsLd([["Jobs in Kochi", "/jobs-in-kochi"]])]}>
      <div className="crumb">WeAid Jobs</div>
      <h1>{where ? `${where} — jobs` : "Jobs in Kochi"}</h1>
      <p className="lead">Apply free — WeAid never charges candidates. <a href="/candidate">Create your profile</a> once and apply with one tap. Hiring? <a href="/hire">Post a job</a>.</p>
      <form className="box" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <input name="q" defaultValue={q} placeholder="Search jobs" style={{ flex: 2, minWidth: 160, padding: 10, borderRadius: 10, border: "1.5px solid #e7ebf0", font: "inherit" }} />
        <select name="role" defaultValue={role} style={{ flex: 1, minWidth: 140, padding: 10, borderRadius: 10, border: "1.5px solid #e7ebf0", font: "inherit" }}><option value="">Any role</option>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <input name="area" defaultValue={area} placeholder="Area" style={{ flex: 1, minWidth: 120, padding: 10, borderRadius: 10, border: "1.5px solid #e7ebf0", font: "inherit" }} />
        <button className="btn call" style={{ flex: "0 0 auto", minWidth: 100, cursor: "pointer" }}>Search</button>
      </form>
      <div style={{ marginTop: 14 }}>
        {jobs.length ? jobs.map((j) => (
          <a key={j.id} href={`/job/${j.slug}`} className="card" style={{ textDecoration: "none", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b style={{ fontSize: 17 }}>{j.title}</b>{j.boosted && <span className="badge f">Featured</span>}</div>
            <div className="meta">{j.household ? "Household" : j.employer} · {j.area}</div>
            <div style={{ fontWeight: 800, color: "#0f766e" }}>{money(j.salaryMin, j.salaryMax)}<span className="meta" style={{ fontWeight: 400 }}> / month</span></div>
            <div className="meta">{[j.type?.replace("_", " "), j.experience, j.education, j.shift].filter(Boolean).join(" · ")}</div>
          </a>
        )) : <div className="box" style={{ textAlign: "center" }}><b>No jobs here yet</b><div className="meta">Try another search — or <a href="/candidate">create your profile</a> so employers can find you.</div></div>}
      </div>
      <h2>Popular searches</h2>
      <div className="links">{["Driver", "Delivery boy", "Cook", "Housemaid", "Home nurse", "Security guard", "Sales executive", "Telecaller", "Fitness trainer", "Electrician", "Accountant", "Receptionist"].map((r) => <a key={r} href={`/jobs-in-kochi?role=${encodeURIComponent(r)}`}>{r} jobs</a>)}</div>
    </Page>
  );
}
export async function getServerSideProps({ query, res }) {
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  const role = ROLES.includes(query.role) ? query.role : "";
  const area = String(query.area || "").slice(0, 40), q = String(query.q || "").slice(0, 60);
  let jobs = [];
  try { const { liveJobs } = await import("../lib/jobportal.js"); jobs = await liveJobs({ role: role || undefined, area: area || undefined, q: q || undefined }); } catch {}
  return { props: { jobs, role, area, q } };
}

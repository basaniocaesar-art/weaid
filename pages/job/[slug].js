/** /job/<slug> — one job, with Google JobPosting data (Google for Jobs) and Apply. */
import { supabase } from "../../lib/supabase.js";
import { publicJob } from "../../lib/jobs-config.js";
import { SITE } from "../../lib/seo-config.js";
import { Page, crumbsLd } from "../../components/Seo.js";

const money = (a, b) => (a ? `₹${a.toLocaleString("en-IN")}${b && b !== a ? ` – ₹${b.toLocaleString("en-IN")}` : ""}` : "");
export default function Job({ j, open }) {
  const path = `/job/${j.slug}`;
  const ld = {
    "@context": "https://schema.org", "@type": "JobPosting", title: j.title, description: (j.description || j.title).replace(/\n/g, "<br>"),
    datePosted: j.posted, validThrough: j.expires, employmentType: { full_time: "FULL_TIME", part_time: "PART_TIME", contract: "CONTRACTOR" }[j.type] || "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: j.household ? "Private household (via WeAid)" : j.employer },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: j.area, addressRegion: "Kerala", addressCountry: "IN" } },
    ...(j.salaryMin && { baseSalary: { "@type": "MonetaryAmount", currency: "INR", value: { "@type": "QuantitativeValue", minValue: j.salaryMin, maxValue: j.salaryMax || j.salaryMin, unitText: "MONTH" } } }),
    directApply: true,
  };
  return (
    <Page title={`${j.title} job in ${j.area} — ${money(j.salaryMin, j.salaryMax)} | WeAid Jobs`} description={`${j.title} at ${j.household ? "a household" : j.employer} in ${j.area}, Kochi. ${money(j.salaryMin, j.salaryMax)} a month. Apply free on WeAid Jobs.`} path={path}
      jsonLd={open ? [ld, crumbsLd([["Jobs in Kochi", "/jobs-in-kochi"], [j.title, path]])] : [crumbsLd([["Jobs in Kochi", "/jobs-in-kochi"], [j.title, path]])]}>
      <div className="crumb"><a href="/jobs-in-kochi">Jobs in Kochi</a>{j.role ? <> › <a href={`/jobs-in-kochi?role=${encodeURIComponent(j.role)}`}>{j.role}</a></> : null}</div>
      <h1>{j.title}</h1>
      <p className="lead">{j.household ? "Household" : j.employer} · {j.area}</p>
      <div className="box">
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f766e" }}>{money(j.salaryMin, j.salaryMax)} <span className="meta" style={{ fontWeight: 400 }}>a month</span></div>
        <div className="meta" style={{ marginTop: 6 }}>{[j.type?.replace("_", " "), j.experience && `Experience: ${j.experience}`, j.education && `Education: ${j.education}`, j.shift && `Shift: ${j.shift}`, j.openings > 1 && `${j.openings} openings`, j.gender && j.gender !== "any" && `${j.gender} candidates`].filter(Boolean).join(" · ")}</div>
      </div>
      {j.description && <><h2>About the job</h2><p style={{ whiteSpace: "pre-wrap", fontSize: 16 }}>{j.description}</p></>}
      {open ? <>
        <div id="applyBox" className="box" style={{ marginTop: 18, borderColor: "#99f6e4", background: "#f0fdfa" }}>
          <button id="applyBtn" className="btn call" style={{ display: "block", width: "100%", cursor: "pointer", fontSize: 17 }}>Apply now — free</button>
          <div className="meta" id="applyMsg" style={{ marginTop: 8 }}>The employer gets your profile and phone number. WeAid never asks candidates for money — report any employer who does.</div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: `
(function(){var t=null;try{t=localStorage.getItem('weaid_cand')}catch(e){}
var b=document.getElementById('applyBtn'),m=document.getElementById('applyMsg');
b.onclick=async function(){ if(!t){ location.href='/candidate?apply=${j.id}&back=${encodeURIComponent(path)}'; return; }
 b.disabled=true; b.textContent='Applying…';
 var r=await fetch('/api/jp/apply',{method:'POST',headers:{'Content-Type':'application/json','X-Cand-Token':t},body:JSON.stringify({jobId:'${j.id}'})});
 var d=await r.json().catch(function(){return{}});
 if(r.status===401){ location.href='/candidate?apply=${j.id}&back=${encodeURIComponent(path)}'; return; }
 b.textContent=r.ok?'✓ Applied':'Apply now — free'; b.disabled=r.ok; m.innerHTML=r.ok?'Done! The employer has your profile. Track it in <a href="/candidate">your profile</a>.':(d.error||'Something went wrong.'); };})();` }} />
      </> : <div className="box" style={{ marginTop: 18 }}><b>This job is closed.</b> <a href={`/jobs-in-kochi${j.role ? `?role=${encodeURIComponent(j.role)}` : ""}`}>See similar jobs →</a></div>}
      <p className="meta" style={{ marginTop: 18 }}>Posted {new Date(j.posted).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} on WeAid Jobs · <a href="/hire">Hiring? Post a job</a></p>
    </Page>
  );
}
export async function getServerSideProps({ params, res }) {
  const { data } = await supabase.from("jp_jobs").select("*, jp_employers!inner(business_name, kind)").eq("slug", params.slug).maybeSingle();
  if (!data || !["live", "closed", "paused"].includes(data.status)) return { notFound: true };
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  const open = data.status === "live" && Date.parse(data.expires_at) > Date.now();
  return { props: { j: { ...publicJob(data), expires: data.expires_at }, open } };
}

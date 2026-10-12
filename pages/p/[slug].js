/**
 * /p/[slug] — a provider's public profile, server-rendered (it used to load by
 * JavaScript, so Google saw an empty page). Same features as before: call /
 * WhatsApp (logged as leads), WeAid reviews and a form to leave one.
 */
import { useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { SERVICES, SITE, slugify } from "../../lib/seo-config.js";
import { loadDirectory, serviceAreaPages, publicProvider } from "../../lib/seo.js";
import { Page, crumbsLd } from "../../components/Seo.js";

function logLead(providerId, channel, service) {
  try { navigator.sendBeacon("/api/provider/lead", new Blob([JSON.stringify({ providerId, channel, service, city: "Kochi" })], { type: "application/json" })); } catch {}
}

function ReviewForm({ providerId }) {
  const [state, setState] = useState({ name: "", rating: 0, comment: "", sent: false, err: "" });
  async function submit(e) {
    e.preventDefault();
    if (!state.name.trim() || !state.rating) return setState({ ...state, err: "Please add your name and a star rating." });
    const r = await fetch("/api/provider/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, customerName: state.name.trim(), rating: state.rating, comment: state.comment.trim() }) });
    setState(r.ok ? { ...state, sent: true, err: "" } : { ...state, err: "Couldn't send — please try again." });
  }
  if (state.sent) return <div className="box">Thanks — your review is posted.</div>;
  return (
    <form onSubmit={submit} className="box" style={{ display: "grid", gap: 10 }}>
      <b>Leave a review</b>
      <div style={{ fontSize: 26, cursor: "pointer", color: "#b45309" }}>
        {[1, 2, 3, 4, 5].map((n) => <span key={n} onClick={() => setState({ ...state, rating: n })}>{n <= state.rating ? "★" : "☆"}</span>)}
      </div>
      <input placeholder="Your name" value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} style={{ padding: 10, borderRadius: 10, border: "1px solid #e7ebf0", font: "inherit" }} />
      <textarea placeholder="How was the work? (optional)" rows={3} value={state.comment} onChange={(e) => setState({ ...state, comment: e.target.value })} style={{ padding: 10, borderRadius: 10, border: "1px solid #e7ebf0", font: "inherit" }} />
      {state.err && <div style={{ color: "#b91c1c", fontSize: 14 }}>{state.err}</div>}
      <button className="btn call" style={{ cursor: "pointer" }}>Post review</button>
    </form>
  );
}

export default function Profile({ p, reviews, links, areas }) {
  const svcNames = p.services.map((s) => SERVICES[s]?.plural).filter(Boolean);
  const area = p.areas[0] || "Kochi";
  const wa = p.whatsapp ? `https://wa.me/${p.whatsapp.length === 10 ? "91" + p.whatsapp : p.whatsapp}?text=${encodeURIComponent(`Hi ${p.name}, I found you on WeAid.`)}` : null;
  const own = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : null;
  const path = `/p/${p.slug}`;
  const ld = {
    "@context": "https://schema.org", "@type": "LocalBusiness", name: p.name, url: `${SITE}${path}`,
    ...(p.phone && { telephone: p.phone }),
    address: { "@type": "PostalAddress", addressLocality: area, addressRegion: "Kerala", addressCountry: "IN" },
    areaServed: p.areas.join(", "),
    // Only WeAid's own reviews may be marked up — never ratings copied from Google.
    ...(own && { aggregateRating: { "@type": "AggregateRating", ratingValue: own.toFixed(1), reviewCount: reviews.length } }),
  };
  return (
    <Page title={`${p.name.length > 45 ? p.name.slice(0, 44).replace(/[\s,&-]+\S*$/, "") + "…" : p.name} — ${svcNames[0] || "Services"} in ${area} | WeAid`}
      description={`${p.name}: ${svcNames.join(", ").toLowerCase()} in ${p.areas.join(", ")}, Kochi.${p.stars ? ` Rated ${p.stars.toFixed(1)}★ on Google.` : ""} Call or WhatsApp directly.`}
      path={path} areas={areas} jsonLd={[ld, crumbsLd([["Kochi", "/kochi"], ...(links[0] ? [[links[0].label, links[0].href]] : []), [p.name, path]])]}>
      <div className="crumb"><a href="/kochi">Kochi</a>{links[0] ? <> › <a href={links[0].href}>{links[0].label}</a></> : null} › {p.name}</div>
      <div>{p.featured && <span className="badge f">Featured</span>}{p.verified && <span className="badge">Verified</span>}</div>
      <h1>{p.name}</h1>
      <p className="lead">{svcNames.join(" · ")} in {p.areas.join(", ")}, Kochi</p>
      <p className="meta">
        {p.stars ? <><span className="stars">★ {p.stars.toFixed(1)}</span>{p.reviews ? ` · ${p.reviews.toLocaleString("en-IN")} Google reviews` : ""}</> : "New on WeAid"}
        {own ? ` · ${own.toFixed(1)}★ from ${reviews.length} WeAid review${reviews.length > 1 ? "s" : ""}` : ""}
        {p.years ? ` · ${p.years} years' experience` : ""}
      </p>
      <div className="btns" style={{ maxWidth: 520 }}>
        {p.phone && <a className="btn call" href={`tel:${p.phone}`} onClick={() => logLead(p.id, "call", p.services[0])}>📞 Call</a>}
        {wa && <a className="btn wa" href={wa} target="_blank" rel="noopener nofollow" onClick={() => logLead(p.id, "whatsapp", p.services[0])}>WhatsApp</a>}
      </div>
      {p.bio && <><h2>About</h2><p>{p.bio}</p></>}
      {links.length > 0 && <><h2>Find more like {p.name}</h2><div className="links">{links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</div></>}
      <h2>Reviews on WeAid</h2>
      {reviews.length ? reviews.map((r) => (
        <div key={r.id} className="box" style={{ marginBottom: 8 }}>
          <span className="stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> <b>{r.customer_name}</b>
          {r.comment && <p style={{ margin: "6px 0 0" }}>{r.comment}</p>}
        </div>
      )) : <p className="meta">No WeAid reviews yet — be the first.</p>}
      <div style={{ marginTop: 12 }}><ReviewForm providerId={p.id} /></div>
      <div className="box" style={{ marginTop: 24 }}>Is this your business? <a href="/list-business">Claim and update your listing →</a></div>
    </Page>
  );
}

export async function getStaticPaths() {
  return { paths: [], fallback: "blocking" }; // built on first visit, then cached
}

export async function getStaticProps({ params }) {
  const dir = await loadDirectory();
  const raw = dir.providers.find((x) => x.slug === params.slug);
  // Imported map listings never agreed to a public profile — only sign-ups / claimed.
  if (!raw || !raw.listable) return { notFound: true, revalidate: 3600 };
  const { data: reviews } = await supabase.from("provider_reviews").select("id,customer_name,rating,comment,created_at").eq("provider_id", raw.id).order("created_at", { ascending: false }).limit(20);
  const pages = new Set(serviceAreaPages(dir).map((x) => `${x.service}/${x.area}`));
  const links = [];
  for (const s of raw.services.filter((x) => SERVICES[x])) {
    for (const a of raw.areas) {
      const as = slugify(a);
      if (pages.has(`${s}/${as}`)) links.push({ href: `/kochi/${SERVICES[s].slug}/${as}`, label: `${SERVICES[s].plural} in ${a}` });
    }
    links.push({ href: `/kochi/${SERVICES[s].slug}`, label: `${SERVICES[s].plural} in Kochi` });
  }
  return {
    props: {
      p: publicProvider(raw), reviews: reviews || [], links,
      areas: Object.values(dir.areas).sort((a, b) => b.count - a.count).slice(0, 30).map((a) => ({ slug: a.slug, name: a.name })),
    },
    revalidate: 6 * 3600,
  };
}

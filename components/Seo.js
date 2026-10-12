/**
 * Shared pieces for the search-engine pages: page shell (head, header, footer
 * with links to every service and area), provider card, FAQ block.
 * Plain server-rendered HTML first — the buttons only add lead logging on tap.
 */
import Head from "next/head";
import { SERVICES, SITE } from "../lib/seo-config.js";

const css = `
:root{--ink:#0b0f14;--mut:#5b6573;--line:#e7ebf0;--bg:#f6f8fa;--teal:#0d9488;--teal-d:#0f766e;--star:#b45309}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"DM Sans",system-ui,-apple-system,sans-serif;line-height:1.55}
a{color:inherit}.w{max-width:1040px;margin:0 auto;padding:0 16px}
.top{background:#fff;border-bottom:1px solid var(--line)}.top .w{display:flex;align-items:center;justify-content:space-between;height:60px;gap:12px}
.logo{font-weight:800;font-size:22px;text-decoration:none;letter-spacing:-.02em}.logo b{color:var(--teal)}
.nav{display:flex;align-items:center;white-space:nowrap}.nav a{text-decoration:none;font-weight:600;font-size:14px;margin-left:16px;color:var(--mut)}.nav a.cta{background:var(--ink);color:#fff;padding:8px 14px;border-radius:10px}
@media(max-width:520px){.nav a.hub{display:none}.nav a.cta{padding:7px 11px;font-size:13px}}
.crumb{font-size:13px;color:var(--mut);margin:18px 0 6px}.crumb a{text-decoration:none;color:var(--mut)}.crumb a:hover{color:var(--ink)}
h1{font-size:clamp(26px,4.5vw,38px);line-height:1.15;letter-spacing:-.02em;margin:6px 0 10px}h2{font-size:21px;margin:30px 0 12px;letter-spacing:-.01em}
.lead{color:#334155;font-size:16.5px;max-width:760px;margin:0 0 6px}
.meta{color:var(--mut);font-size:14px}
.grid{display:grid;gap:12px;grid-template-columns:1fr}@media(min-width:760px){.grid{grid-template-columns:1fr 1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:6px}
.card h3{margin:0;font-size:17px;line-height:1.3}.card h3 a{text-decoration:none}.card h3 a:hover{text-decoration:underline}
.badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px;background:#ecfdf5;color:var(--teal-d);margin-right:6px}
.badge.f{background:#fef3c7;color:#92400e}
.stars{color:var(--star);font-weight:700}
.btns{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.btn{flex:1;min-width:120px;text-align:center;text-decoration:none;font-weight:700;font-size:14px;padding:10px 12px;border-radius:12px;border:1.5px solid var(--line);background:#fff}
.btn.wa{background:#25d366;border-color:#25d366;color:#fff}.btn.call{background:var(--ink);border-color:var(--ink);color:#fff}
.links{display:flex;flex-wrap:wrap;gap:8px}.links a{background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:14px;text-decoration:none;font-weight:600}.links a:hover{border-color:var(--teal);color:var(--teal-d)}
.box{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px 20px}
.box ul{margin:6px 0 0;padding-left:20px}
details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:8px}summary{font-weight:700;cursor:pointer}
.foot{margin-top:48px;background:#0b0f14;color:#cbd5e1;padding:32px 0 40px;font-size:14px}.foot a{color:#e2e8f0;text-decoration:none}.foot h4{color:#fff;margin:0 0 10px;font-size:14px}
.foot .cols{display:grid;gap:24px;grid-template-columns:1fr}@media(min-width:760px){.foot .cols{grid-template-columns:1fr 1fr 2fr}}
.foot .cols div a{display:inline-block;margin:0 12px 6px 0}
`;

export function Page({ title, description, path, jsonLd = [], children, areas = [] }) {
  const url = `${SITE}${path}`;
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:type" content="website" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
        {jsonLd.map((j, i) => (
          <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j) }} />
        ))}
      </Head>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <header className="top"><div className="w">
        <a className="logo" href="/">We<b>Aid</b></a>
        <nav className="nav"><a href="/kochi" className="hub">Services in Kochi</a><a href="/list-business" className="cta">List your business</a></nav>
      </div></header>
      <main className="w">{children}</main>
      <footer className="foot"><div className="w cols">
        <div><h4>WeAid</h4><p style={{ margin: 0 }}>Tell us what you need at home in Kochi — we arrange a trusted local pro, price upfront.</p><p><a href="/jobs-in-kochi">Jobs in Kochi →</a> · <a href="/hire">Hire staff →</a></p><p><a href="/guides">Guides: prices &amp; tips →</a></p><p><a href="/work">Work with WeAid — jobs in Kochi →</a></p><p style={{ fontSize: 13 }}><a href="/terms">Terms</a> · <a href="/refunds">Refunds</a> · <a href="/privacy">Privacy</a></p></div>
        <div><h4>Services in Kochi</h4>{Object.values(SERVICES).map((s) => <a key={s.slug} href={`/kochi/${s.slug}`}>{s.plural}</a>)}</div>
        <div><h4>Areas</h4>{areas.map((a) => <a key={a.slug} href={`/kochi/area/${a.slug}`}>{a.name}</a>)}</div>
      </div></footer>
    </>
  );
}

function logLead(providerId, channel, service) {
  try {
    navigator.sendBeacon("/api/provider/lead", new Blob([JSON.stringify({ providerId, channel, service, city: "Kochi" })], { type: "application/json" }));
  } catch {}
}

export function ProviderCard({ p, service, area }) {
  const svc = SERVICES[service] || SERVICES[p.services[0]];
  const wa = p.whatsapp ? `https://wa.me/${p.whatsapp.length === 10 ? "91" + p.whatsapp : p.whatsapp}?text=${encodeURIComponent(`Hi ${p.name}, I found you on WeAid. I need ${svc ? svc.trade : "help"}${area ? ` in ${area}` : ""}.`)}` : null;
  return (
    <article className="card" itemScope itemType="https://schema.org/LocalBusiness">
      <div>
        {p.featured && <span className="badge f">Featured</span>}
        {p.verified && <span className="badge">Verified</span>}
      </div>
      <h3 itemProp="name"><a href={`/p/${p.slug}`}>{p.name}</a></h3>
      <div className="meta">
        {p.stars ? <><span className="stars">★ {p.stars.toFixed(1)}</span>{p.reviews ? ` (${p.reviews.toLocaleString("en-IN")} Google reviews)` : ""} · </> : null}
        {p.services.map((s) => SERVICES[s]?.plural).filter(Boolean).join(", ")} · {p.areas.join(", ")}
      </div>
      {p.bio && <p style={{ margin: "4px 0 0", fontSize: 14, color: "#334155" }}>{p.bio.slice(0, 160)}</p>}
      <div className="btns">
        {p.phone && <a className="btn call" href={`tel:${p.phone}`} onClick={() => logLead(p.id, "call", service)}>📞 Call</a>}
        {wa && <a className="btn wa" href={wa} target="_blank" rel="noopener nofollow" onClick={() => logLead(p.id, "whatsapp", service)}>WhatsApp</a>}
        <a className="btn" href={`/p/${p.slug}`}>Profile</a>
      </div>
    </article>
  );
}

/** The main action: WeAid arranges the job (the customer doesn't ring round a list). */
const an = (w) => (/^(a|e|i|o|u|ac\b)/i.test(w) ? `an ${w}` : `a ${w}`);
export function Arrange({ count, svc, area, ask }) {
  const q = ask || `I need ${svc ? an(svc.one) : "help"}${area ? ` in ${area}` : ""}`;
  return (
    <div className="box" style={{ marginTop: 18, borderColor: "#99f6e4", background: "#f0fdfa" }}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Tell us what you need — we'll arrange it</div>
      <p style={{ margin: "6px 0 12px", color: "#334155" }}>
        {count ? `${count} ${svc ? svc.plural.toLowerCase() : "local pros"} work${count === 1 ? "s" : ""} in and around ${area || "Kochi"}. ` : ""}
        Describe the job, and WeAid finds an available pro near you and confirms the price before anyone comes. No calling round, no haggling.
      </p>
      <a className="btn call" style={{ display: "inline-block", maxWidth: 360 }} href={`/?q=${encodeURIComponent(q)}`}>Get {svc ? an(svc.one) : "a pro"}{area ? ` in ${area}` : ""} →</a>
    </div>
  );
}

export function HowItWorks() {
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
      {[["1. Tell us the job", "Type or talk — \"fan not working\", \"deep clean a 2BHK\", \"shift to Kakkanad\"."],
        ["2. We find someone near you", "WeAid matches an available pro close to you and shows the price upfront."],
        ["3. Pay & relax", "Pay securely when you book, so the price can't change on the day. Not happy with the work? We send someone else."]].map(([t, d]) => (
        <div key={t} className="card"><b>{t}</b><span className="meta">{d}</span></div>
      ))}
    </div>
  );
}

export function Faq({ items }) {
  return items.map(([q, a]) => (
    <details key={q}><summary>{q}</summary><p style={{ margin: "8px 0 0" }}>{a}</p></details>
  ));
}

export const faqLd = (items) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});
export const crumbsLd = (list) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: list.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}${path}` })),
});
export const listLd = (name, providers) => ({
  "@context": "https://schema.org", "@type": "ItemList", name,
  itemListElement: providers.slice(0, 30).map((p, i) => ({
    "@type": "ListItem", position: i + 1,
    item: {
      "@type": "LocalBusiness", name: p.name, url: `${SITE}/p/${p.slug}`,
      ...(p.phone && { telephone: p.phone }),
      address: { "@type": "PostalAddress", addressLocality: p.areas[0] || "Kochi", addressRegion: "Kerala", addressCountry: "IN" },
    },
  })),
});

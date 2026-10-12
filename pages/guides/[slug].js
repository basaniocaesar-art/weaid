/** /guides/<slug> — answers to what people search before booking, linking to the booking pages. */
import { GUIDES, GUIDE_BY_SLUG } from "../../lib/guides.js";
import { SERVICES, SITE } from "../../lib/seo-config.js";
import { Page, Arrange, crumbsLd } from "../../components/Seo.js";

export default function Guide({ g, svc, others }) {
  const path = `/guides/${g.slug}`;
  const article = { "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.description, dateModified: g.updated, datePublished: g.updated,
    author: { "@type": "Organization", name: "WeAid" }, publisher: { "@type": "Organization", name: "WeAid", logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` } }, mainEntityOfPage: `${SITE}${path}` };
  return (
    <Page title={`${g.title} | WeAid`} description={g.description} path={path} jsonLd={[article, crumbsLd([["Guides", "/guides"], [g.title, path]])]}>
      <div className="crumb"><a href="/guides">Guides</a> › {svc ? <a href={`/kochi/${svc.slug}`}>{svc.plural}</a> : null}</div>
      <h1>{g.title}</h1>
      <p className="meta">Updated {new Date(g.updated).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} · WeAid, Kochi</p>
      {g.sections.map(([h, body]) => (
        <section key={h}>
          <h2>{h}</h2>
          {Array.isArray(body) ? body.map((p, i) => <p key={i} style={{ fontSize: 16.5 }}>{p}</p>) : <div className="box"><ul>{body.list.map((li) => <li key={li} style={{ margin: "4px 0" }}>{li}</li>)}</ul></div>}
        </section>
      ))}
      {svc && <Arrange svc={svc} ask={g.ask + " in Kochi"} />}
      {svc && <p style={{ marginTop: 16 }}><a href={`/kochi/${svc.slug}`}>{svc.plural} in Kochi →</a></p>}
      <h2>More guides</h2>
      <div className="links">{others.map((o) => <a key={o.slug} href={`/guides/${o.slug}`}>{o.title}</a>)}</div>
    </Page>
  );
}
export async function getStaticPaths() { return { paths: GUIDES.map((g) => ({ params: { slug: g.slug } })), fallback: false }; }
export async function getStaticProps({ params }) {
  const g = GUIDE_BY_SLUG[params.slug];
  const s = SERVICES[g.service];
  return { props: { g, svc: s ? { slug: s.slug, plural: s.plural, one: s.one } : null, others: GUIDES.filter((x) => x.slug !== g.slug).map((x) => ({ slug: x.slug, title: x.title })) } };
}

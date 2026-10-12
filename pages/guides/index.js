/** /guides — WeAid's helpful guides for Kochi homes. */
import { GUIDES } from "../../lib/guides.js";
import { Page, crumbsLd } from "../../components/Seo.js";
export default function Guides({ list }) {
  return (
    <Page title="Home service guides for Kochi — prices, tips & checklists | WeAid" description="Honest guides for Kochi homes: what AC service, plumbers, home nurses, roofing and packers & movers cost, and what to check before you book." path="/guides" jsonLd={[crumbsLd([["Guides", "/guides"]])]}>
      <div className="crumb">Guides</div>
      <h1>Guides for Kochi homes</h1>
      <p className="lead">Real prices and practical advice, from the people who arrange the jobs.</p>
      {list.map((g) => <div key={g.slug} className="box" style={{ marginTop: 12 }}><a href={`/guides/${g.slug}`} style={{ fontWeight: 800, fontSize: 18, textDecoration: "none" }}>{g.title}</a><p className="meta" style={{ margin: "6px 0 0" }}>{g.description}</p></div>)}
    </Page>
  );
}
export async function getStaticProps() { return { props: { list: GUIDES.map((g) => ({ slug: g.slug, title: g.title, description: g.description })) } }; }

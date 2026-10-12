/** /work — "Work with WeAid": every trade we hire for in Kochi. */
import { SERVICES } from "../../lib/seo-config.js";
import { Page, crumbsLd } from "../../components/Seo.js";

export default function WorkHub({ trades }) {
  return (
    <Page title="Jobs in Kochi — work with WeAid (electricians, cooks, nurses, drivers & more)"
      description="Earn with WeAid in Kochi: electricians, plumbers, AC technicians, cleaners, painters, roofers, cooks, maids, babysitters, home nurses, elder carers, drivers and courier riders. Free to join; paid jobs come to your phone."
      path="/work" jsonLd={[crumbsLd([["Work with WeAid", "/work"]])]}>
      <div className="crumb">Work with WeAid</div>
      <h1>Work with WeAid in Kochi</h1>
      <p className="lead">Paid jobs near you, on your phone. Free to join. Choose your trade:</p>
      <div className="links" style={{ marginTop: 14 }}>{trades.map((t) => <a key={t.slug} href={`/work/${t.slug}`}>{t.label}</a>)}</div>
      <div className="box" style={{ marginTop: 22 }}><b>Ready?</b> <a href="/pro">Download WeAid Pro</a> — sign up, verify your ID, go online.</div>
    </Page>
  );
}

export async function getStaticProps() {
  const trades = [...Object.values(SERVICES).map((s) => ({ slug: s.slug, label: `${s.one[0].toUpperCase() + s.one.slice(1)} jobs` })), { slug: "courier-delivery", label: "Courier rider jobs" }];
  return { props: { trades } };
}

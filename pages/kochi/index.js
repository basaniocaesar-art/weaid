/** /kochi — every service and area WeAid covers in Kochi. */
import { SERVICES } from "../../lib/seo-config.js";
import { loadDirectory, providersFor, serviceAreaPages } from "../../lib/seo.js";
import { Page, Arrange, crumbsLd } from "../../components/Seo.js";

export default function Kochi({ services, areas, total }) {
  return (
    <Page title="Home services in Kochi — repairs, roofing, cooks, maids, nurses, drivers | WeAid"
      description={`Electricians, plumbers, AC repair, roofing, painting, home cooks, maids, babysitters, home nurses, elder care and drivers across Kochi — ID-checked and arranged by WeAid, price upfront.`}
      path="/kochi" areas={areas} jsonLd={[crumbsLd([["Kochi", "/kochi"]])]}>
      <div className="crumb">Kochi</div>
      <h1>Home services in Kochi</h1>
      <p className="lead">{total} local professionals across Kochi on WeAid — tell us what you need and we arrange someone near you, price upfront.</p>
      <Arrange count={total} ask="I need help at home in Kochi" />
      {services.map((s) => (
        <section key={s.slug}>
          <h2><a href={`/kochi/${s.slug}`} style={{ textDecoration: "none" }}>{s.plural} in Kochi{s.count >= 3 ? ` (${s.count})` : ""}</a></h2>
          <div className="links">{s.areas.map((a) => <a key={a.slug} href={`/kochi/${s.slug}/${a.slug}`}>{s.plural} in {a.name}</a>)}</div>
        </section>
      ))}
      <h2>All areas</h2>
      <div className="links">{areas.map((a) => <a key={a.slug} href={`/kochi/area/${a.slug}`}>{a.name}</a>)}</div>
    </Page>
  );
}

export async function getStaticProps() {
  const dir = await loadDirectory();
  const pages = serviceAreaPages(dir);
  return {
    props: {
      total: dir.providers.length,
      services: Object.entries(SERVICES).map(([k, s]) => ({
        slug: s.slug, plural: s.plural, count: providersFor(dir, k).length,
        areas: pages.filter((x) => x.service === k).sort((a, b) => b.count - a.count).map((x) => ({ slug: x.area, name: x.areaName })),
      })),
      areas: Object.values(dir.areas).filter((a) => a.count >= 3).sort((a, b) => b.count - a.count).map((a) => ({ slug: a.slug, name: a.name })),
    },
    revalidate: 6 * 3600,
  };
}

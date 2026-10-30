/** /kochi/area/kakkanad — every home service in one area. */
import { SERVICES } from "../../../lib/seo-config.js";
import { loadDirectory, providersFor, serviceAreaPages, nearbyAreas, publicProvider, listable } from "../../../lib/seo.js";
import { Page, ProviderCard, Arrange, HowItWorks, crumbsLd } from "../../../components/Seo.js";

export default function AreaHub({ area, sections, nearby, areas, total }) {
  const path = `/kochi/area/${area.slug}`;
  return (
    <Page title={`Home services in ${area.name}, Kochi — electricians, plumbers & more | WeAid`}
      description={`${total} local pros in ${area.name}, Kochi: ${sections.map((s) => s.plural.toLowerCase()).join(", ")}. Tell WeAid the job and we arrange someone nearby, price upfront.`}
      path={path} areas={areas} jsonLd={[crumbsLd([["Kochi", "/kochi"], [area.name, path]])]}>
      <div className="crumb"><a href="/kochi">Kochi</a> › {area.name}</div>
      <h1>Home services in {area.name}, Kochi</h1>
      <p className="lead">{total} local professionals work in and around {area.name}. Tell us what you need and WeAid arranges one.</p>
      <Arrange count={total} area={area.name} ask={`I need help at home in ${area.name}`} />
      <h2>How WeAid works</h2>
      <HowItWorks />
      {sections.map((s) => (
        <section key={s.slug}>
          <h2>{s.plural} in {area.name} ({s.count})</h2>
          {s.providers.length > 0 && <div className="grid">{s.providers.map((p) => <ProviderCard key={p.slug} p={p} service={s.key} area={area.name} />)}</div>}
          <div className="links">
            <a href={`/?q=${encodeURIComponent(`I need ${s.one === "AC technician" ? "an" : "a"} ${s.one} in ${area.name}`)}`}>Get {s.one === "AC technician" ? "an" : "a"} {s.one} →</a>
            {s.hasPage && <a href={`/kochi/${s.slug}/${area.slug}`}>{s.plural} in {area.name}</a>}
          </div>
        </section>
      ))}
      {nearby.length > 0 && <>
        <h2>Nearby areas</h2>
        <div className="links">{nearby.map((a) => <a key={a.slug} href={`/kochi/area/${a.slug}`}>{a.name}</a>)}</div>
      </>}
    </Page>
  );
}

export async function getStaticPaths() {
  const dir = await loadDirectory().catch(() => null);
  return { paths: dir ? Object.values(dir.areas).filter((a) => a.count >= 3).map((a) => ({ params: { area: a.slug } })) : [], fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  const dir = await loadDirectory();
  const area = dir.areas[params.area];
  if (!area || area.count < 3) return { notFound: true, revalidate: 3600 };
  const pages = new Set(serviceAreaPages(dir).map((x) => `${x.service}/${x.area}`));
  const sections = Object.entries(SERVICES).map(([key, s]) => {
    const list = providersFor(dir, key, area.slug);
    return { key, slug: s.slug, plural: s.plural, one: s.one, count: list.length, hasPage: pages.has(`${key}/${area.slug}`), providers: listable(list).slice(0, 4).map(publicProvider) };
  }).filter((s) => s.count > 0);
  return {
    props: {
      area: { slug: area.slug, name: area.name }, sections,
      total: dir.providers.filter((p) => p.areaSlugs.includes(area.slug)).length,
      nearby: nearbyAreas(dir, area.slug, 8).map((a) => ({ slug: a.slug, name: a.name })),
      areas: Object.values(dir.areas).sort((a, b) => b.count - a.count).slice(0, 30).map((a) => ({ slug: a.slug, name: a.name })),
    },
    revalidate: 6 * 3600,
  };
}

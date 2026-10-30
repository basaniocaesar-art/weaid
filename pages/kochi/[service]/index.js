/** /kochi/electricians — "Electricians in Kochi": every area page + the WeAid "we arrange it" action. */
import { SERVICES, SERVICE_BY_SLUG, MIN_PER_PAGE } from "../../../lib/seo-config.js";
import { loadDirectory, providersFor, serviceAreaPages, publicProvider, listable } from "../../../lib/seo.js";
import { Page, ProviderCard, Faq, Arrange, HowItWorks, faqLd, crumbsLd, listLd } from "../../../components/Seo.js";
import { GUIDES } from "../../../lib/guides.js";

export default function ServiceHub({ service, svc, providers, total, areaPages, areas }) {
  const path = `/kochi/${svc.slug}`;
  return (
    <Page title={`${svc.plural} in Kochi — ${svc.arranged ? "verified, price upfront" : "book by area"} | WeAid`}
      description={total >= MIN_PER_PAGE
        ? `Find ${total} ${svc.plural.toLowerCase()} across Kochi — ${areaPages.slice(0, 4).map((a) => a.name).join(", ")} and more. Tell WeAid the job and we arrange one near you, price upfront.`
        : `ID-checked ${svc.plural.toLowerCase()} in Kochi, arranged by WeAid. ${svc.price || "Price shown before you book."} Book online or call 080 6426 7771.`}
      path={path} areas={areas}
      jsonLd={[crumbsLd([["Kochi", "/kochi"], [svc.plural, path]]), ...(providers.length ? [listLd(`${svc.plural} in Kochi`, providers)] : []), faqLd(svc.faq)]}>
      <div className="crumb"><a href="/kochi">Kochi</a> › {svc.plural}</div>
      <h1>{svc.plural} in Kochi</h1>
      <p className="lead">{total >= MIN_PER_PAGE
        ? `${total} ${svc.plural.toLowerCase()} work across Kochi. Pick your area, or just tell us the job and we arrange the nearest available one. `
        : `WeAid arranges ID-checked ${svc.plural.toLowerCase()} across Kochi — Kakkanad, Edappally, Vyttila, Aluva, Fort Kochi and everywhere in between. You see who's coming, with their photo, before they arrive. `}{svc.price || ""}</p>
      <Arrange count={total >= MIN_PER_PAGE ? total : 0} svc={svc} />
      <h2>What our {svc.plural.toLowerCase()} can help with</h2>
      <div className="box"><ul>{(svc.jobs || []).map((j) => <li key={j}>{j[0].toUpperCase() + j.slice(1)}</li>)}</ul></div>
      <h2>How WeAid works</h2>
      <HowItWorks />
      {areaPages.length > 0 && <>
        <h2>{svc.plural} by area</h2>
        <div className="links">{areaPages.map((a) => <a key={a.slug} href={`/kochi/${svc.slug}/${a.slug}`}>{a.name} ({a.count})</a>)}</div>
      </>}
      {providers.length > 0 && <>
        <h2>{svc.plural} listed on WeAid</h2>
        <div className="grid">{providers.map((p) => <ProviderCard key={p.slug} p={p} service={service} />)}</div>
      </>}
      {GUIDES.filter((g) => g.service === service).map((g) => <div key={g.slug} className="box" style={{ marginTop: 18 }}>📘 <a href={`/guides/${g.slug}`} style={{ fontWeight: 700 }}>{g.title}</a></div>)}
      <h2>Questions people ask</h2>
      <Faq items={svc.faq} />
    </Page>
  );
}

export async function getStaticPaths() {
  return { paths: Object.values(SERVICES).map((s) => ({ params: { service: s.slug } })), fallback: false };
}

export async function getStaticProps({ params }) {
  const service = SERVICE_BY_SLUG[params.service];
  const dir = await loadDirectory();
  const svc = SERVICES[service];
  const all = providersFor(dir, service);
  return {
    props: {
      service, total: all.length,
      svc: { slug: svc.slug, plural: svc.plural, one: svc.one, faq: svc.faq, price: svc.price || null, jobs: svc.jobs || [], arranged: Boolean(svc.arranged) },
      providers: listable(all).slice(0, 20).map(publicProvider),
      areaPages: serviceAreaPages(dir).filter((x) => x.service === service).sort((a, b) => b.count - a.count).map((x) => ({ slug: x.area, name: x.areaName, count: x.count })),
      areas: Object.values(dir.areas).sort((a, b) => b.count - a.count).slice(0, 30).map((a) => ({ slug: a.slug, name: a.name })),
    },
    revalidate: 6 * 3600,
  };
}

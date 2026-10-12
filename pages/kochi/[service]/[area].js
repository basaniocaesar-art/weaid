/**
 * /kochi/electricians/kakkanad — "Electricians in Kakkanad, Kochi".
 * Server-rendered with the listings in the HTML; rebuilt every 6 hours (ISR) so new
 * providers and changes appear without a deploy. Only pages with enough providers exist.
 */
import { SERVICES, SERVICE_BY_SLUG, MIN_PER_PAGE, loadDirectory, providersFor, serviceAreaPages, nearbyAreas, publicProvider, listable } from "../../../lib/seo.js";
import { Page, ProviderCard, Faq, Arrange, HowItWorks, faqLd, crumbsLd, listLd } from "../../../components/Seo.js";

export default function ServiceArea({ service, svc, area, providers, count, nearby, otherServices, areas, stats }) {
  const title = `${svc.plural} in ${area.name}, Kochi — book a trusted ${svc.one} | WeAid`;
  const desc = `Need ${svc.one === "AC technician" ? "an" : "a"} ${svc.one} in ${area.name}, Kochi? ${count} ${svc.plural.toLowerCase()} work nearby${stats.avg ? ` (average ${stats.avg.toFixed(1)}★ on Google)` : ""}. Tell WeAid the job — we arrange it, price upfront.`;
  const faq = [
    [`How many ${svc.plural.toLowerCase()} are there in ${area.name}?`, `${count} ${svc.plural.toLowerCase()} work in and around ${area.name}${nearby.length ? `, with more in nearby ${nearby.slice(0, 3).map((a) => a.name).join(", ")}` : ""}. Tell WeAid what you need and we arrange the nearest available one.`],
    [`How do I book ${svc.one === "AC technician" ? "an" : "a"} ${svc.one} in ${area.name} on WeAid?`, `Tap "Get ${svc.one === "AC technician" ? "an" : "a"} ${svc.one} in ${area.name}", describe the job in a sentence, and WeAid finds an available ${svc.one} near you and confirms the price before they come.`],
    ...svc.faq,
  ];
  const path = `/kochi/${svc.slug}/${area.slug}`;
  return (
    <Page title={title} description={desc} path={path} areas={areas}
      jsonLd={[crumbsLd([["Kochi", "/kochi"], [svc.plural, `/kochi/${svc.slug}`], [area.name, path]]), ...(providers.length ? [listLd(`${svc.plural} in ${area.name}`, providers)] : []), faqLd(faq)]}>
      <div className="crumb"><a href="/kochi">Kochi</a> › <a href={`/kochi/${svc.slug}`}>{svc.plural}</a> › {area.name}</div>
      <h1>{svc.plural} in {area.name}, Kochi</h1>
      <p className="lead">
        {count} {svc.plural.toLowerCase()} work in and around {area.name}
        {stats.rated ? `, ${stats.rated} of them rated on Google${stats.avg ? ` (average ${stats.avg.toFixed(1)}★)` : ""}` : ""}.
        {" "}{svc.price || "You see the price before anyone comes."}
      </p>
      <p className="meta">Updated {stats.updated}</p>
      <Arrange count={count} svc={svc} area={area.name} />

      <h2>How WeAid works</h2>
      <HowItWorks />

      {providers.length > 0 && <>
        <h2>{svc.plural} listed on WeAid in {area.name}</h2>
        <div className="grid">{providers.map((p) => <ProviderCard key={p.slug} p={p} service={service} area={area.name} />)}</div>
      </>}

      <h2>What {svc.plural.toLowerCase()} in {area.name} can help with</h2>
      <div className="box"><ul>{svc.jobs.map((j) => <li key={j}>{j[0].toUpperCase() + j.slice(1)}</li>)}</ul></div>

      {nearby.length > 0 && <>
        <h2>{svc.plural} near {area.name}</h2>
        <div className="links">{nearby.map((a) => <a key={a.slug} href={a.hasPage ? `/kochi/${svc.slug}/${a.slug}` : `/kochi/area/${a.slug}`}>{a.hasPage ? `${svc.plural} in ${a.name}` : a.name}</a>)}</div>
      </>}

      {otherServices.length > 0 && <>
        <h2>Other services in {area.name}</h2>
        <div className="links">{otherServices.map((o) => <a key={o.slug} href={`/kochi/${o.slug}/${area.slug}`}>{o.plural} in {area.name}</a>)}</div>
      </>}

      <h2>Questions people ask</h2>
      <Faq items={faq} />

      <div className="box" style={{ marginTop: 24 }}>
        <b>Are you a {svc.one} in {area.name}?</b> List your business on WeAid for free and get calls from customers nearby. <a href="/list-business">List your business →</a>
      </div>
    </Page>
  );
}

export async function getStaticPaths() {
  const dir = await loadDirectory().catch(() => null);
  const paths = dir ? serviceAreaPages(dir).map((x) => ({ params: { service: x.serviceSlug, area: x.area } })) : [];
  return { paths, fallback: "blocking" };
}

export async function getStaticProps({ params }) {
  const service = SERVICE_BY_SLUG[params.service];
  if (!service) return { notFound: true, revalidate: 3600 };
  const dir = await loadDirectory();
  const area = dir.areas[params.area];
  if (!area) return { notFound: true, revalidate: 3600 };
  const list = providersFor(dir, service, area.slug);
  if (list.length < MIN_PER_PAGE) return { notFound: true, revalidate: 3600 };
  // Counted publicly, but only businesses that signed up are shown by name.
  const svc = SERVICES[service];
  const pages = new Set(serviceAreaPages(dir).map((x) => `${x.service}/${x.area}`));
  const rated = list.filter((p) => p.stars && p.reviews);
  return {
    props: {
      service,
      svc: { slug: svc.slug, plural: svc.plural, one: svc.one, trade: svc.trade, jobs: svc.jobs, faq: svc.faq, price: svc.price || null },
      area: { slug: area.slug, name: area.name },
      providers: listable(list).map(publicProvider),
      count: list.length,
      nearby: nearbyAreas(dir, area.slug).map((a) => ({ slug: a.slug, name: a.name, hasPage: pages.has(`${service}/${a.slug}`) })),
      otherServices: Object.entries(SERVICES).filter(([k]) => k !== service && pages.has(`${k}/${area.slug}`)).map(([, v]) => ({ slug: v.slug, plural: v.plural })),
      areas: Object.values(dir.areas).sort((a, b) => b.count - a.count).slice(0, 30).map((a) => ({ slug: a.slug, name: a.name })),
      stats: {
        rated: rated.length,
        avg: rated.length ? rated.reduce((n, p) => n + p.stars, 0) / rated.length : null,
        best: rated.length ? Math.max(...rated.map((p) => p.stars)) : null,
        updated: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
      },
    },
    revalidate: 6 * 3600,
  };
}

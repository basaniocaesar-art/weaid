/** /sitemap.xml — every search page and provider profile that may be public, for Google Search Console. */
import { SERVICES, SITE, loadDirectory, serviceAreaPages } from "../lib/seo.js";
import { GUIDES } from "../lib/guides.js";

export default function Sitemap() { return null; }

async function liveJobSlugs() {
  try {
    const { supabase } = await import("../lib/supabase.js");
    const { data } = await supabase.from("jp_jobs").select("slug").eq("status", "live").gt("expires_at", new Date().toISOString()).limit(1000);
    return (data || []).map((j) => j.slug).filter(Boolean);
  } catch { return []; }
}

export async function getServerSideProps({ res }) {
  const dir = await loadDirectory();
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ["/", "1.0"], ["/kochi", "0.9"], ["/directory", "0.6"], ["/list-business", "0.5"],
    ...Object.values(SERVICES).map((s) => [`/kochi/${s.slug}`, "0.9"]),
    ["/guides", "0.7"], ...GUIDES.map((g) => [`/guides/${g.slug}`, "0.7"]),
    ["/jobs-in-kochi", "0.8"], ["/home-nurse-jobs", "0.8"], ["/driver-jobs", "0.8"], ["/hotel-jobs", "0.8"], ["/sales-jobs", "0.8"], ["/office-jobs", "0.8"], ["/hire", "0.6"], ["/candidate", "0.5"],
    ...(await liveJobSlugs()).map((sl) => [`/job/${sl}`, "0.6"]),
    ["/work", "0.7"], ["/work/courier-delivery", "0.6"],
    ...Object.values(SERVICES).map((s) => [`/work/${s.slug}`, "0.6"]),
    ...serviceAreaPages(dir).map((x) => [`/kochi/${x.serviceSlug}/${x.area}`, "0.8"]),
    ...Object.values(dir.areas).filter((a) => a.count >= 3).map((a) => [`/kochi/area/${a.slug}`, "0.7"]),
    ...dir.providers.filter((p) => p.listable).map((p) => [`/p/${p.slug}`, "0.5"]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(([u, pr]) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><priority>${pr}</priority></url>`).join("\n")}\n</urlset>`;
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
  res.write(xml);
  res.end();
  return { props: {} };
}

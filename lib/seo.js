/**
 * Search-engine pages: one page per service per Kochi area ("Electricians in
 * Kakkanad"), hub pages per service and per area, and server-rendered provider
 * profiles — the IndiaMART pattern. Everything here is read on the SERVER so the
 * listings are in the HTML Google downloads, not loaded later by JavaScript.
 *
 * Only real, listed providers count: a slug, at least one area, not removed, in
 * Kochi. A service+area page exists only with MIN_PER_PAGE providers — thinner
 * pages read as doorway spam to Google and would hurt the whole site.
 */
import { supabase } from "./supabase.js";

import { SITE, MIN_PER_PAGE, SERVICES, SERVICE_BY_SLUG, slugify } from "./seo-config.js";
export { SITE, MIN_PER_PAGE, SERVICES, SERVICE_BY_SLUG, slugify };

let cache = null, cachedAt = 0;

/** All listed Kochi providers, with the indexes the pages need. Cached per instance for 10 min. */
export async function loadDirectory() {
  if (cache && Date.now() - cachedAt < 10 * 60e3) return cache;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("providers")
      .select("id,slug,name,phone,whatsapp,services,areas,city,bio,photo_url,years_experience,verified,featured,featured_until,google_rating,google_reviews,rating,review_count,lat,lng,website,created_at,source,claimed")
      .is("removed_at", null)
      .not("slug", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const now = Date.now();
  const providers = rows
    .filter((p) => (p.areas || []).length && (p.services || []).some((s) => SERVICES[s]))
    .filter((p) => !p.city || /kochi|cochin|ernakulam|kerala/i.test(p.city) || p.lat)
    .map((p) => ({
      ...p,
      areaSlugs: (p.areas || []).map(slugify),
      stars: Number(p.google_rating || p.rating) || null,
      reviews: Number(p.google_reviews || p.review_count) || 0,
      isFeatured: Boolean(p.featured && (!p.featured_until || Date.parse(p.featured_until) > now)),
      // Only businesses that signed up themselves may be shown by name and number.
      // The 645 imported from public map listings never agreed to be a lead list
      // (same rule as /directory: we count them, WeAid arranges the job).
      listable: p.source === "signup" || p.claimed === true,
    }));

  // area slug → display name and a centre point (for "nearby areas")
  const areas = {};
  for (const p of providers) {
    p.areas.forEach((name, i) => {
      const slug = p.areaSlugs[i];
      const a = (areas[slug] ||= { slug, name, lat: 0, lng: 0, n: 0, count: 0 });
      a.count++;
      if (typeof p.lat === "number" && typeof p.lng === "number") { a.lat += p.lat; a.lng += p.lng; a.n++; }
    });
  }
  for (const a of Object.values(areas)) if (a.n) { a.lat /= a.n; a.lng /= a.n; }

  cache = { providers, areas };
  cachedAt = Date.now();
  return cache;
}

/** Best first: featured, then Google rating weighted by how many reviews it has. */
export function rank(list) {
  const score = (p) => (p.isFeatured ? 100 : 0) + (p.stars || 0) * Math.min(1, Math.log10(1 + p.reviews) / 2);
  return [...list].sort((a, b) => score(b) - score(a) || (b.reviews - a.reviews));
}

export function providersFor(dir, service, areaSlug) {
  return rank(dir.providers.filter((p) => p.services.includes(service) && (!areaSlug || p.areaSlugs.includes(areaSlug))));
}

/** Every service+area pair with enough providers to deserve a page. */
export function serviceAreaPages(dir) {
  const out = [];
  for (const [key, svc] of Object.entries(SERVICES)) {
    for (const a of Object.values(dir.areas)) {
      const n = dir.providers.filter((p) => p.services.includes(key) && p.areaSlugs.includes(a.slug)).length;
      if (n >= MIN_PER_PAGE) out.push({ service: key, serviceSlug: svc.slug, area: a.slug, areaName: a.name, count: n });
    }
  }
  return out;
}

const km = (a, b) => {
  if (!a.n || !b.n) return Infinity;
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export function nearbyAreas(dir, areaSlug, limit = 6) {
  const a = dir.areas[areaSlug];
  if (!a) return [];
  return Object.values(dir.areas).filter((x) => x.slug !== areaSlug).sort((x, y) => km(a, x) - km(a, y)).slice(0, limit);
}

/** Only what a public page may show about a provider. */
export function publicProvider(p) {
  return {
    id: p.id, slug: p.slug, name: p.name, services: p.services.filter((s) => SERVICES[s]), areas: p.areas,
    stars: p.stars, reviews: p.reviews, verified: Boolean(p.verified), featured: p.isFeatured,
    phone: p.phone || null, whatsapp: (p.whatsapp || p.phone || "").replace(/\D/g, "") || null,
    bio: p.bio || null, photo: p.photo_url || null, years: p.years_experience || null, website: p.website || null,
  };
}

/** Providers who agreed to be listed publicly (signed up or claimed their listing). */
export const listable = (list) => list.filter((p) => p.listable);

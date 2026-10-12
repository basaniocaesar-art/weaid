// Geo distance helpers.
//
// haversineKm  → straight-line ("as the crow flies") distance. Fine for ranking
//                nearest drivers, but ALWAYS shorter than the real road route, so
//                never use it for the billed fare.
// roadDistanceKm → actual driving distance along roads, via the free OSRM router
//                (same OpenStreetMap ecosystem as our Nominatim geocoding, no API
//                key). Falls back to straight-line × a circuity factor if routing
//                is unavailable, so a fare is always produced.

const R = 6371; // Earth radius, km

export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Indian urban road networks run ~1.4× the straight-line distance on average.
// Only used when the live router can't be reached.
const CIRCUITY = 1.4;

export async function roadDistanceKm(lat1, lng1, lat2, lng2) {
  const straight = haversineKm(lat1, lng1, lat2, lng2);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "weaid.in" } });
    clearTimeout(timer);
    if (r.ok) {
      const d = await r.json();
      const meters = d?.routes?.[0]?.distance;
      if (typeof meters === "number" && meters > 0) return meters / 1000;
    }
  } catch (_) {
    /* routing unavailable — fall through to estimate */
  }
  return straight * CIRCUITY;
}

/**
 * Address → coordinates via OpenStreetMap Nominatim, biased to Kerala.
 * Returns { name, lat, lng } or null. Low volume only (Nominatim's 1 req/s policy).
 */
export async function geocode(text) {
  const q = String(text || "").trim();
  if (q.length < 3) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&viewbox=74.8,12.8,77.5,8.1&q=${encodeURIComponent(/kochi|kerala|ernakulam|thrissur|kozhikode|trivandrum/i.test(q) ? q : `${q}, Kochi, Kerala`)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "WeAid/1.0 (weaid.in)", "Accept-Language": "en" } });
    const d = await r.json();
    if (!d?.[0]) return null;
    return { name: q, lat: Number(d[0].lat), lng: Number(d[0].lon) };
  } catch {
    return null;
  }
}

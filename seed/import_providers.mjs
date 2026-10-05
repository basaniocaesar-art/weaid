/**
 * Load the swept Kochi providers into WeAid's directory.
 *
 * These are businesses listed publicly on Google Maps. None of them has agreed
 * to anything, so every row goes in as the schema already intends for exactly
 * this case:
 *
 *   source  'seed'   imported, not self-registered
 *   claimed  false   nobody has taken it over
 *   edit_token       the private link they use when they do
 *
 * Two things are deliberately NOT imported as WeAid data.
 *
 * Google's star rating and review count go into their own columns, not into
 * providers.rating. Showing somebody else's rating as ours would be a lie about
 * where it came from, and the first provider to notice would be right to be
 * angry about it.
 *
 * And nothing is marked verified. Verified has to mean somebody checked.
 *
 *   node seed/import_providers.mjs          # dry run, says what it would do
 *   node seed/import_providers.mjs --go     # write it
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GO = process.argv.includes("--go");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/** Minimal CSV reader: our own file, written by our own script, quoted fields. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/*
 * Slugs have to be unique, and name-plus-last-four is not enough.
 *
 * Two businesses called "Cool Care AC Service" whose numbers both end 4321
 * collide, and the import stopped 45 rows from the end when exactly that
 * happened. The full ten digits make it unique by construction, and the
 * counter is a belt-and-braces for a number that somehow appears twice.
 */
const baseSlug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "provider";

function uniqueSlug(name, phone, taken) {
  let slug = `${baseSlug(name)}-${phone}`;
  let n = 2;
  while (taken.has(slug)) slug = `${baseSlug(name)}-${phone}-${n++}`;
  taken.add(slug);
  return slug;
}

async function main() {
  const rows = parseCsv(readFileSync(join(HERE, "providers.csv"), "utf8"));
  console.log(`${rows.length} rows in providers.csv`);

  // Anyone already in the directory stays untouched. A provider who signed up
  // themselves must never be overwritten by a scraped listing of the same shop.
  const { data: existing, error: exErr } = await supabase.from("providers").select("phone, slug").limit(5000);
  if (exErr) throw new Error(`Could not read existing providers: ${exErr.message}`);
  const have = new Set((existing || []).map((p) => String(p.phone || "").replace(/\D/g, "").slice(-10)));
  const takenSlugs = new Set((existing || []).map((p) => p.slug).filter(Boolean));
  console.log(`${have.size} providers already in the directory`);

  const toInsert = [];
  for (const r of rows) {
    const ten = r.phone.replace(/\D/g, "").slice(-10);
    if (!ten || have.has(ten)) continue;
    have.add(ten);
    toInsert.push({
      name: r.name,
      slug: uniqueSlug(r.name, ten, takenSlugs),
      phone: `+91${ten}`,
      whatsapp: `+91${ten}`,
      city: "kochi",
      areas: r.area ? [r.area] : [],
      services: r.services.split("|").filter(Boolean),
      bio: r.address || null,
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      years_experience: null,
      // Not ours to claim, either of them.
      verified: false,
      rating: 0,
      review_count: 0,
      google_rating: r.rating ? Number(r.rating) : null,
      google_reviews: r.reviews ? Number(r.reviews) : null,
      google_place_id: r.place_id || null,
      website: r.website || null,
      source: "seed",
      claimed: false,
      available: true,
    });
  }

  console.log(`${toInsert.length} new providers to add`);
  const byService = {};
  for (const p of toInsert) for (const s of p.services) byService[s] = (byService[s] || 0) + 1;
  for (const [s, n] of Object.entries(byService).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);

  if (!GO) {
    console.log("\nDry run. Re-run with --go to write them.");
    return;
  }

  let done = 0;
  for (let i = 0; i < toInsert.length; i += 100) {
    const batch = toInsert.slice(i, i + 100);
    const { error } = await supabase.from("providers").insert(batch);
    if (error) {
      // Said loudly rather than swallowed: a half-imported directory that looks
      // complete is worse than one that obviously failed.
      console.error(`\nFAILED at row ${i}: ${error.message}`);
      console.error(`${done} were written before this. Fix and re-run: already-imported numbers are skipped.`);
      process.exit(1);
    }
    done += batch.length;
    console.log(`  written ${done}/${toInsert.length}`);
  }
  console.log(`\n${done} providers imported, all unclaimed.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

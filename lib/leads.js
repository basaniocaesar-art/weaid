/**
 * The owner's call list: businesses found on Google Maps who might become
 * WeAid pros, and what happened when he rang them.
 *
 * Kept in private storage, not a table and not the repo. The repo is public,
 * and these are other people's phone numbers; a table would mean another SQL
 * file for the owner to run before the tab worked. Two files:
 *
 *   leads.json   [{ p, n, c[], a, d, r, v, w }]  phone, name, services, area,
 *                address, rating, reviews, website (short keys: ~7,000 rows)
 *   status.json  { [phone]: { s, note, at } }   only the ones he has rung
 *
 * One person works this list, so read-modify-write on a JSON file is fine.
 */
import { supabase } from "./supabase.js";
import { AREAS } from "./concierge-tools.js";

const BUCKET = "ops-private";
export const LEAD_STATES = ["no_answer", "call_back", "interested", "joined", "not_interested", "wrong_number"];

const ten = (p) => String(p || "").replace(/\D/g, "").slice(-10);

async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (!data) await supabase.storage.createBucket(BUCKET, { public: false });
}

async function readJson(name, empty) {
  const { data, error } = await supabase.storage.from(BUCKET).download(name);
  if (error || !data) return empty;
  try { return JSON.parse(await data.text()); } catch { return empty; }
}

async function writeJson(name, value) {
  await ensureBucket();
  const { error } = await supabase.storage.from(BUCKET).upload(name, JSON.stringify(value), { upsert: true, contentType: "application/json", cacheControl: "0" });
  if (error) throw new Error(error.message);
}

/** "…, Kakkanad, Kochi, Keralam 682030" → "Kakkanad". Longest name first so "Ernakulam North" beats "Ernakulam". */
const BY_LENGTH = [...AREAS, "Tripunithura", "Paravur", "Kochi", "Ernakulam"].sort((a, b) => b.length - a.length);
export function areaOf(text) {
  const t = String(text || "").toLowerCase();
  const hit = BY_LENGTH.find((a) => t.includes(a.toLowerCase()));
  return hit === "Tripunithura" ? "Thripunithura" : hit === "Paravur" ? "North Paravur" : hit || "";
}

export async function listLeads() {
  const [leads, status] = await Promise.all([readJson("leads.json", []), readJson("status.json", {})]);
  return { leads, status };
}

/**
 * Add rows from a sweep's CSV. A number already on the list keeps its entry
 * and gains any new services, so re-importing a file never duplicates anyone.
 */
export async function importLeads(rows) {
  const leads = await readJson("leads.json", []);
  const byPhone = new Map(leads.map((l) => [l.p, l]));
  let added = 0;
  for (const r of rows || []) {
    const p = ten(r.phone);
    if (p.length !== 10) continue;
    const c = String(r.category || "").split(/[,/]/).map((x) => x.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
    const old = byPhone.get(p);
    if (old) { old.c = [...new Set([...old.c, ...c])]; continue; }
    const d = String(r.address || "").slice(0, 160);
    byPhone.set(p, {
      p, n: String(r.name || "").trim().slice(0, 100), c,
      a: areaOf(r.area) || areaOf(d) || String(r.area || "").trim().slice(0, 40), d,
      r: Number(r.rating) || null, v: Number(r.reviews) || 0, w: String(r.website || "").slice(0, 200),
    });
    added++;
  }
  const all = [...byPhone.values()];
  await writeJson("leads.json", all);
  return { added, total: all.length };
}

export async function setLeadStatus(phone, s, note) {
  const p = ten(phone);
  if (p.length !== 10) throw new Error("bad phone");
  if (s && !LEAD_STATES.includes(s)) throw new Error("bad status");
  const status = await readJson("status.json", {});
  if (!s && !note) delete status[p];
  else status[p] = { s: s || status[p]?.s || null, note: String(note ?? status[p]?.note ?? "").slice(0, 300), at: new Date().toISOString() };
  await writeJson("status.json", status);
  return status[p] || null;
}

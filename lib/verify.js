/**
 * Checking a pro's identity before they are sent into anybody's home.
 *
 *   1. ID selfie   — the pro holding a photo ID (driving licence, voter ID, PAN,
 *                    passport, or MASKED Aadhaar). Required.
 *   2. Police cert — Kerala Police clearance (Thuna). Optional; shown to the
 *                    owner, and a pro without one is "ID-checked", not
 *                    "police-verified".
 *
 * Claude reads each upload first. Obvious problems (blurry, wrong document,
 * expired, name mismatch) go straight back to the pro with a plain message, so
 * the owner only sees uploads worth looking at. A full, unmasked Aadhaar number
 * is never kept: the image is deleted the moment it is spotted and the pro is
 * asked for the masked version (UIDAI restricts who may hold Aadhaar copies).
 *
 * The AI never approves anyone. The owner approves, rejects with a reason the
 * pro sees, or asks for a WhatsApp video call when something is unclear.
 *
 * Retention (owner's decision, 7 Oct): an APPROVED pro's ID photo and police
 * certificate are KEPT as WeAid's record of who was sent into customers' homes,
 * in the private bucket, viewable only through 10-minute signed links in Ops.
 * The pro is told this before uploading. Retakes and rejected uploads are
 * deleted; a full Aadhaar is never stored at all.
 *
 * Storage: private bucket "pro-verification", pros/<id>/{id,pcc}.<ext> and
 * pros/<id>/check.json. providers.kyc_status only allows
 * none/submitted/verified/rejected, so the finer state lives in check.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase.js";
import { sendAdminNotification } from "./email.js";
import { opsLink } from "./followup.js";

const BUCKET = "pro-verification";
const MODEL = process.env.VERIFY_MODEL || "claude-sonnet-5-5";
const client = new Anthropic();
const dir = (pid) => `pros/${pid}`;

export const ID_TYPES = { driving_licence: "Driving licence", voter_id: "Voter ID", pan: "PAN card", passport: "Passport", masked_aadhaar: "Masked Aadhaar" };

export async function readCheck(pid) {
  // A fresh signed URL each time, so a cached copy is never served.
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(`${dir(pid)}/check.json`, 60);
  if (!signed?.signedUrl) return null;
  const r = await fetch(`${signed.signedUrl}&fresh=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}
async function writeCheck(pid, check) {
  const body = new Blob([JSON.stringify(check)], { type: "application/json" });
  const { error } = await supabase.storage.from(BUCKET).upload(`${dir(pid)}/check.json`, body, { upsert: true, contentType: "application/json", cacheControl: "0" });
  if (error) throw new Error(`save check: ${error.message}`);
}
async function removeImages(pid) {
  const { data } = await supabase.storage.from(BUCKET).list(dir(pid));
  const files = (data || []).map((f) => f.name).filter((n) => n !== "check.json").map((n) => `${dir(pid)}/${n}`);
  if (files.length) await supabase.storage.from(BUCKET).remove(files);
}

/* ---------- the AI read ---------- */

const ID_TOOL = {
  name: "id_check",
  description: "Report what the photo shows.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["document_type", "full_aadhaar_number_visible", "person_holding_document", "face_visible", "document_readable", "name_on_document", "name_matches", "face_resemblance", "expired", "looks_edited", "problems", "verdict", "message_to_pro", "summary_for_owner"],
    properties: {
      document_type: { type: "string", enum: ["driving_licence", "voter_id", "pan", "passport", "masked_aadhaar", "full_aadhaar", "other", "none"] },
      full_aadhaar_number_visible: { type: "boolean", description: "True if all 12 Aadhaar digits can be read (not masked as XXXX XXXX 1234)." },
      person_holding_document: { type: "boolean" },
      face_visible: { type: "boolean", description: "The person's face is clearly visible in the photo." },
      document_readable: { type: "boolean", description: "Name and photo on the document can be read." },
      name_on_document: { type: "string", description: "The name as printed, or empty." },
      name_matches: { type: "string", enum: ["yes", "partly", "no", "unreadable"], description: "Against the sign-up name. Business names (e.g. 'Suresh Electricals') match if the person's name is part of it." },
      face_resemblance: { type: "string", enum: ["likely_same", "unclear", "likely_different", "cannot_tell"], description: "Does the person holding the card resemble the photo on the card? This is a rough visual impression only." },
      expired: { type: "string", enum: ["no", "yes", "no_expiry_shown"] },
      looks_edited: { type: "boolean", description: "Signs of tampering: mismatched fonts, pasted photo, screen photo of a document, digital edits." },
      problems: { type: "array", items: { type: "string" }, description: "Short plain-English problems, empty if none." },
      verdict: { type: "string", enum: ["ok", "redo", "review"], description: "ok = clear and consistent; redo = the pro must retake (blurry, wrong document, face hidden, full Aadhaar, expired, no document); review = readable but something needs a human (name/face mismatch, possible edit)." },
      message_to_pro: { type: "string", description: "One or two short friendly sentences telling the pro what to do, if verdict is redo or review. Never mention face matching or suspicion of fraud." },
      summary_for_owner: { type: "string", description: "One line for the WeAid owner. NEVER include any ID number." },
    },
  },
};

const PHOTO_TOOL = {
  name: "photo_check",
  description: "Report whether this works as the pro's profile photo shown to customers.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["one_clear_face", "face_unobstructed", "appropriate", "verdict", "message_to_pro", "summary_for_owner"],
    properties: {
      one_clear_face: { type: "boolean", description: "Exactly one person, face clearly visible, front-on." },
      face_unobstructed: { type: "boolean", description: "No sunglasses, mask or helmet hiding the face." },
      appropriate: { type: "boolean", description: "A normal, decent photo suitable to show customers." },
      verdict: { type: "string", enum: ["ok", "redo", "review"] },
      message_to_pro: { type: "string" },
      summary_for_owner: { type: "string" },
    },
  },
};

const PCC_TOOL = {
  name: "pcc_check",
  description: "Report what the police clearance certificate shows.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false,
    required: ["is_police_clearance", "issuer", "name_on_certificate", "name_matches", "issue_date", "adverse_remarks", "readable", "looks_edited", "verdict", "message_to_pro", "summary_for_owner"],
    properties: {
      is_police_clearance: { type: "boolean" },
      issuer: { type: "string", description: "e.g. 'Kerala Police (Thuna)', or what it says." },
      name_on_certificate: { type: "string" },
      name_matches: { type: "string", enum: ["yes", "partly", "no", "unreadable"] },
      issue_date: { type: "string", description: "YYYY-MM-DD if shown, else empty." },
      adverse_remarks: { type: "string", enum: ["none", "has_remarks", "unclear"], description: "Any cases, convictions or remarks listed against the person." },
      readable: { type: "boolean" },
      looks_edited: { type: "boolean" },
      verdict: { type: "string", enum: ["ok", "redo", "review"] },
      message_to_pro: { type: "string" },
      summary_for_owner: { type: "string", description: "One line. NEVER include certificate or ID numbers." },
    },
  },
};

function block(mime, b64) {
  return mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
}

async function aiRead(step, mime, b64, signupName, claimedType) {
  const tool = step === "id" ? ID_TOOL : step === "photo" ? PHOTO_TOOL : PCC_TOOL;
  const text = step === "id"
    ? `A home-services worker signing up to WeAid (Kochi, Kerala) sent this photo of themselves holding a photo ID. Sign-up name: "${signupName}". They said it is: ${ID_TYPES[claimedType] || claimedType || "not stated"}.
Accepted: driving licence, voter ID, PAN, passport, or MASKED Aadhaar (only the last 4 digits shown). A full Aadhaar with all 12 digits readable is NOT accepted — verdict redo, ask for the masked one from myaadhaar.uidai.gov.in.
Check the person is holding the card, their face and the card are both clear, and the name fits the sign-up name. Be practical: Indian names vary in order, initials and spelling. Today is ${new Date().toISOString().slice(0, 10)}.`
    : step === "photo"
    ? `A home-services worker signing up to WeAid (Kochi, Kerala) took this as their profile photo. Customers will see it before the pro arrives, to check it's the right person at their door. It should be a clear, front-on photo of just their face and shoulders, no sunglasses or helmet.`
    : `A home-services worker signing up to WeAid (Kochi, Kerala) uploaded a police clearance certificate. Sign-up name: "${signupName}". Check it is a police clearance / character certificate (Kerala Police Thuna or similar), the name fits, how recent it is, and whether any adverse remarks are listed. Older than 12 months → review. Today is ${new Date().toISOString().slice(0, 10)}.`;
  // Structured output: the reply is JSON matching the schema (forced tool_choice
  // is not available on this model).
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: tool.input_schema } },
    messages: [{ role: "user", content: [block(mime, b64), { type: "text", text: `${text}\n\n${tool.description}` }] }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Couldn't check that file. Please try another photo.");
  const out = msg.content.find((c) => c.type === "text");
  if (!out) throw new Error("no result");
  return JSON.parse(out.text);
}

/* ---------- pro side ---------- */

const MIMES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export async function submitUpload(pro, { step, mime, data, idType }) {
  if (!["id", "pcc", "photo"].includes(step)) throw new Error("Unknown step.");
  if (!MIMES[mime]) throw new Error("Please upload a photo (JPG/PNG) or a PDF.");
  if (step !== "pcc" && mime === "application/pdf") throw new Error("Please take a photo with your camera.");
  const b64 = String(data || "").replace(/^data:[^,]+,/, "");
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length < 5_000) throw new Error("That file looks empty. Please try again.");
  if (bytes.length > 4_500_000) throw new Error("That file is too big. Please take a smaller photo.");

  // Drivers are trusted with customers' cars: their ID must be a driving licence.
  const isDriver = (pro.services || []).some((x) => x === "driver" || x === "carpool");
  if (step === "id" && isDriver && idType && idType !== "driving_licence") {
    throw new Error("Drivers must verify with their driving licence. Please choose Driving licence and take the photo with it.");
  }
  const result = await aiRead(step, mime, b64, pro.name, idType);
  if (step === "id" && isDriver && result.verdict !== "redo" && result.document_type !== "driving_licence") {
    result.verdict = "redo";
    result.message_to_pro = "Drivers must verify with a driving licence. Please retake the photo holding your licence.";
    result.summary_for_owner = `Driver sent a ${result.document_type} instead of a driving licence — asked to redo.`;
  }
  const check = (await readCheck(pro.id)) || { steps: {} };
  const path = `${dir(pro.id)}/${step}.${MIMES[mime]}`;

  // Never keep a full Aadhaar, and don't keep photos that have to be retaken:
  // only uploads a human will actually look at are stored.
  const fullAadhaar = step === "id" && (result.full_aadhaar_number_visible || result.document_type === "full_aadhaar");
  if (fullAadhaar) {
    result.verdict = "redo";
    result.message_to_pro = "Please don't send your full Aadhaar. Download the masked Aadhaar (only the last 4 digits show) from myaadhaar.uidai.gov.in, or use your driving licence, voter ID or PAN card instead.";
    result.summary_for_owner = "Sent a full Aadhaar — not stored; asked for masked Aadhaar or another ID.";
  }
  const { data: old } = await supabase.storage.from(BUCKET).list(dir(pro.id));
  const stale = (old || []).map((f) => f.name).filter((n) => n.startsWith(`${step}.`)).map((n) => `${dir(pro.id)}/${n}`);
  if (stale.length) await supabase.storage.from(BUCKET).remove(stale);
  const keep = result.verdict !== "redo";
  if (keep) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { upsert: true, contentType: mime, cacheControl: "0" });
    if (error) throw new Error(`upload: ${error.message}`);
  }

  check.steps[step] = { at: new Date().toISOString(), idType: idType || null, path: keep ? path : null, result };
  check.decision = null;
  const done = (k) => check.steps[k] && check.steps[k].result.verdict !== "redo";
  const anyRedo = ["id", "photo", "pcc"].some((k) => check.steps[k]?.result.verdict === "redo");
  check.state = anyRedo ? "redo" : done("id") && done("photo") ? "review" : "start";
  await writeCheck(pro.id, check);
  await supabase.from("providers").update({ kyc_status: "submitted", kyc_submitted_at: new Date().toISOString(), kyc_id_type: step === "id" ? (idType || result.document_type) : undefined }).eq("id", pro.id);

  if (check.state === "review" && !check.notified) {
    check.notified = true; await writeCheck(pro.id, check);
    await sendAdminNotification(`[WeAid] ID ready to review — ${pro.name}`,
      `<p style="font-family:sans-serif"><b>${pro.name}</b> ${pro.phone || ""}<br>Photo: ${check.steps.photo.result.summary_for_owner}<br>ID: ${check.steps.id.result.summary_for_owner}${check.steps.pcc ? `<br>Police cert: ${check.steps.pcc.result.summary_for_owner}` : "<br>No police certificate yet."}<br><br><a href="${opsLink()}">Open WeAid Ops → Pros</a> to approve, reject or request a WhatsApp video call.</p>`).catch(() => {});
  }
  return statusFor(pro, check);
}

/** What the pro's app shows. */
export function statusFor(pro, check) {
  const s = (k) => check?.steps?.[k] ? { verdict: check.steps[k].result.verdict, message: check.steps[k].result.verdict === "ok" ? "" : check.steps[k].result.message_to_pro, at: check.steps[k].at } : null;
  return {
    approved: Boolean(pro.verified),
    state: pro.verified ? "approved" : check?.decision?.type === "rejected" ? "rejected" : check?.state || "start",
    id: s("id"),
    photo: s("photo"),
    pcc: s("pcc"),
    note: check?.decision?.note || "",
  };
}

/* ---------- owner side ---------- */

export async function ownerView(pid) {
  const check = await readCheck(pid);
  if (!check) return null;
  const out = { state: check.state, decision: check.decision || null, steps: {} };
  for (const [k, v] of Object.entries(check.steps || {})) {
    let url = null;
    if (v.path) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(v.path, 600);
      url = data?.signedUrl || null;
    }
    const r = v.result;
    out.steps[k] = {
      at: v.at, url, idType: v.idType, verdict: r.verdict, summary: r.summary_for_owner, problems: r.problems || [],
      ...(k === "photo" ? {} : k === "id" ? { name: r.name_on_document, nameMatches: r.name_matches, face: r.face_resemblance, expired: r.expired, edited: r.looks_edited, docType: r.document_type }
        : { issuer: r.issuer, name: r.name_on_certificate, nameMatches: r.name_matches, issued: r.issue_date, remarks: r.adverse_remarks, edited: r.looks_edited }),
    };
  }
  return out;
}

export async function decide(pid, decision, note = "") {
  const { data: pro } = await supabase.from("providers").select("id,name,phone,verified").eq("id", pid).maybeSingle();
  if (!pro) throw new Error("no such pro");
  const check = (await readCheck(pid)) || { steps: {} };
  const at = new Date().toISOString();

  if (decision === "call") {
    check.state = "call"; check.decision = { type: "call", at, note: note || "WeAid will call you on WhatsApp video to finish checking your ID. Please keep your ID card with you." };
    await writeCheck(pid, check);
    const ten = String(pro.phone || "").replace(/\D/g, "").slice(-10);
    const text = `Hi ${pro.name}, this is WeAid. To finish your verification, can we do a quick WhatsApp video call (2 minutes)? Please keep your ID card with you. When is a good time today?`;
    return { ok: true, whatsapp: ten.length === 10 ? `https://wa.me/91${ten}?text=${encodeURIComponent(text)}` : null };
  }

  const approved = decision === "approve";
  const pcc = check.steps?.pcc?.result;
  const idType = check.steps?.id?.idType || check.steps?.id?.result?.document_type || null;
  // Approved: keep the ID as WeAid's record. Rejected: delete it.
  if (!approved) {
    await removeImages(pid);
    for (const v of Object.values(check.steps || {})) v.path = null;
  }
  check.state = approved ? "approved" : "rejected";
  check.decision = { type: approved ? "approved" : "rejected", at, note: approved ? "" : note || "Your verification wasn't accepted. Please call WeAid." };
  await writeCheck(pid, check);
  const label = [ID_TYPES[idType] || idType, pcc && pcc.verdict !== "redo" ? `police cert${pcc.issue_date ? ` ${pcc.issue_date}` : ""}` : null].filter(Boolean).join(" + ");
  await supabase.from("providers").update({ verified: approved, kyc_status: approved ? "verified" : "rejected", ...(label ? { kyc_id_type: label.slice(0, 80) } : {}) }).eq("id", pid);
  return { ok: true };
}


/**
 * What a customer may see about the pro coming to them: photo (10-minute
 * signed link), name and what WeAid has checked. Only for approved pros.
 */
export async function trustCard(providerId) {
  if (!providerId) return null;
  const { data: pro } = await supabase.from("providers").select("id,name,verified,kyc_status,kyc_id_type,years_experience,rating,review_count").eq("id", providerId).maybeSingle();
  if (!pro || !pro.verified) return null;
  const check = await readCheck(providerId);
  let photo = null;
  if (check?.steps?.photo?.path) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(check.steps.photo.path, 600);
    photo = data?.signedUrl || null;
  }
  const police = /police/i.test(pro.kyc_id_type || "");
  return {
    name: pro.name, photo,
    idChecked: pro.kyc_status === "verified",
    police,
    years: pro.years_experience || null,
    since: check?.decision?.type === "approved" ? check.decision.at : null,
  };
}

import { getSessionProvider } from "../../../lib/auth.js";
import { updateProvider } from "../../../lib/supabase.js";
import { sendAdminNotification } from "../../../lib/email.js";

// Provider submits ID for the "verified" badge. Manual review — no KYC vendor.
const ID_TYPES = ["aadhaar", "pan", "driving_license", "voter_id", "passport"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { user, provider } = await getSessionProvider(req);
    if (!user) return res.status(401).json({ error: "Not signed in" });
    if (!provider) return res.status(400).json({ error: "Create your listing before verifying." });

    const { idType, idNumber, docUrl } = req.body || {};
    if (!ID_TYPES.includes(idType)) return res.status(400).json({ error: "Choose a valid ID type." });
    if (!idNumber || idNumber.replace(/\s/g, "").length < 6) return res.status(400).json({ error: "Enter a valid ID number." });

    await updateProvider(provider.id, {
      kyc_status: "submitted",
      kyc_id_type: idType,
      kyc_id_number: idNumber,
      kyc_doc_url: docUrl || null,
      kyc_submitted_at: new Date().toISOString(),
    });

    await sendAdminNotification(
      `🪪 KYC submitted — ${provider.name}`,
      `<p><strong>${provider.name}</strong> (${provider.phone || "no phone"}) submitted ID for verification.</p>
       <ul>
         <li>Type: ${idType}</li>
         <li>Number: ${idNumber}</li>
         ${docUrl ? `<li>Document: <a href="${docUrl}">${docUrl}</a></li>` : ""}
         <li>Provider ID: ${provider.id}</li>
       </ul>
       <p>Review, then set verified in admin.</p>`
    ).catch((e) => console.error("[kyc] admin email failed", e.message));

    return res.status(200).json({ ok: true, status: "submitted", message: "ID submitted. We'll verify you within 1–2 days." });
  } catch (err) {
    console.error("[provider/kyc]", err);
    return res.status(500).json({ error: err.message });
  }
}

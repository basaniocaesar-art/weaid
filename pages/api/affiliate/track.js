import { getAffiliateByRefCode } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { refCode } = req.body;

    if (!refCode) {
      return res.status(400).json({ valid: false });
    }

    const affiliate = await getAffiliateByRefCode(refCode.toUpperCase());

    if (affiliate && affiliate.status === "approved") {
      return res.status(200).json({ valid: true, affiliateName: affiliate.name.split(" ")[0] });
    }

    return res.status(200).json({ valid: false });
  } catch (err) {
    console.error("[affiliate/track]", err);
    return res.status(200).json({ valid: false });
  }
}

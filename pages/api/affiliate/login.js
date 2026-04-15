import { getAffiliateByEmail } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const affiliate = await getAffiliateByEmail(email.toLowerCase());

    if (!affiliate) {
      return res.status(404).json({ error: "No affiliate account found with this email" });
    }

    if (affiliate.status === "suspended") {
      return res.status(403).json({ error: "Account suspended" });
    }

    return res.status(200).json({ affiliate });
  } catch (err) {
    console.error("[affiliate/login]", err);
    return res.status(500).json({ error: err.message });
  }
}

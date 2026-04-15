import { insertAffiliate, getAffiliateByEmail } from "../../../lib/supabase.js";
import { generateRefCode } from "../../../lib/affiliate.js";
import { sendAffiliateWelcome } from "../../../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, phone, upiId, bankAccount, bankIfsc } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: "Missing required fields: name, email, phone" });
    }

    // Check if already registered
    const existing = await getAffiliateByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered", refCode: existing.ref_code });
    }

    // Generate unique ref code
    let refCode = generateRefCode(name);
    let attempts = 0;
    while (attempts < 5) {
      const { data } = await (await import("../../../lib/supabase.js")).supabase
        .from("affiliates").select("id").eq("ref_code", refCode).single();
      if (!data) break;
      refCode = generateRefCode(name);
      attempts++;
    }

    const affiliate = await insertAffiliate({
      name,
      email: email.toLowerCase(),
      phone,
      ref_code: refCode,
      upi_id: upiId || null,
      bank_account: bankAccount || null,
      bank_ifsc: bankIfsc || null,
      status: "approved", // auto-approve for now
      tier: "bronze",
      total_earnings: 0,
      pending_payout: 0,
      total_referrals: 0,
      approved_at: new Date().toISOString(),
    });

    await sendAffiliateWelcome(email, affiliate).catch(() => {});

    return res.status(201).json({
      affiliateId: affiliate.id,
      refCode: affiliate.ref_code,
      status: affiliate.status,
      shareUrl: `${process.env.NEXT_PUBLIC_URL || "https://weaid.in"}/?ref=${affiliate.ref_code}`,
    });
  } catch (err) {
    console.error("[affiliate/register]", err);
    return res.status(500).json({ error: err.message });
  }
}

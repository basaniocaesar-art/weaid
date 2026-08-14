import { getSessionProvider } from "../../../lib/auth.js";
import { getProviderEarnings, getPayoutRequests } from "../../../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { user, provider } = await getSessionProvider(req);
    if (!user) return res.status(401).json({ error: "Not signed in" });
    if (!provider) {
      // Signed in but no listing yet — show an empty ledger, prompt to list.
      return res.status(200).json({
        hasListing: false,
        earnings: { lifetime: 0, thisMonth: 0, pending: 0, jobsDone: 0 },
        rating: null,
        payouts: [],
      });
    }
    const earnings = await getProviderEarnings(provider.id);
    const payouts = await getPayoutRequests(provider.id);
    return res.status(200).json({
      hasListing: true,
      earnings,
      rating: provider.rating ?? null,
      reviewCount: provider.review_count ?? 0,
      kycStatus: provider.kyc_status || "none",
      payouts,
    });
  } catch (err) {
    console.error("[provider/earnings]", err);
    return res.status(500).json({ error: err.message });
  }
}

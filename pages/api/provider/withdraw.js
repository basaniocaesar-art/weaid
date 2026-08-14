import { getSessionProvider } from "../../../lib/auth.js";
import { getProviderEarnings, hasOpenPayoutRequest, insertPayoutRequest } from "../../../lib/supabase.js";
import { sendAdminNotification } from "../../../lib/email.js";

const MIN_PAYOUT = 200; // ₹ — don't process trivial withdrawals

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { user, provider } = await getSessionProvider(req);
    if (!user) return res.status(401).json({ error: "Not signed in" });
    if (!provider) return res.status(400).json({ error: "List your services before requesting a payout." });

    const { method, destination } = req.body || {};
    if (!destination) return res.status(400).json({ error: "Add a UPI ID or bank account to receive the payout." });

    if (await hasOpenPayoutRequest(provider.id)) {
      return res.status(409).json({ error: "You already have a payout in progress." });
    }

    const { pending, jobsDone } = await getProviderEarnings(provider.id);
    if (pending < MIN_PAYOUT) {
      return res.status(400).json({ error: `Minimum payout is ₹${MIN_PAYOUT}. Your balance is ₹${pending}.` });
    }

    const request = await insertPayoutRequest({
      provider_id: provider.id,
      user_id: user.id,
      amount: pending,
      jobs_count: jobsDone,
      method: method || "upi",
      destination,
      status: "requested",
    });

    await sendAdminNotification(
      `💸 Payout request ₹${pending} — ${provider.name}`,
      `<p><strong>${provider.name}</strong> (${provider.phone || "no phone"}) requested a payout.</p>
       <ul>
         <li>Amount: <strong>₹${pending}</strong> across ${jobsDone} completed job(s)</li>
         <li>Send to: <strong>${destination}</strong> (${method || "upi"})</li>
         <li>Provider ID: ${provider.id}</li>
         <li>Request ID: ${request.id}</li>
       </ul>
       <p>Pay the provider their net, then mark the request paid in admin.</p>`
    ).catch((e) => console.error("[withdraw] admin email failed", e.message));

    return res.status(201).json({
      ok: true,
      requestId: request.id,
      amount: pending,
      message: "Payout requested. We process payouts every Monday — you'll get it in your account.",
    });
  } catch (err) {
    console.error("[provider/withdraw]", err);
    return res.status(500).json({ error: err.message });
  }
}

/* ── WhatsApp Business API helper ── */

const WA_API_URL = process.env.WHATSAPP_API_URL;
const WA_TOKEN   = process.env.WHATSAPP_TOKEN;
const WA_FROM    = process.env.WHATSAPP_FROM_NUMBER;

async function sendMessage(to, body) {
  if (!WA_API_URL || !WA_TOKEN) {
    console.warn("[WhatsApp] Missing env vars — skipping message to", to);
    return null;
  }

  const res = await fetch(WA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[WhatsApp] Send failed:", err);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
  return res.json();
}

export async function notifyCustomerBookingConfirmed(phone, booking) {
  const msg = `Hi! Your WeAid booking #${booking.id} for ${booking.service} is confirmed. A provider will be assigned shortly.`;
  return sendMessage(phone, msg);
}

export async function notifyCustomerProviderAssigned(phone, booking, provider) {
  const msg = `Great news! ${provider.name} has been assigned to your ${booking.service} booking #${booking.id}. They'll arrive at your scheduled time.`;
  return sendMessage(phone, msg);
}

export async function notifyProviderNewJob(phone, booking) {
  const task = booking.description ? ` — "${booking.description}"` : "";
  const earn = booking.provider_earnings ? ` You earn ₹${booking.provider_earnings}.` : "";
  const msg = `New WeAid job! ${booking.service} in ${booking.city}${task}.${earn} Open your dashboard to accept.`;
  return sendMessage(phone, msg);
}

// Sent to the PROVIDER right after they accept — they now get the customer's contact.
export async function notifyProviderJobConfirmed(phone, booking) {
  const when = booking.timing_mode === "scheduled" && booking.scheduled_at
    ? new Date(booking.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "as soon as possible";
  const task = booking.description ? `Task: ${booking.description}\n` : "";
  const addr = booking.address ? `Address: ${booking.address}\n` : "";
  const msg = `✅ Job confirmed! ${booking.service} in ${booking.city}, ${when}.\n${task}Customer: ${booking.customer_name || ""} — ${booking.customer_phone || ""}\n${addr}You earn ₹${booking.provider_earnings || ""}. Please call the customer to confirm arrival.`;
  return sendMessage(phone, msg);
}

// Reminder before a scheduled job — sent to both customer and provider.
export async function notifyBookingReminder(phone, booking, role) {
  const when = booking.scheduled_at
    ? new Date(booking.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "soon";
  const msg = role === "provider"
    ? `⏰ Reminder: your WeAid ${booking.service} job in ${booking.city} is at ${when}. Please be on time. Customer: ${booking.customer_name || ""} — ${booking.customer_phone || ""}.`
    : `⏰ Reminder: your WeAid ${booking.service} booking is scheduled for ${when}. Your pro ${booking.provider_name || ""} will arrive then. Reply here if anything changes.`;
  return sendMessage(phone, msg);
}

export async function notifyCustomerJobComplete(phone, booking) {
  const msg = `Your ${booking.service} job #${booking.id} has been marked complete. Please rate your experience in the app.`;
  return sendMessage(phone, msg);
}

export async function notifyProviderPayout(phone, amount) {
  const msg = `Your WeAid payout of ₹${amount} has been initiated. It will reflect in your account within 2-3 business days.`;
  return sendMessage(phone, msg);
}

/* ── Affiliate Notifications ── */

export async function notifyAffiliateCommission(phone, commission, service) {
  const msg = `You just earned ₹${commission} from a WeAid referral! (${service} booking completed). Keep sharing your link to earn more!`;
  return sendMessage(phone, msg);
}

export async function notifyAffiliatePayout(phone, amount) {
  const msg = `Your WeAid affiliate payout of ₹${amount} has been initiated. It will reflect in your account within 2-3 business days.`;
  return sendMessage(phone, msg);
}

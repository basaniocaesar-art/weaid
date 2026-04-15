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
  const msg = `New WeAid job available! ${booking.service} in ${booking.city} — Booking #${booking.id}. Accept or decline in your dashboard.`;
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

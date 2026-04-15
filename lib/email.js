/* ── Email helper using nodemailer ── */

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.EMAIL_FROM || "noreply@weaid.in";

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) {
    console.warn("[Email] Missing SMTP_USER — skipping email to", to);
    return null;
  }

  const info = await transporter.sendMail({ from: FROM, to, subject, html });
  return info;
}

export async function sendBookingConfirmation(email, booking) {
  return sendEmail(
    email,
    `WeAid Booking #${booking.id} Confirmed`,
    `<h2>Booking Confirmed</h2>
     <p>Your <strong>${booking.service}</strong> booking has been confirmed.</p>
     <p>Total: ₹${booking.total}</p>
     <p>We'll notify you once a provider is assigned.</p>`
  );
}

export async function sendProviderAssigned(email, booking, provider) {
  return sendEmail(
    email,
    `Provider Assigned — Booking #${booking.id}`,
    `<h2>Provider Assigned</h2>
     <p><strong>${provider.name}</strong> has been assigned to your ${booking.service} booking.</p>
     <p>They will arrive at your scheduled time.</p>`
  );
}

export async function sendRefundConfirmation(email, booking, amount) {
  return sendEmail(
    email,
    `Refund Processed — Booking #${booking.id}`,
    `<h2>Refund Processed</h2>
     <p>A refund of ₹${amount} for booking #${booking.id} has been initiated.</p>
     <p>It will reflect in your account within 5-7 business days.</p>`
  );
}

export async function sendPayoutNotification(email, provider, amount) {
  return sendEmail(
    email,
    `WeAid Payout — ₹${amount}`,
    `<h2>Payout Initiated</h2>
     <p>Hi ${provider.name}, your payout of ₹${amount} has been initiated.</p>
     <p>It will reflect in your bank account within 2-3 business days.</p>`
  );
}

/* ── Affiliate Emails ── */

export async function sendAffiliateWelcome(email, affiliate) {
  return sendEmail(
    email,
    `Welcome to WeAid Affiliate Program!`,
    `<h2>Welcome, ${affiliate.name}!</h2>
     <p>Your affiliate account has been approved.</p>
     <p>Your referral code is: <strong>${affiliate.ref_code}</strong></p>
     <p>Share this link with friends: <strong>https://weaid.in/?ref=${affiliate.ref_code}</strong></p>
     <p>You earn 10% commission on every completed booking made through your link.</p>
     <p>Track your earnings at <a href="https://weaid.in/affiliate">weaid.in/affiliate</a></p>`
  );
}

export async function sendAffiliateCommissionEarned(email, affiliate, referral) {
  return sendEmail(
    email,
    `You earned ₹${referral.affiliate_commission} — WeAid Referral`,
    `<h2>Commission Earned!</h2>
     <p>Hi ${affiliate.name}, a booking you referred has been completed.</p>
     <p>Service: ${referral.service}</p>
     <p>Your commission: <strong>₹${referral.affiliate_commission}</strong></p>
     <p>Total pending payout: ₹${affiliate.pending_payout}</p>
     <p>Payouts are processed every Monday (min ₹100).</p>`
  );
}

export async function sendAffiliatePayoutNotification(email, affiliate, amount) {
  return sendEmail(
    email,
    `WeAid Affiliate Payout — ₹${amount}`,
    `<h2>Payout Initiated</h2>
     <p>Hi ${affiliate.name}, your affiliate payout of ₹${amount} has been initiated.</p>
     <p>It will reflect in your account within 2-3 business days.</p>
     <p>Keep sharing your link to earn more: https://weaid.in/?ref=${affiliate.ref_code}</p>`
  );
}

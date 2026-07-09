const nodemailer = require("nodemailer");

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function getTransporter() {
  if (!hasSmtpConfig()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendAuthEmail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[auth-email:dev] ${subject} -> ${to}\n${text}`);
    return false;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
  return true;
}

async function sendVerificationEmail(req, user, token) {
  const url = `${getBaseUrl(req)}/api/auth/verify-email/${encodeURIComponent(token)}`;
  return sendAuthEmail({
    to: user.email,
    subject: "Verify your Domain Radar account",
    text: `Welcome to Domain Radar. Verify your email within 24 hours: ${url}`,
    html: `<p>Welcome to Domain Radar.</p><p><a href="${url}">Verify your email</a> within 24 hours.</p>`
  });
}

async function sendPasswordResetEmail(req, user, token) {
  const url = `${getBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
  return sendAuthEmail({
    to: user.email,
    subject: "Reset your Domain Radar password",
    text: `Reset your password using this link: ${url}`,
    html: `<p>Reset your Domain Radar password using this link:</p><p><a href="${url}">Reset password</a></p>`
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };

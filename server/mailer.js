import nodemailer from "nodemailer";

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) {
    console.log(`[mail skipped] SMTP is not configured for subject "${subject}"`);
    return { skipped: true, reason: "SMTP is not configured." };
  }

  console.log(`[mail sending] subject="${subject}" to="${to}" smtpUser="${process.env.SMTP_USER}"`);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    const result = await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    console.log(`[mail sent] subject="${subject}" messageId="${result.messageId || "unknown"}"`);
    return result;
  } catch (error) {
    console.error(`[mail failed] subject="${subject}" to="${to}" code="${error.code || "unknown"}" message="${error.message}"`);
    throw error;
  }
}

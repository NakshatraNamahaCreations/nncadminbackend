import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

/* ─────────────────────────────────────────────────────────────
   Transporter
───────────────────────────────────────────────────────────── */
const createTransporter = () =>
  nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.hostinger.com",
    port: Number(process.env.EMAIL_PORT) || 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });

/* ─────────────────────────────────────────────────────────────
   Brand constants
───────────────────────────────────────────────────────────── */
const BACKEND_URL   = process.env.BACKEND_URL || "https://nncadminbackend.onrender.com";
const LOGO_URL      = `${BACKEND_URL}/uploads/nnclogo.png`;
const BRAND_NAME    = "Nakshatra Namaha Creations Pvt. Ltd.";
const BRAND_SHORT   = "NNC";
const BRAND_TAGLINE = "Website &amp; Digital Solutions";
const BRAND_EMAIL   = "info@nakshatranamahacreations.com";
const BRAND_SITE    = "https://www.nakshatranamahacreations.com";
const BRAND_OFFICES = "Bangalore &nbsp;|&nbsp; Mumbai &nbsp;|&nbsp; Mysore";
const SIGNATURE_NAME = "Team Nakshatra Namaha Creations Pvt. Ltd.";
const CC_EMAIL       = "harish@nakshatranamahacreations.com";

/* ─────────────────────────────────────────────────────────────
   Shared building blocks
───────────────────────────────────────────────────────────── */

/** Full-width header with logo image + brand name */
const htmlHeader = () => `
<tr>
  <td style="background:#0b1b3e;padding:32px 48px 26px;text-align:center;">
    <img src="${LOGO_URL}" alt="${BRAND_NAME} Logo"
         width="120" height="auto"
         style="display:block;margin:0 auto 14px;max-width:120px;height:auto;"
         onerror="this.style.display='none'"/>
    <p style="margin:0;color:#ffffff;font-size:19px;font-weight:700;letter-spacing:0.3px;line-height:1.3;">${BRAND_NAME}</p>
    <p style="margin:5px 0 0;color:#7fa4d4;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;">${BRAND_TAGLINE}</p>
  </td>
</tr>`;

/** Coloured accent band directly below the header */
const htmlAccentBand = (text, gradientCss) => `
<tr>
  <td style="background:${gradientCss};padding:14px 48px;text-align:center;">
    <p style="margin:0;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.2px;">${text}</p>
  </td>
</tr>`;

/** Professional closing signature */
const htmlSignature = () => `
<tr>
  <td style="padding:24px 48px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border-top:1px solid #e8edf5;padding-top:18px;margin-top:10px;">
      <tr>
        <td>
          <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0b1b3e;">Warm regards,</p>
          <p style="margin:0 0 2px;font-size:14px;font-weight:800;color:#0b1b3e;">${SIGNATURE_NAME}</p>
        </td>
        <td style="text-align:right;vertical-align:middle;">
          <img src="${LOGO_URL}" alt="NNC" width="52" height="auto"
               style="max-width:52px;height:auto;" onerror="this.style.display='none'"/>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

/** Contact + footer strip */
const htmlFooter = (year) => `
<tr>
  <td style="padding:20px 48px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f7f9fc;border:1px solid #e8edf5;border-radius:10px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#0b1b3e;text-transform:uppercase;letter-spacing:0.6px;">Get in touch</p>
        <p style="margin:0 0 5px;font-size:13px;color:#444c5e;">
          ✉&nbsp; <a href="mailto:${BRAND_EMAIL}" style="color:#1a56db;text-decoration:none;font-weight:600;">${BRAND_EMAIL}</a>
        </p>
        <p style="margin:0 0 5px;font-size:13px;color:#444c5e;">
          🌐&nbsp; <a href="${BRAND_SITE}" style="color:#1a56db;text-decoration:none;font-weight:600;">${BRAND_SITE}</a>
        </p>
        <p style="margin:0;font-size:12px;color:#94a3b8;">📍&nbsp; ${BRAND_OFFICES}</p>
      </td></tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:20px 48px 28px;text-align:center;">
    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;">© ${year} ${BRAND_NAME}. All rights reserved.</p>
    <p style="margin:0;font-size:11px;color:#b0bac7;">This is an automated communication from our project management system.</p>
  </td>
</tr>`;

/** Master wrapper — all emails use this shell */
const htmlShell = (accentBandHtml, bodyRows, year) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="color-scheme" content="light"/>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#eef2f7;padding:36px 12px;" role="presentation">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0"
           style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;
                  background:#ffffff;box-shadow:0 8px 40px rgba(0,0,0,0.10);">
      ${htmlHeader()}
      ${accentBandHtml}
      ${bodyRows}
      ${htmlSignature()}
      ${htmlFooter(year)}
    </table>
  </td></tr>
</table>
</body>
</html>`;

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" }) : "";

const infoRow = (label, value) => `
<tr>
  <td style="padding:6px 0;font-size:13px;color:#475569;font-weight:600;width:48%;">${label}</td>
  <td style="padding:6px 0;font-size:13px;color:#0b1b3e;font-weight:700;text-align:right;">${value}</td>
</tr>`;

const infoBlock = (accentColor, accentBg, accentBorder, title, rows) => `
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${accentBg};border:1px solid ${accentBorder};border-radius:10px;margin-bottom:16px;">
  <tr><td style="padding:16px 20px;">
    <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:${accentColor};
              text-transform:uppercase;letter-spacing:0.6px;">${title}</p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>
</table>`;

const stepRow = (icon, title, body) => `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
  <tr>
    <td width="42" valign="top">
      <div style="width:34px;height:34px;background:#ebf1fd;border-radius:9px;
                  text-align:center;line-height:34px;font-size:17px;">${icon}</div>
    </td>
    <td style="padding-left:12px;">
      <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#0b1b3e;">${title}</p>
      <p style="margin:0;font-size:12px;color:#64748b;line-height:1.65;">${body}</p>
    </td>
  </tr>
</table>`;

const sectionTitle = (text) =>
  `<p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#0b1b3e;
             text-transform:uppercase;letter-spacing:0.7px;">${text}</p>`;

const para = (text) =>
  `<p style="margin:0 0 14px;font-size:14px;color:#3d4a5c;line-height:1.8;">${text}</p>`;

/* ─────────────────────────────────────────────────────────────
   1.  WELCOME  (onboarding)
───────────────────────────────────────────────────────────── */
const buildWelcomeHtml = ({ name, business }) => {
  const year = new Date().getFullYear();
  const displayName = name || "Valued Client";
  return htmlShell(
    htmlAccentBand("🎉 &nbsp; You've been successfully onboarded!", "linear-gradient(90deg,#1a56db,#2563eb)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${displayName},</h2>
      ${para(`Thank you for choosing <strong style="color:#1a56db;">${BRAND_NAME}</strong>. We are thrilled to welcome you to our growing family of brands and businesses we proudly serve.`)}
      ${para(`Our team is fully committed to crafting a powerful digital presence for${business ? ` <strong>${business}</strong>` : " your business"} — one that captivates your audience, builds trust, and drives real growth.`)}
      <div style="height:1px;background:#e8edf5;margin:10px 0 20px;"></div>
      ${sectionTitle("What happens next?")}
      ${stepRow("📋","Discovery &amp; Requirements","Our specialist will reach out within 24 hours to understand your goals, audience, and project scope.")}
      ${stepRow("🎨","Design &amp; Development","We design and build a pixel-perfect, high-performance website tailored uniquely to your brand identity.")}
      ${stepRow("🚀","Launch &amp; Ongoing Support","After your approval, we go live — with continued support to keep you ahead of the curve.")}
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="background:#f5f8ff;border-left:4px solid #1a56db;border-radius:8px;padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:14px;font-style:italic;color:#1a56db;line-height:1.7;">
            "We don't just build websites — we build experiences that make your brand unforgettable."
          </p>
          <p style="margin:0;font-size:12px;color:#64748b;font-weight:600;">— ${SIGNATURE_NAME}</p>
        </td></tr>
      </table>
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   2.  PROJECT INITIATION
───────────────────────────────────────────────────────────── */
const buildInitiationHtml = ({ name, business, startDate, timeline }) => {
  const year = new Date().getFullYear();
  const start    = fmtDate(startDate) || fmtDate(new Date());
  const deadline = startDate
    ? fmtDate(new Date(new Date(startDate).getTime() + (Number(timeline) || 8) * 86400000))
    : "";
  return htmlShell(
    htmlAccentBand("🚀 &nbsp; Your Website Development Has Officially Begun", "linear-gradient(90deg,#0ea5e9,#2563eb)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${name || "Valued Client"},</h2>
      ${para(`We are excited to inform you that we have officially initiated the development of your website${business ? ` for <strong>${business}</strong>` : ""}. Our team is now fully engaged and working with complete dedication to deliver an outstanding digital experience.`)}
      ${infoBlock("#2563eb","#f0f7ff","#bfdbfe","Project Details",
        infoRow("Development Start Date", `<strong>${start}</strong>`) +
        (deadline ? infoRow("Expected Delivery", `<strong style="color:#059669;">${deadline}</strong>`) : "") +
        (timeline ? infoRow("Development Timeline", `<strong>${timeline} Business Days</strong>`) : "")
      )}
      ${sectionTitle("During the development phase")}
      ${stepRow("📐","Design &amp; UI/UX","Crafting your unique visual identity, layout, and user experience.")}
      ${stepRow("⚙️","Core Development","Building a fast, responsive, and SEO-optimised website.")}
      ${stepRow("🧪","Quality Assurance","Rigorous testing across all devices and browsers.")}
      ${stepRow("📅","Demo &amp; Handover","A live walkthrough of your website before final approval.")}
      ${para("We will notify you as soon as your website is ready for the demo review. In the meantime, please feel free to share any content, images, or references that you would like incorporated into your website.")}
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   3.  PROJECT COMPLETION / DEMO READY
───────────────────────────────────────────────────────────── */
const buildCompletionHtml = ({ name, business, completionDate, demoLink }) => {
  const year = new Date().getFullYear();
  const dateStr = fmtDate(completionDate) || fmtDate(new Date());
  return htmlShell(
    htmlAccentBand("✅ &nbsp; Your Website Is Ready for Review", "linear-gradient(90deg,#059669,#10b981)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${name || "Valued Client"},</h2>
      ${para(`Excellent news! We have successfully completed the development of your website${business ? ` for <strong>${business}</strong>` : ""}. Our team has invested meticulous attention to every detail to ensure the highest quality outcome.`)}
      ${infoBlock("#059669","#f0fdf4","#bbf7d0","Completion Summary",
        infoRow("Completed On", `<strong>${dateStr}</strong>`) +
        infoRow("Current Status", `<strong style="color:#059669;">Ready for Demo Review ✓</strong>`)
      )}
      ${sectionTitle("Your next steps")}
      ${stepRow("📅","Schedule a Demo Meeting","We'll walk you through every section of your website in a live screen-sharing session.")}
      ${stepRow("💬","Share Your Feedback","Any revisions or adjustments you require will be incorporated promptly.")}
      ${stepRow("✅","Grant Approval","Once satisfied, provide your approval and we will proceed to go-live.")}
      ${stepRow("🚀","Your Website Goes Live","We handle the deployment, DNS, and final launch — completely managed by us.")}
      ${demoLink ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;">
        <tr><td style="text-align:center;">
          <a href="${demoLink}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;
             text-decoration:none;padding:13px 32px;border-radius:10px;font-size:13px;font-weight:700;
             letter-spacing:0.3px;box-shadow:0 4px 14px rgba(37,99,235,0.35);">
            View Your Website Demo &rarr;
          </a>
        </td></tr>
      </table>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#92400e;">
            ⏱ &nbsp;Please share your feedback or approval within <u>3–5 business days</u> to avoid any delay in your go-live date.
          </p>
        </td></tr>
      </table>
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   4.  MOM — Minutes of Meeting
───────────────────────────────────────────────────────────── */
const buildMOMHtml = ({ name, business, meetingDate, attendees, summary, actionItems }) => {
  const year = new Date().getFullYear();
  const dateStr = meetingDate
    ? new Date(meetingDate).toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : fmtDate(new Date());
  const actions = Array.isArray(actionItems) ? actionItems.filter(Boolean) : [];
  return htmlShell(
    htmlAccentBand(`📋 &nbsp; Minutes of Meeting — ${business || "Project Discussion"}`, "linear-gradient(90deg,#7c3aed,#6d28d9)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${name || "Valued Client"},</h2>
      ${para("Thank you for your time and valuable participation in today's meeting. As agreed, please find the official Minutes of Meeting (MOM) below for your records and reference.")}
      ${infoBlock("#7c3aed","#faf5ff","#ddd6fe","Meeting Details",
        infoRow("Date &amp; Time", `<strong>${dateStr}</strong>`) +
        (attendees ? infoRow("Attendees", `<strong>${attendees}</strong>`) : "")
      )}
      ${summary ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background:#f8fafc;border:1px solid #e8edf5;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#0b1b3e;text-transform:uppercase;letter-spacing:0.6px;">Discussion Summary</p>
          <p style="margin:0;font-size:13px;color:#3d4a5c;line-height:1.8;">${summary.replace(/\n/g,"<br/>")}</p>
        </td></tr>
      </table>` : ""}
      ${actions.length ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.6px;">Action Items</p>
          ${actions.map((a, i) => `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
            <tr>
              <td width="24" valign="top" style="padding-top:2px;">
                <div style="width:20px;height:20px;background:#c2410c;border-radius:50%;text-align:center;line-height:20px;font-size:11px;font-weight:700;color:#fff;">${i+1}</div>
              </td>
              <td style="padding-left:10px;font-size:13px;color:#3d4a5c;line-height:1.65;">${a}</td>
            </tr>
          </table>`).join("")}
        </td></tr>
      </table>` : ""}
      ${para("Kindly review the above MOM and confirm your agreement by replying to this email. Please let us know if any point requires clarification or amendment.")}
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   5.  FOLLOW-UP  (1 / 2 / 3)
───────────────────────────────────────────────────────────── */
const buildFollowupHtml = ({ name, business, followupNumber, completionDate }) => {
  const year = new Date().getFullYear();
  const num  = Number(followupNumber) || 1;
  const dateStr = fmtDate(completionDate);

  const configs = {
    1: {
      gradient: "linear-gradient(90deg,#2563eb,#3b82f6)",
      badge:    "Follow-up 1 of 3",
      title:    "A Gentle Reminder — We're Awaiting Your Feedback",
      body:     `We wanted to follow up regarding your website${business ? ` for <strong>${business}</strong>` : ""}${dateStr ? `, which was completed on <strong>${dateStr}</strong>` : ""}. We hope you have had an opportunity to review our work and we are looking forward to hearing your thoughts.<br/><br/>Could you kindly share your feedback or let us know a convenient time for a demo session? Your prompt response will help us proceed to the final launch stage without delay.`,
      cta:      "#2563eb",
    },
    2: {
      gradient: "linear-gradient(90deg,#d97706,#f59e0b)",
      badge:    "Follow-up 2 of 3",
      title:    "Second Follow-up — Your Response is Important",
      body:     `We hope you are doing well. We are writing once more regarding your website${business ? ` for <strong>${business}</strong>` : ""}${dateStr ? ` completed on <strong>${dateStr}</strong>` : ""}. We have not yet received your feedback or approval.<br/><br/>We completely understand that your schedule may be demanding, and we want to assure you that we are ready to accommodate your timeline. However, a brief response from you will allow us to proceed without further delays.`,
      cta:      "#d97706",
    },
    3: {
      gradient: "linear-gradient(90deg,#dc2626,#ef4444)",
      badge:    "Follow-up 3 of 3",
      title:    "Final Follow-up — Urgent Action Required",
      body:     `This is our third and final follow-up regarding your website${business ? ` for <strong>${business}</strong>` : ""}${dateStr ? `, completed on <strong>${dateStr}</strong>` : ""}. We are very eager to complete this project and take your business online.<br/><br/>Without your approval, we are currently unable to move forward. We sincerely urge you to connect with us at the earliest — either by replying to this email or reaching us directly. We are always available to address any concerns you may have.`,
      cta:      "#dc2626",
    },
  };
  const cfg = configs[num] || configs[1];

  return htmlShell(
    htmlAccentBand(`🔔 &nbsp; ${cfg.badge} — Awaiting Your Approval`, cfg.gradient),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 8px;font-size:21px;font-weight:700;color:#0b1b3e;">${cfg.title}</h2>
      <h3 style="margin:0 0 16px;font-size:15px;font-weight:500;color:#64748b;">Dear ${name || "Valued Client"},</h3>
      ${para(cfg.body)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f8fafc;border:1px solid #e8edf5;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:${cfg.cta};text-transform:uppercase;letter-spacing:0.5px;">How to respond</p>
          <p style="margin:0 0 5px;font-size:13px;color:#3d4a5c;">📧 &nbsp;Reply directly to this email</p>
          <p style="margin:0 0 5px;font-size:13px;color:#3d4a5c;">📞 &nbsp;Call your project manager</p>
          <p style="margin:0;font-size:13px;color:#3d4a5c;">✉️ &nbsp;<a href="mailto:${BRAND_EMAIL}" style="color:${cfg.cta};font-weight:700;">${BRAND_EMAIL}</a></p>
        </td></tr>
      </table>
      ${num === 3 ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#dc2626;">
            ⚠️ &nbsp;This is our final communication. Continued non-response may result in project re-scheduling. Please reach out to us today.
          </p>
        </td></tr>
      </table>` : ""}
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   6.  CUSTOM
───────────────────────────────────────────────────────────── */
const buildCustomHtml = ({ name, subject, body }) => {
  const year = new Date().getFullYear();
  const safeBody = (body || "").replace(/\n/g, "<br/>");
  return htmlShell(
    htmlAccentBand(`✉️ &nbsp; ${subject || "Message from " + BRAND_NAME}`, "linear-gradient(90deg,#0f172a,#1e293b)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${name || "Valued Client"},</h2>
      <div style="font-size:14px;color:#3d4a5c;line-height:1.85;">${safeBody}</div>
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   7.  PAYMENT REMINDER  (Stage 1 / 2 / 3)
───────────────────────────────────────────────────────────── */
const buildPaymentReminderHtml = ({ name, business, amountDue, dueDate, invoiceNumber, stage }) => {
  const year = new Date().getFullYear();
  const num  = Number(stage) || 1;
  const dueDateStr = fmtDate(dueDate);
  const amtFormatted = `₹${(amountDue || 0).toLocaleString("en-IN")}`;

  const configs = {
    1: {
      gradient:      "linear-gradient(90deg,#0ea5e9,#2563eb)",
      badge:         "Payment Reminder — Stage 1 of 3",
      icon:          "💳",
      title:         "A Gentle Payment Reminder",
      urgencyLabel:  "PAYMENT DUE",
      urgencyColor:  "#2563eb",
      urgencyBg:     "#f0f7ff",
      urgencyBorder: "#bfdbfe",
      body: `We hope this message finds you well. We are writing to gently remind you that a payment of <strong style="color:#2563eb;">${amtFormatted}</strong> is due${dueDateStr ? ` on <strong>${dueDateStr}</strong>` : ""}${business ? ` for your project with <strong>${business}</strong>` : ""}.`,
      note: "We appreciate your continued trust in us. Kindly arrange the payment at your earliest convenience to ensure smooth progress on your project.",
    },
    2: {
      gradient:      "linear-gradient(90deg,#d97706,#f59e0b)",
      badge:         "Payment Reminder — Stage 2 of 3",
      icon:          "⚠️",
      title:         "Important: Payment Overdue",
      urgencyLabel:  "OVERDUE",
      urgencyColor:  "#92400e",
      urgencyBg:     "#fffbeb",
      urgencyBorder: "#fde68a",
      body: `We are writing regarding an outstanding payment of <strong style="color:#d97706;">${amtFormatted}</strong>${business ? ` for <strong>${business}</strong>` : ""}, which was due on <strong style="color:#dc2626;">${dueDateStr || "the scheduled date"}</strong>.`,
      note: "We have not yet received this payment and kindly request your immediate attention. Please reach out if you need an alternative payment arrangement.",
    },
    3: {
      gradient:      "linear-gradient(90deg,#dc2626,#ef4444)",
      badge:         "Critical Payment Alert — Stage 3 of 3",
      icon:          "🚨",
      title:         "Urgent: Final Payment Notice",
      urgencyLabel:  "CRITICAL — FINAL NOTICE",
      urgencyColor:  "#dc2626",
      urgencyBg:     "#fff1f2",
      urgencyBorder: "#fecdd3",
      body: `This is our final notice regarding an outstanding payment of <strong style="color:#dc2626;">${amtFormatted}</strong>${business ? ` for <strong>${business}</strong>` : ""}, which was due on <strong style="color:#dc2626;">${dueDateStr || "the scheduled date"}</strong>.`,
      note: "Failure to clear this payment may result in project suspension as per our terms of service. We strongly urge you to make the payment immediately or contact us urgently to resolve this matter.",
    },
  };

  const cfg = configs[num] || configs[1];

  return htmlShell(
    htmlAccentBand(`${cfg.icon} &nbsp; ${cfg.badge}`, cfg.gradient),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 8px;font-size:21px;font-weight:700;color:#0b1b3e;">${cfg.title}</h2>
      <h3 style="margin:0 0 16px;font-size:15px;font-weight:500;color:#64748b;">Dear ${name || "Valued Client"},</h3>
      ${para(cfg.body)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:${cfg.urgencyBg};border:2px solid ${cfg.urgencyBorder};border-radius:12px;margin-bottom:16px;">
        <tr><td style="padding:22px 24px;text-align:center;">
          <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:${cfg.urgencyColor};text-transform:uppercase;letter-spacing:1.2px;">${cfg.urgencyLabel}</p>
          <p style="margin:0 0 4px;font-size:30px;font-weight:900;color:${cfg.urgencyColor};">${amtFormatted}</p>
          ${dueDateStr ? `<p style="margin:0;font-size:13px;color:#64748b;">Due by &nbsp;<strong style="color:${cfg.urgencyColor};">${dueDateStr}</strong></p>` : ""}
          ${invoiceNumber ? `<p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Invoice / Ref: <strong>${invoiceNumber}</strong></p>` : ""}
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f8fafc;border:1px solid #e8edf5;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#0b1b3e;text-transform:uppercase;letter-spacing:0.5px;">Payment Instructions</p>
          <p style="margin:0 0 5px;font-size:13px;color:#3d4a5c;">🏦 &nbsp;Contact us for bank transfer / UPI details</p>
          <p style="margin:0 0 5px;font-size:13px;color:#3d4a5c;">📱 &nbsp;NEFT / IMPS / UPI accepted</p>
          <p style="margin:0;font-size:13px;color:#3d4a5c;">✉️ &nbsp;<a href="mailto:${BRAND_EMAIL}" style="color:${cfg.urgencyColor};font-weight:700;">${BRAND_EMAIL}</a></p>
        </td></tr>
      </table>
      ${para(cfg.note)}
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   8.  PAYMENT RECEIPT  (email body)
───────────────────────────────────────────────────────────── */
const buildPaymentReceiptHtml = ({ name, business, receiptNumber, amountPaid, remainingAmount, paymentDate }) => {
  const year = new Date().getFullYear();
  const dateStr = fmtDate(paymentDate) || fmtDate(new Date());
  const paid = amountPaid || 0;
  const remaining = remainingAmount || 0;

  return htmlShell(
    htmlAccentBand("🧾 &nbsp; Payment Received — Thank You!", "linear-gradient(90deg,#059669,#10b981)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${name || "Valued Client"},</h2>
      ${para(`We are pleased to confirm that we have successfully received your payment${business ? ` for <strong>${business}</strong>` : ""}. Thank you for your prompt settlement — your trust means a great deal to us.`)}
      ${infoBlock("#059669","#f0fdf4","#bbf7d0","Payment Confirmation",
        infoRow("Receipt Number", `<strong>${receiptNumber || "—"}</strong>`) +
        infoRow("Amount Paid", `<strong style="color:#059669;font-size:15px;">₹${paid.toLocaleString("en-IN")}</strong>`) +
        infoRow("Payment Date", `<strong>${dateStr}</strong>`) +
        (remaining > 0
          ? infoRow("Balance Remaining", `<strong style="color:#dc2626;">₹${remaining.toLocaleString("en-IN")}</strong>`)
          : infoRow("Balance", `<strong style="color:#059669;">Fully Cleared ✓</strong>`))
      )}
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:14px 18px;text-align:center;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#059669;">
            ✅ &nbsp;Your official invoice is attached to this email for your records.
          </p>
        </td></tr>
      </table>
      ${remaining > 0 ? `<table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#92400e;">
            ⏱ &nbsp;The remaining balance of ₹${remaining.toLocaleString("en-IN")} will be due as per our agreed payment schedule.
          </p>
        </td></tr>
      </table>` : ""}
      ${para("Thank you for being a valued client of " + BRAND_NAME + ". We look forward to delivering an outstanding result for your project.")}
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   9.  DOCUMENT REQUEST  (Onboarding)
───────────────────────────────────────────────────────────── */
const buildDocumentRequestHtml = ({ name, business, serviceType }) => {
  const year = new Date().getFullYear();
  const svc  = (serviceType || "website").toLowerCase();

  const websiteDocs = [
    { icon: "🖼️", title: "Brand Logo Files",          desc: "High-resolution logo in PNG, SVG, or AI format (transparent background preferred)" },
    { icon: "🌐", title: "Domain Details",             desc: "Domain name, registrar login credentials (GoDaddy / Namecheap / BigRock), and any existing DNS records" },
    { icon: "🖥️", title: "Hosting Credentials",       desc: "Hosting provider name, cPanel / FTP login ID &amp; password, and server IP address" },
    { icon: "📱", title: "Social Media Handles",       desc: "Links to all active profiles — Instagram, Facebook, LinkedIn, YouTube, Twitter/X" },
    { icon: "📝", title: "Website Content &amp; Text", desc: "Copy for all pages: About Us, Services, Contact details, and any custom page content" },
    { icon: "📸", title: "Images &amp; Media",         desc: "Product photos, team photos, office/facility images, and any other visuals for the site" },
    { icon: "🎨", title: "Brand Guidelines",           desc: "Preferred colour palette, fonts, and any existing brand manual if available" },
    { icon: "📄", title: "Existing Marketing Material",desc: "Business cards, brochures, or design templates previously used" },
  ];

  const extraEcommerce = [
    { icon: "🛍️", title: "Product Catalogue",         desc: "Complete product list with names, descriptions, prices, and high-quality images" },
    { icon: "💳", title: "Payment Gateway Details",    desc: "Preferred gateway (Razorpay / PayU / Stripe) — we will assist with the integration" },
  ];

  const docs = svc === "ecommerce" ? [...websiteDocs, ...extraEcommerce] : websiteDocs;

  return htmlShell(
    htmlAccentBand("📂 &nbsp; Action Required: Please Share Your Project Documents", "linear-gradient(90deg,#7c3aed,#6d28d9)"),
    `<tr><td style="padding:32px 48px 0;">
      <h2 style="margin:0 0 14px;font-size:21px;font-weight:700;color:#0b1b3e;">Dear ${name || "Valued Client"},</h2>
      ${para(`We are excited to begin working on your ${svc === "ecommerce" ? "e-commerce store" : "website"}${business ? ` for <strong>${business}</strong>` : ""}! To ensure we deliver the most accurate, professional, and brand-aligned result, we kindly request the following documents and details.`)}
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#faf5ff;border:1px solid #ddd6fe;border-radius:10px;margin-bottom:20px;">
        <tr><td style="padding:18px 20px;">
          <p style="margin:0 0 16px;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.7px;">Required Documents &amp; Information</p>
          ${docs.map(d => `
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
            <tr>
              <td width="42" valign="top">
                <div style="width:34px;height:34px;background:#ede9fe;border-radius:9px;
                            text-align:center;line-height:34px;font-size:17px;">${d.icon}</div>
              </td>
              <td style="padding-left:12px;">
                <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0b1b3e;">${d.title}</p>
                <p style="margin:0;font-size:12px;color:#64748b;line-height:1.65;">${d.desc}</p>
              </td>
            </tr>
          </table>`).join("")}
        </td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:10px;margin-bottom:16px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">How to submit</p>
          <p style="margin:0 0 4px;font-size:13px;color:#3d4a5c;">📧 &nbsp;Reply to this email with files attached</p>
          <p style="margin:0 0 4px;font-size:13px;color:#3d4a5c;">📁 &nbsp;Share via Google Drive / WeTransfer link</p>
          <p style="margin:0;font-size:13px;color:#3d4a5c;">📞 &nbsp;Send via WhatsApp to your project manager</p>
        </td></tr>
      </table>
      ${para("Please try to share these materials within <strong>3–5 business days</strong>. Earlier submission means faster delivery! If you have any questions, we are here to help every step of the way.")}
    </td></tr>`,
    year
  );
};

/* ─────────────────────────────────────────────────────────────
   PDF Invoice Generator  (pdfkit)
───────────────────────────────────────────────────────────── */
export const generateInvoicePDF = ({
  receiptNumber, invoiceNumber, clientName, business,
  services, amountPaid, remainingAmount, paymentDate,
}) =>
  new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const dateStr  = paymentDate
      ? new Date(paymentDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
      : new Date().toLocaleDateString("en-IN");
    const ref      = receiptNumber || invoiceNumber || `NNC-${Date.now()}`;
    const paid     = amountPaid     || 0;
    const remaining = remainingAmount || 0;
    const total    = paid + remaining;

    /* ── Header band ── */
    doc.rect(0, 0, doc.page.width, 110).fill("#0b1b3e");
    doc.fillColor("#ffffff").fontSize(20).font("Helvetica-Bold")
       .text("NAKSHATRA NAMAHA CREATIONS PVT. LTD.", 50, 30, { width: 495 });
    doc.fillColor("#7fa4d4").fontSize(10).font("Helvetica")
       .text("Website & Digital Solutions", 50, 57);
    doc.fillColor("#94a3b8").fontSize(9)
       .text("info@nakshatranamahacreations.com  |  www.nakshatranamahacreations.com", 50, 73);
    doc.fillColor("#94a3b8").fontSize(9)
       .text("Bangalore  |  Mumbai  |  Mysore", 50, 87);

    /* ── Title strip ── */
    doc.rect(0, 110, doc.page.width, 36).fill("#1a56db");
    doc.fillColor("#ffffff").fontSize(15).font("Helvetica-Bold")
       .text("PAYMENT RECEIPT", 50, 121);
    doc.fillColor("#bfdbfe").fontSize(9).font("Helvetica")
       .text(`Ref: ${ref}`, 370, 123, { width: 175, align: "right" });

    /* ── Bill-to + date ── */
    doc.fillColor("#64748b").fontSize(8).font("Helvetica-Bold")
       .text("BILL TO", 50, 168);
    doc.fillColor("#0b1b3e").fontSize(12).font("Helvetica-Bold")
       .text(clientName || "Valued Client", 50, 182, { width: 250 });
    if (business) {
      doc.fillColor("#475569").fontSize(10).font("Helvetica")
         .text(business, 50, 198, { width: 250 });
    }
    doc.fillColor("#64748b").fontSize(8).font("Helvetica-Bold")
       .text("PAYMENT DATE", 375, 168, { width: 170, align: "right" });
    doc.fillColor("#0b1b3e").fontSize(12).font("Helvetica-Bold")
       .text(dateStr, 375, 182, { width: 170, align: "right" });

    /* ── Services table ── */
    const tblTop = 250;
    doc.rect(50, tblTop, 495, 28).fill("#f1f5f9");
    doc.fillColor("#0b1b3e").fontSize(9).font("Helvetica-Bold")
       .text("DESCRIPTION", 60, tblTop + 10)
       .text("AMOUNT", 450, tblTop + 10, { width: 85, align: "right" });

    let y = tblTop + 38;
    const serviceList = Array.isArray(services) && services.length
      ? services
      : [{ desc: "Website Development Services", amount: total }];

    serviceList.forEach((svc, i) => {
      if (i % 2 === 0) doc.rect(50, y - 4, 495, 24).fill("#f8fafc");
      doc.fillColor("#3d4a5c").fontSize(10).font("Helvetica")
         .text(svc.desc || svc.description || "Service", 60, y, { width: 340 });
      doc.fillColor("#0b1b3e").fontSize(10).font("Helvetica-Bold")
         .text(`Rs. ${(svc.amount || 0).toLocaleString("en-IN")}`, 450, y, { width: 85, align: "right" });
      y += 28;
    });

    /* ── Totals ── */
    y += 10;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
    y += 14;

    doc.fillColor("#475569").fontSize(10).font("Helvetica")
       .text("Total Project Value", 310, y, { width: 150 });
    doc.fillColor("#0b1b3e").fontSize(10).font("Helvetica-Bold")
       .text(`Rs. ${total.toLocaleString("en-IN")}`, 450, y, { width: 85, align: "right" });
    y += 22;

    doc.fillColor("#059669").fontSize(11).font("Helvetica-Bold")
       .text("Amount Paid", 310, y, { width: 150 });
    doc.fillColor("#059669").fontSize(11).font("Helvetica-Bold")
       .text(`Rs. ${paid.toLocaleString("en-IN")}`, 450, y, { width: 85, align: "right" });
    y += 22;

    if (remaining > 0) {
      doc.fillColor("#dc2626").fontSize(10).font("Helvetica-Bold")
         .text("Balance Remaining", 310, y, { width: 150 });
      doc.fillColor("#dc2626").fontSize(10).font("Helvetica-Bold")
         .text(`Rs. ${remaining.toLocaleString("en-IN")}`, 450, y, { width: 85, align: "right" });
    } else {
      doc.rect(310, y - 3, 230, 24).fill("#f0fdf4");
      doc.fillColor("#059669").fontSize(10).font("Helvetica-Bold")
         .text("FULLY CLEARED ✓", 310, y + 4, { width: 230, align: "center" });
    }
    y += 50;

    /* ── Footer ── */
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
    y += 14;
    doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
       .text("This is a computer-generated receipt and does not require a physical signature.", 50, y, { width: 495, align: "center" });
    doc.fillColor("#94a3b8").fontSize(8)
       .text(`© ${new Date().getFullYear()} Nakshatra Namaha Creations Pvt. Ltd. All rights reserved.`, 50, y + 14, { width: 495, align: "center" });

    doc.end();
  });

/* ─────────────────────────────────────────────────────────────
   Exported send functions
───────────────────────────────────────────────────────────── */
const doSend = async ({ to, subject, html, attachments = [] }) => {
  if (!to || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"${BRAND_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    cc: CC_EMAIL,
    subject,
    html,
    ...(attachments.length ? { attachments } : {}),
  });
  console.log(`[EMAIL] "${subject}" → ${to} (cc: ${CC_EMAIL})`);
};

export const sendWelcomeEmail = async ({ name, email, business }) => {
  try {
    await doSend({
      to: email,
      subject: `Welcome to ${BRAND_NAME} — Your Digital Journey Begins! 🎉`,
      html: buildWelcomeHtml({ name, business }),
    });
  } catch (err) { console.error("sendWelcomeEmail:", err.message); }
};

export const sendProjectInitiationEmail = async ({ name, email, business, startDate, timeline }) => {
  try {
    await doSend({
      to: email,
      subject: `🚀 Your Website Development Has Begun — ${BRAND_SHORT}`,
      html: buildInitiationHtml({ name, business, startDate, timeline }),
    });
  } catch (err) { console.error("sendProjectInitiationEmail:", err.message); }
};

export const sendProjectCompletionEmail = async ({ name, email, business, completionDate, demoLink }) => {
  try {
    await doSend({
      to: email,
      subject: `✅ Your Website Is Ready for Review — ${BRAND_SHORT}`,
      html: buildCompletionHtml({ name, business, completionDate, demoLink }),
    });
  } catch (err) { console.error("sendProjectCompletionEmail:", err.message); }
};

export const sendMOMEmail = async ({ name, email, business, meetingDate, attendees, summary, actionItems }) => {
  try {
    const dateLabel = meetingDate
      ? new Date(meetingDate).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })
      : "Today";
    await doSend({
      to: email,
      subject: `📋 Minutes of Meeting — ${business || "Project Discussion"} | ${dateLabel} — ${BRAND_SHORT}`,
      html: buildMOMHtml({ name, business, meetingDate, attendees, summary, actionItems }),
    });
  } catch (err) { console.error("sendMOMEmail:", err.message); }
};

export const sendFollowupEmail = async ({ name, email, business, followupNumber, completionDate }) => {
  try {
    const num = Number(followupNumber) || 1;
    await doSend({
      to: email,
      subject: `🔔 Follow-up ${num}/3 — Awaiting Your Website Approval — ${BRAND_SHORT}`,
      html: buildFollowupHtml({ name, business, followupNumber: num, completionDate }),
    });
  } catch (err) { console.error("sendFollowupEmail:", err.message); }
};

export const sendCustomEmail = async ({ name, email, subject, body }) => {
  try {
    await doSend({
      to: email,
      subject: subject || `Message from ${BRAND_NAME}`,
      html: buildCustomHtml({ name, subject, body }),
    });
  } catch (err) { console.error("sendCustomEmail:", err.message); }
};

export const sendPaymentReminderEmail = async ({ name, email, business, amountDue, dueDate, invoiceNumber, stage }) => {
  try {
    const num = Number(stage) || 1;
    const stageLabel = num === 1 ? "Gentle Reminder" : num === 2 ? "Important Notice" : "Final Notice";
    await doSend({
      to: email,
      subject: `💳 Payment Reminder — Stage ${num}/3: ${stageLabel} — ${BRAND_SHORT}`,
      html: buildPaymentReminderHtml({ name, business, amountDue, dueDate, invoiceNumber, stage: num }),
    });
  } catch (err) { console.error("sendPaymentReminderEmail:", err.message); }
};

export const sendPaymentReceiptEmail = async ({
  name, email, business, receiptNumber, invoiceNumber,
  amountPaid, remainingAmount, paymentDate, services,
}) => {
  try {
    let attachments = [];
    try {
      const pdfBuffer = await generateInvoicePDF({
        receiptNumber, invoiceNumber, clientName: name, business,
        services, amountPaid, remainingAmount, paymentDate,
      });
      attachments = [{
        filename: `Receipt-${receiptNumber || invoiceNumber || Date.now()}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      }];
    } catch (pdfErr) {
      console.error("PDF generation failed:", pdfErr.message);
    }
    await doSend({
      to: email,
      subject: `🧾 Payment Received — Thank You! Receipt #${receiptNumber || invoiceNumber || ""} — ${BRAND_SHORT}`,
      html: buildPaymentReceiptHtml({ name, business, receiptNumber, amountPaid, remainingAmount, paymentDate }),
      attachments,
    });
  } catch (err) { console.error("sendPaymentReceiptEmail:", err.message); }
};

export const sendDocumentRequestEmail = async ({ name, email, business, serviceType }) => {
  try {
    await doSend({
      to: email,
      subject: `📂 Action Required: Share Your Project Documents — ${BRAND_SHORT}`,
      html: buildDocumentRequestHtml({ name, business, serviceType }),
    });
  } catch (err) { console.error("sendDocumentRequestEmail:", err.message); }
};

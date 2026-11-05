import mongoose from "mongoose";
import { PortalAccount, PortalMeeting, PortalDoc, notify } from "../models/Portal.js";
import sendEmail from "../utils/sendEmail.js";

// Employee Portal: meeting emails (invite, reminder, minutes…) sent from the server,
// and documents an employee sends to a colleague (for example a tester to a developer).

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const str = (v) => String(v ?? "").trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLE = { seo: "SEO Analyst", seox: "SEO Expert", ads: "Google Ads Expert", gfx: "Graphic Designer", app: "App Developer", web: "Website Developer", back: "Backend Developer", full: "Full Stack Developer", ux: "UI/UX Designer", test: "QA Tester", other: "Team Member", acc: "Accounts" };
const cleanFiles = (L) => (Array.isArray(L) ? L : []).slice(0, 10)
  .filter(f => f && /^\/uploads\/docs\/[\w.-]+$/.test(String(f.url || "")))
  .map(f => ({ url: f.url, name: str(f.name).slice(0, 120) || "file", type: str(f.type).slice(0, 80), size: num(f.size) }));

function fail(res, err, where) {
  console.error(`portal ${where} error:`, err);
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ success: false, message: err.message });
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

/* ───────── meeting emails ───────── */

const KINDS = { invite: "Meeting invite", reminder: "Meeting reminder", reschedule: "Meeting rescheduled", mom: "Minutes of meeting", followup: "Follow-up" };
const HEAD = /^(minutes of meeting|points discussed|decisions|action items|to be confirmed|agenda|next meeting.*|attendees.*)$/i;
const fmtDate = (d) => { const x = new Date(`${d}T00:00:00`); return isNaN(x) ? d : x.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
const fmtTime = (t) => { if (!t) return ""; let [h, m] = t.split(":").map(Number); const p = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${String(m || 0).padStart(2, "0")} ${p}`; };
const publicBase = (req) => process.env.PUBLIC_API_URL || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;

// Plain text from the template → tidy email HTML (headings, numbered and bulleted lists, paragraphs)
function textHtml(text) {
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) { close(); continue; }
    const num = l.match(/^\d+[.)]\s+(.*)$/), bul = l.match(/^[•\-*]\s+(.*)$/);
    if (num || bul) {
      const want = num ? "ol" : "ul";
      if (list !== want) { close(); out.push(`<${want} style="margin:6px 0 12px;padding-left:22px;color:#334155">`); list = want; }
      out.push(`<li style="margin:3px 0">${esc((num || bul)[1])}</li>`);
      continue;
    }
    close();
    if (HEAD.test(l) || /^[A-Z][A-Z ]{6,}$/.test(l)) out.push(`<h3 style="margin:18px 0 6px;font-size:14px;color:#0F172A;text-transform:uppercase;letter-spacing:.4px">${esc(l)}</h3>`);
    else out.push(`<p style="margin:0 0 10px;color:#334155">${esc(l)}</p>`);
  }
  close();
  return out.join("");
}

function meetingHtml({ kind, text, m, me, files, base }) {
  const when = `${fmtDate(m.date)}${m.time ? `, ${fmtTime(m.time)}` : ""}`;
  const rows = [["Meeting", m.title], ["When", when], ["Duration", m.dur ? `${m.dur} hour${m.dur === 1 ? "" : "s"}` : ""], ["How", m.mode], ["Client", m.refName], ["With", [m.theirs, m.ours && `NNC: ${m.ours}`].filter(Boolean).join(" · ")]].filter(r => r[1]);
  return `<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FA;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #E5E9F0;border-radius:14px;overflow:hidden">
<tr><td style="background:#0F172A;padding:18px 24px;color:#ffffff"><div style="font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#93C5FD">${esc(KINDS[kind] || "Meeting")}</div>
<div style="font-size:18px;font-weight:600;margin-top:2px">Nakshatra Namaha Creations</div></td></tr>
<tr><td style="padding:20px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;border:1px solid #E5E9F0;border-radius:10px">
${rows.map(([k, v]) => `<tr><td style="padding:7px 14px;color:#64748B;font-size:12.5px;width:90px;vertical-align:top">${esc(k)}</td><td style="padding:7px 14px;color:#0F172A;font-weight:500">${esc(v)}</td></tr>`).join("")}
</table>${m.link && kind !== "mom" ? `<p style="margin:14px 0 0"><a href="${esc(m.link)}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:600">Join the meeting</a></p>` : ""}</td></tr>
<tr><td style="padding:16px 24px 6px">${textHtml(text)}</td></tr>
${files.length ? `<tr><td style="padding:0 24px 10px"><div style="font-size:12.5px;color:#64748B;margin-bottom:6px">Documents</div>${files.map(f => `<div style="margin:3px 0"><a href="${esc(base + f.url)}" style="color:#2563EB">${esc(f.name)}</a></div>`).join("")}</td></tr>` : ""}
<tr><td style="padding:14px 24px 20px;border-top:1px solid #E5E9F0;color:#64748B;font-size:12.5px">
<b style="color:#0F172A">${esc(me.name)}</b>, ${esc(ROLE[me.role] || "Team")}<br>Nakshatra Namaha Creations Pvt Ltd · nakshatranamahacreations.com${me.email ? `<br>Reply to this email to reach ${esc(me.name.split(" ")[0])} directly.` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

// POST /api/portal/meetings/:id/email { kind, to, subject, text }
// Sent to the client, with a copy to the employee; replies go to the employee.
export async function meetingEmail(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const me = req.portal, b = req.body || {};
    const kind = KINDS[b.kind] ? b.kind : "followup";
    const to = [...new Set(str(b.to).split(/[,;\s]+/).map(x => x.toLowerCase()).filter(Boolean))].slice(0, 5);
    if (!to.length || !to.every(x => EMAIL.test(x))) return res.status(400).json({ success: false, message: "Enter the client's email address" });
    const subject = str(b.subject).slice(0, 200), text = String(b.text || "").slice(0, 20000);
    if (!subject || !text.trim()) return res.status(400).json({ success: false, message: "Write the subject and the message" });
    const m = await PortalMeeting.findOne({ _id: req.params.id, account: me._id }).select("-images");
    if (!m) return res.status(404).json({ success: false, message: "Meeting not found" });
    const files = kind === "mom" || kind === "followup" ? (m.files || []) : [];
    const html = meetingHtml({ kind, text, m, me, files, base: publicBase(req) });
    const cc = me.email && !to.includes(String(me.email).toLowerCase()) ? me.email : undefined;
    try { await sendEmail({ to: to.join(", "), cc, subject, html, replyTo: me.email || undefined }); }
    catch (err) { console.error("meetingEmail send error:", err.message); return res.status(502).json({ success: false, message: "The email could not be sent. Please try again in a minute." }); }
    const set = { clientEmail: m.clientEmail || to[0] };
    if (kind === "mom") set.sentMail = todayStr();
    const doc = await PortalMeeting.findByIdAndUpdate(m._id, { $set: set, $push: { sendLog: { $each: [{ via: kind === "mom" ? "email" : kind, to: to.join(", ").slice(0, 200), at: new Date() }], $slice: -50 } } }, { new: true }).select("-images");
    return res.json({ success: true, data: doc, message: `${KINDS[kind]} emailed to ${to.join(", ")}${cc ? ", copy to you" : ""}` });
  } catch (err) { return fail(res, err, "meetingEmail"); }
}

/* ───────── documents to a colleague ───────── */

const docOut = (d, me) => ({ ...d, mine: String(d.from) === String(me) });

// GET /api/portal/docs → { received, sent }
export async function myDocs(req, res) {
  try {
    const me = req.portal._id;
    const [received, sent] = await Promise.all([
      PortalDoc.find({ to: me }).sort({ createdAt: -1 }).limit(200).lean(),
      PortalDoc.find({ from: me }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    return res.json({ success: true, data: { received: received.map(d => docOut(d, me)), sent: sent.map(d => docOut(d, me)) } });
  } catch (err) { return fail(res, err, "myDocs"); }
}

// GET /api/portal/people → everyone active (to send a document to)
export async function people(req, res) {
  try {
    const L = await PortalAccount.find({ status: "active", _id: { $ne: req.portal._id } }).select("name role").sort({ name: 1 }).lean();
    return res.json({ success: true, data: L.map(a => ({ id: String(a._id), name: a.name, role: a.role })) });
  } catch (err) { return fail(res, err, "people"); }
}

// POST /api/portal/docs { to, refName, title, text, files }
export async function sendDoc(req, res) {
  try {
    const me = req.portal, b = req.body || {};
    const to = isId(b.to) ? await PortalAccount.findOne({ _id: b.to, status: "active" }).select("name").lean() : null;
    if (!to) return res.status(400).json({ success: false, message: "Pick who to send it to" });
    if (String(to._id) === String(me._id)) return res.status(400).json({ success: false, message: "Pick a colleague, not yourself" });
    const title = str(b.title).slice(0, 200), files = cleanFiles(b.files);
    if (!title) return res.status(400).json({ success: false, message: "Give it a title" });
    if (!files.length && !str(b.text)) return res.status(400).json({ success: false, message: "Attach a document or write a message" });
    const d = await PortalDoc.create({ from: me._id, fromName: me.name, to: to._id, toName: to.name, refName: str(b.refName).slice(0, 200), title, text: String(b.text || "").slice(0, 5000), files });
    await notify(to._id, { kind: "doc", title: `${me.name} sent you ${files.length ? `${files.length} document${files.length > 1 ? "s" : ""}` : "a note"}`, text: `${title}${d.refName ? ` · ${d.refName}` : ""}`, link: "/documents", from: me.name });
    return res.status(201).json({ success: true, data: docOut(d.toObject(), me._id) });
  } catch (err) { return fail(res, err, "sendDoc"); }
}

// PATCH /api/portal/docs/:id { action: seen | done | undone | reply, text, files }
export async function docAction(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const me = req.portal, b = req.body || {};
    const d = await PortalDoc.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: "Not found" });
    const isTo = String(d.to) === String(me._id), isFrom = String(d.from) === String(me._id);
    if (!isTo && !isFrom) return res.status(403).json({ success: false, message: "This is not shared with you" });
    if (b.action === "seen") { if (isTo && !d.seenAt) d.seenAt = new Date(); }
    else if (b.action === "done" || b.action === "undone") {
      if (!isTo) return res.status(403).json({ success: false, message: "Only the person it was sent to can mark it done" });
      d.done = b.action === "done"; if (!d.seenAt) d.seenAt = new Date();
    } else if (b.action === "reply") {
      const text = String(b.text || "").slice(0, 3000), files = cleanFiles(b.files);
      if (!text.trim() && !files.length) return res.status(400).json({ success: false, message: "Write a reply or attach a file" });
      d.replies.push({ by: me._id, name: me.name, text, files, at: new Date() });
      if (isTo && !d.seenAt) d.seenAt = new Date();
      await notify(isTo ? d.from : d.to, { kind: "doc", title: `${me.name} replied on ${d.title}`, text: text.slice(0, 160) || `${files.length} file${files.length > 1 ? "s" : ""}`, link: "/documents", from: me.name });
    } else return res.status(400).json({ success: false, message: "Unknown action" });
    await d.save();
    return res.json({ success: true, data: docOut(d.toObject(), me._id) });
  } catch (err) { return fail(res, err, "docAction"); }
}

// GET /api/portal/admin/docs → every shared document, newest first (CRM → Employee Portal → Documents)
export async function adminDocs(req, res) {
  try {
    const L = await PortalDoc.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ success: true, data: L });
  } catch (err) { return fail(res, err, "adminDocs"); }
}

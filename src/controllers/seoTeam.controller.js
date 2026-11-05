import mongoose from "mongoose";
import {
  SeoMember, SeoClient, SeoWork, SeoAdsDay, SeoKeyword, SeoSetting, SEO_ROLES, SEO_WORK_TYPES,
} from "../models/SeoTeam.js";
import Lead from "../models/Lead.js";
import { removePortalAccounts } from "../utils/portalSync.js";

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const idOrNull = (v) => (v && isId(v) ? v : null);
const str = (v) => String(v ?? "").trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// "YYYY-MM-DD" → that day at UTC midnight (same convention as calendar events)
const day = (v) => { const d = new Date(v); if (isNaN(d.getTime())) return null; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

function fail(res, err, where) {
  console.error(`${where} error:`, err);
  if (err.code === 11000) return res.status(409).json({ success: false, message: "Already exists" });
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ success: false, message: err.message });
  return res.status(500).json({ success: false, message: err.message || "Server error" });
}

/* ── GET /api/seo/all  — everything the SEO page needs ── */
export async function getAll(req, res) {
  try {
    const since = new Date(Date.now() - 400 * 864e5);
    // The team is the Employee Portal employees with an SEO, Ads or design role: add anyone not linked yet
    const { PortalAccount, rolesOf } = await import("../models/Portal.js");
    const { ensureLinks } = await import("./portal.controller.js");
    const SEO_R = ["seo", "seox", "ads", "gfx"];
    let accs = await PortalAccount.find({ status: "active" }).select("name email phone role roles status seoMember developer").lean();
    for (const a of accs) {
      if (rolesOf(a).some(r => SEO_R.includes(r))) {
        try { const l = await ensureLinks(a); a.seoMember = l.seoMember; } catch (e) { console.error("seo team link error:", e.message); }
      }
    }
    const linked = new Map(accs.filter(a => a.seoMember).map(a => [String(a.seoMember), a]));
    const [teamRaw, clients, work, ads, keywords, setting] = await Promise.all([
      SeoMember.find().sort({ isActive: -1, name: 1 }).lean(),
      SeoClient.find().sort({ isActive: -1, name: 1 }).populate("lead", "name phone email business company").lean(),
      SeoWork.find({ date: { $gte: since } }).sort({ date: -1 }).lean(),
      SeoAdsDay.find({ date: { $gte: since } }).sort({ date: -1 }).lean(),
      SeoKeyword.find().lean(),
      SeoSetting.findOne({ key: "default" }).lean(),
    ]);
    // portal: true = has an Employee Portal login (shown in the team); the others are old entries kept for past work
    const team = teamRaw.map(t => { const a = linked.get(String(t._id)); return { ...t, portal: !!a, account: a ? String(a._id) : "" }; });
    return res.json({ success: true, roles: SEO_ROLES, types: SEO_WORK_TYPES, data: { team, clients, work, ads, keywords, settings: { logo: setting?.logo || "" } } });
  } catch (err) { return fail(res, err, "seo getAll"); }
}

/* ── Leads to pick from when adding a client (with any SEO / Ads monthly service) ── */
export async function getLeadOptions(req, res) {
  try {
    const leads = await Lead.find().select("name phone email business company requirements").sort({ createdAt: -1 }).limit(1000).lean();
    const { default: RecurringService } = await import("../models/RecurringService.js");
    const svcs = await RecurringService.find({ type: { $in: ["SEO", "Google Ads", "Social Media", "Meta Ads"] } }).select("lead type amount endDate").lean();
    const byLead = {};
    for (const s of svcs) (byLead[String(s.lead)] ||= []).push({ type: s.type, amount: s.amount, active: !s.endDate || new Date(s.endDate) >= new Date() });
    return res.json({ success: true, data: leads.map(l => ({ ...l, services: byLead[String(l._id)] || [] })) });
  } catch (err) { return fail(res, err, "seo getLeadOptions"); }
}

/* ── team ── */
const memberFields = (b) => {
  const o = {};
  if (b.name !== undefined) o.name = str(b.name);
  if (b.role !== undefined) o.role = SEO_ROLES.includes(b.role) ? b.role : "seo";
  if (b.phone !== undefined) o.phone = str(b.phone);
  if (b.email !== undefined) o.email = str(b.email);
  if (b.isActive !== undefined) o.isActive = !!b.isActive;
  return o;
};
export async function createMember(req, res) {
  try {
    const f = memberFields(req.body || {});
    if (!f.name) return res.status(400).json({ success: false, message: "Name is required" });
    return res.status(201).json({ success: true, data: await SeoMember.create(f) });
  } catch (err) { return fail(res, err, "seo createMember"); }
}
export async function updateMember(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const f = memberFields(req.body || {});
    if ("name" in f && !f.name) return res.status(400).json({ success: false, message: "Name is required" });
    const m = await SeoMember.findByIdAndUpdate(req.params.id, f, { new: true, runValidators: true });
    if (!m) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: m });
  } catch (err) { return fail(res, err, "seo updateMember"); }
}
export async function deleteMember(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const id = req.params.id;
    await removePortalAccounts({ seoMember: id });   // their Employee Portal login goes too
    const used = await SeoWork.countDocuments({ who: id }) + await SeoAdsDay.countDocuments({ who: id });
    // Keep their logged work attributed: deactivate instead of deleting
    if (used) { await SeoMember.findByIdAndUpdate(id, { isActive: false }); return res.json({ success: true, deactivated: true }); }
    await SeoMember.findByIdAndDelete(id);
    await SeoClient.updateMany({ seo: id }, { seo: null });
    await SeoClient.updateMany({ ads: id }, { ads: null });
    await SeoClient.updateMany({ design: id }, { design: null });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "seo deleteMember"); }
}

/* ── clients ── */
// The team on a client: fill the SEO, Ads and design person from the members' roles (first one with each)
async function withTeam(f) {
  if (!f.members) return f;
  const M = await SeoMember.find({ _id: { $in: f.members } }).select("role roles").lean();
  const ord = f.members.map(id => M.find(m => String(m._id) === id)).filter(Boolean);
  const pick = (r) => ord.find(m => (m.roles?.length ? m.roles : [m.role]).includes(r))?._id || null;
  return { ...f, seo: pick("seo"), ads: pick("ads"), design: pick("design") };
}

const clientFields = (b) => {
  const o = {};
  for (const k of ["name", "contact", "phone", "email", "site"]) if (b[k] !== undefined) o[k] = str(b[k]);
  if (b.site !== undefined) o.site = str(b.site).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (b.lead !== undefined) o.lead = idOrNull(b.lead);
  if (b.start !== undefined) o.start = day(b.start);
  for (const k of ["seo", "ads", "design"]) if (b[k] !== undefined) o[k] = idOrNull(b[k]);
  if (Array.isArray(b.members)) o.members = [...new Set(b.members.filter(isId).map(String))];
  if (b.budget !== undefined) o.budget = Math.max(0, num(b.budget));
  if (b.targets && typeof b.targets === "object") {
    for (const k of ["backlink", "blog", "gmb", "poster"]) if (b.targets[k] !== undefined) o[`targets.${k}`] = Math.max(0, num(b.targets[k]));
  }
  if (b.isActive !== undefined) o.isActive = !!b.isActive;
  return o;
};
export async function createClient(req, res) {
  try {
    const f = await withTeam(clientFields(req.body || {}));
    if (!f.name) return res.status(400).json({ success: false, message: "Client name is required" });
    if (!f.start) f.start = day(new Date());
    const doc = new SeoClient();
    for (const [k, v] of Object.entries(f)) doc.set(k, v);
    await doc.save();
    // Agreed keywords added together with the client
    const kws = Array.isArray(req.body.keywords) ? [...new Set(req.body.keywords.map(str).filter(Boolean))] : [];
    if (kws.length) await SeoKeyword.insertMany(kws.map(keyword => ({ client: doc._id, keyword, added: f.start, hist: [] })), { ordered: false }).catch(() => {});
    const data = await SeoClient.findById(doc._id).populate("lead", "name phone email business company").lean();
    return res.status(201).json({ success: true, data });
  } catch (err) { return fail(res, err, "seo createClient"); }
}
export async function updateClient(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const f = await withTeam(clientFields(req.body || {}));
    if ("name" in f && !f.name) return res.status(400).json({ success: false, message: "Client name is required" });
    const c = await SeoClient.findByIdAndUpdate(req.params.id, { $set: f }, { new: true, runValidators: true }).populate("lead", "name phone email business company").lean();
    if (!c) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: c });
  } catch (err) { return fail(res, err, "seo updateClient"); }
}
export async function deleteClient(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const id = req.params.id;
    const used = await SeoWork.countDocuments({ client: id }) + await SeoAdsDay.countDocuments({ client: id });
    if (used) { await SeoClient.findByIdAndUpdate(id, { isActive: false }); return res.json({ success: true, deactivated: true }); }
    await SeoKeyword.deleteMany({ client: id });
    await SeoClient.findByIdAndDelete(id);
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "seo deleteClient"); }
}

/* ── work log ── */
// POST /api/seo/work  { client, who, date, type, status, items: [{ url, title, kw, da, platform }] }
export async function addWork(req, res) {
  try {
    const b = req.body || {};
    if (!isId(b.client)) return res.status(400).json({ success: false, message: "Pick a client" });
    if (!SEO_WORK_TYPES.includes(b.type)) return res.status(400).json({ success: false, message: "Invalid type" });
    const date = day(b.date || new Date());
    const items = (Array.isArray(b.items) ? b.items : [b]).slice(0, 500);
    const docs = items.map(i => ({
      client: b.client, who: idOrNull(b.who), date, type: b.type, status: b.status === "pending" ? "pending" : "live",
      url: str(i.url), title: str(i.title), kw: str(i.kw), da: i.da ? Math.min(100, Math.max(0, num(i.da))) : null, platform: str(i.platform),
      by: req.actorName || "",
    })).filter(d => d.url || d.title);
    if (!docs.length) return res.status(400).json({ success: false, message: "Add at least one link or title" });
    const data = await SeoWork.insertMany(docs);
    return res.status(201).json({ success: true, data });
  } catch (err) { return fail(res, err, "seo addWork"); }
}
export async function updateWork(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const b = req.body || {}, f = {};
    for (const k of ["url", "title", "kw", "platform"]) if (b[k] !== undefined) f[k] = str(b[k]);
    if (b.status) f.status = b.status === "pending" ? "pending" : "live";
    if (b.date) f.date = day(b.date);
    const w = await SeoWork.findByIdAndUpdate(req.params.id, f, { new: true });
    if (!w) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: w });
  } catch (err) { return fail(res, err, "seo updateWork"); }
}
export async function deleteWork(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await SeoWork.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "seo deleteWork"); }
}

/* ── Google Ads daily report (replaces the client's report for that day) ── */
export async function saveAdsDay(req, res) {
  try {
    const b = req.body || {};
    if (!isId(b.client)) return res.status(400).json({ success: false, message: "Pick a client" });
    const date = day(b.date || new Date());
    const terms = (Array.isArray(b.terms) ? b.terms : []).slice(0, 2000).map(t => ({
      t: str(t.t), clicks: num(t.clicks), impr: num(t.impr), cost: num(t.cost), conv: num(t.conv),
    })).filter(t => t.t);
    const doc = {
      client: b.client, who: idOrNull(b.who), date,
      spend: num(b.spend), clicks: num(b.clicks), impr: num(b.impr), conv: num(b.conv),
      terms, negs: (Array.isArray(b.negs) ? b.negs : []).map(str).filter(Boolean), notes: str(b.notes),
    };
    const data = await SeoAdsDay.findOneAndUpdate({ client: b.client, date }, { $set: doc, $setOnInsert: { sent: false } }, { new: true, upsert: true, runValidators: true });
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err, "seo saveAdsDay"); }
}
export async function markAdsSent(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const data = await SeoAdsDay.findByIdAndUpdate(req.params.id, { sent: req.body?.sent !== false, sentAt: new Date() }, { new: true });
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err, "seo markAdsSent"); }
}
export async function deleteAdsDay(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await SeoAdsDay.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "seo deleteAdsDay"); }
}

/* ── keyword positions ── */
// POST /api/seo/keywords  { client, keyword, pos?, url? }
export async function addKeyword(req, res) {
  try {
    const b = req.body || {};
    if (!isId(b.client)) return res.status(400).json({ success: false, message: "Pick a client" });
    const keyword = str(b.keyword);
    if (!keyword) return res.status(400).json({ success: false, message: "Keyword is required" });
    const today = day(new Date());
    const hasPos = b.pos !== undefined && b.pos !== "" && b.pos !== null;
    const p = parseInt(b.pos, 10);
    const data = await SeoKeyword.create({
      client: b.client, keyword, added: today,
      hist: hasPos ? [{ date: today, pos: p > 0 && p <= 100 ? p : null, url: str(b.url) }] : [],
    });
    return res.status(201).json({ success: true, data });
  } catch (err) { return fail(res, err, "seo addKeyword"); }
}
// POST /api/seo/keywords/check  { client, date, rows: [{ keyword, pos, url }] } — one rank check
export async function rankCheck(req, res) {
  try {
    const b = req.body || {};
    if (!isId(b.client)) return res.status(400).json({ success: false, message: "Pick a client" });
    const date = day(b.date || new Date());
    const rows = (Array.isArray(b.rows) ? b.rows : []).map(r => ({ keyword: str(r.keyword), pos: parseInt(r.pos, 10), url: str(r.url) })).filter(r => r.keyword);
    let n = 0;
    for (const r of rows) {
      const kw = (await SeoKeyword.findOne({ client: b.client, keyword: r.keyword })) || new SeoKeyword({ client: b.client, keyword: r.keyword, added: date, hist: [] });
      kw.hist = kw.hist.filter(h => new Date(h.date).getTime() !== date.getTime());
      kw.hist.push({ date, pos: r.pos > 0 && r.pos <= 100 ? r.pos : null, url: r.url });
      kw.hist.sort((a, z) => new Date(a.date) - new Date(z.date));
      await kw.save();
      n++;
    }
    return res.json({ success: true, saved: n });
  } catch (err) { return fail(res, err, "seo rankCheck"); }
}
export async function deleteKeyword(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await SeoKeyword.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "seo deleteKeyword"); }
}

/* ── report logo ── */
export async function saveSettings(req, res) {
  try {
    const logo = str(req.body?.logo);
    if (logo && (!/^data:image\/(png|jpe?g|svg\+xml|webp);base64,/.test(logo) || logo.length > 700000)) {
      return res.status(400).json({ success: false, message: "Logo must be a PNG, JPG, SVG or WEBP under 500 KB" });
    }
    const s = await SeoSetting.findOneAndUpdate({ key: "default" }, { logo }, { new: true, upsert: true });
    return res.json({ success: true, data: { logo: s.logo } });
  } catch (err) { return fail(res, err, "seo saveSettings"); }
}

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PortalAccount, PortalWork, PortalTask, PortalMeeting, PortalBlocker, PortalDay, PortalSetting, PORTAL_ROLES, notify } from "../models/Portal.js";
import { SeoClient, SeoMember } from "../models/SeoTeam.js";
import Lead from "../models/Lead.js";
import Developer from "../models/Developer.js";
import { removePortalAccounts, checkPassword } from "../utils/portalSync.js";
import { ensureLinks, getSettingsDoc } from "./portal.controller.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const str = (v) => String(v ?? "").trim();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

function fail(res, err, where) {
  console.error(`portal admin ${where} error:`, err);
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ success: false, message: err.message });
  return res.status(500).json({ success: false, message: err.message || "Server error" });
}

const SEO_FIELD = { seo: "seo", seox: "seo", ads: "ads", gfx: "design" };

// What each employee works on (SEO clients or projects), for the Employees table
async function worksOn(accs) {
  const seoIds = accs.filter(a => a.seoMember).map(a => a.seoMember);
  const devIds = accs.filter(a => a.developer).map(a => a.developer);
  const [clients, leads] = await Promise.all([
    seoIds.length ? SeoClient.find({ $or: [{ seo: { $in: seoIds } }, { ads: { $in: seoIds } }, { design: { $in: seoIds } }] }).select("name seo ads design").lean() : [],
    devIds.length ? Lead.find({ developers: { $in: devIds } }).select("name business developers").lean() : [],
  ]);
  return (a) => {
    if (a.role === "acc") return "All projects (accounts)";
    const L = [];
    if (a.seoMember) clients.filter(c => String(c[SEO_FIELD[a.role]] || "") === String(a.seoMember)).forEach(c => L.push(c.name));
    if (a.developer) leads.filter(l => (l.developers || []).some(d => String(d) === String(a.developer))).forEach(l => L.push(l.business || l.name));
    return L.join(", ");
  };
}

export async function listAccounts(req, res) {
  try {
    const accs = await PortalAccount.find().sort({ createdAt: -1 }).lean();
    const [w, devs, mems] = await Promise.all([
      worksOn(accs),
      Developer.find({ _id: { $in: accs.map(a => a.developer).filter(Boolean) } }).select("_id").lean(),
      SeoMember.find({ _id: { $in: accs.map(a => a.seoMember).filter(Boolean) } }).select("_id").lean(),
    ]);
    // linked CRM record was deleted (eg. removed from Settings → Developers)
    const orphan = (a) => (a.developer && !devs.some(d => String(d._id) === String(a.developer))) || (a.seoMember && !mems.some(m => String(m._id) === String(a.seoMember)));
    return res.json({
      success: true,
      data: accs.map(a => ({
        id: String(a._id), name: a.name, email: a.email, phone: a.phone, role: a.role, status: a.status, mustChange: a.mustChange,
        created: a.createdAt, lastLogin: a.lastLogin, logins: a.logins || 0, worksOn: w(a), orphan: !!orphan(a),
      })),
    });
  } catch (err) { return fail(res, err, "listAccounts"); }
}

// PUT /api/portal/admin/accounts/:id { status: active|disabled, role? }
export async function updateAccount(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const acc = await PortalAccount.findById(req.params.id);
    if (!acc) return res.status(404).json({ success: false, message: "Not found" });
    const b = req.body || {};
    if (b.status && ["active", "disabled", "pending"].includes(b.status)) {
      if (b.status === "active" && acc.status === "pending") acc.approvedBy = req.actorName || "Admin";
      acc.status = b.status;
    }
    if (b.role && PORTAL_ROLES.includes(b.role)) acc.role = b.role;
    await acc.save();
    if (acc.status === "active") await ensureLinks(acc.toObject());
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "updateAccount"); }
}

// PUT /api/portal/admin/accounts/:id/password { password }  → admin sets the password the employee signs in with
export async function setPassword(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const pw = String(req.body?.password || "");
    checkPassword(pw);
    const r = await PortalAccount.updateOne({ _id: req.params.id }, { $set: { password: await bcrypt.hash(pw, 10), mustChange: false } });
    if (!r.matchedCount) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true });
  } catch (err) { return err.status ? res.status(err.status).json({ success: false, message: err.message }) : fail(res, err, "setPassword"); }
}

// DELETE /api/portal/admin/accounts/:id  → removes the login and the linked CRM Developer / SEO member
export async function deleteAccount(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const acc = await PortalAccount.findById(req.params.id).lean();
    if (!acc) return res.status(404).json({ success: false, message: "Not found" });
    if (acc.developer) {
      await Lead.updateMany({ developers: acc.developer }, { $pull: { developers: acc.developer } });
      await Developer.deleteOne({ _id: acc.developer });
    }
    if (acc.seoMember) {
      // keep SEO work attributed: the member is only marked inactive and taken off clients
      await SeoMember.updateOne({ _id: acc.seoMember }, { isActive: false });
      await SeoClient.updateMany({ seo: acc.seoMember }, { seo: null });
      await SeoClient.updateMany({ ads: acc.seoMember }, { ads: null });
      await SeoClient.updateMany({ design: acc.seoMember }, { design: null });
    }
    await removePortalAccounts({ _id: acc._id });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "deleteAccount"); }
}

// POST /api/portal/admin/accounts/:id/reset  → returns a temporary password to share
export async function resetPassword(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const tmp = `NNC${crypto.randomInt(1000, 9999)}!${crypto.randomBytes(2).toString("hex")}`;
    const r = await PortalAccount.updateOne({ _id: req.params.id }, { $set: { password: await bcrypt.hash(tmp, 10), mustChange: true } });
    if (!r.matchedCount) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, tempPassword: tmp });
  } catch (err) { return fail(res, err, "resetPassword"); }
}

// GET /api/portal/admin/work?from=&to=  → everyone's work, days and blockers in the range
export async function teamWork(req, res) {
  try {
    const to = isDay(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
    const from = isDay(req.query.from) ? req.query.from : to;
    const [accs, work, days, blockers] = await Promise.all([
      PortalAccount.find().select("name role status").lean(),
      PortalWork.find({ date: { $gte: from, $lte: to } }).sort({ date: -1, createdAt: -1 }).limit(3000).lean(),
      PortalDay.find({ date: { $gte: from, $lte: to } }).lean(),
      PortalBlocker.find({ resolved: false }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);
    return res.json({ success: true, data: { accounts: accs.map(a => ({ id: String(a._id), name: a.name, role: a.role, status: a.status })), work, days, blockers } });
  } catch (err) { return fail(res, err, "teamWork"); }
}

export async function resolveBlocker(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const bl = await PortalBlocker.findByIdAndUpdate(req.params.id, { resolved: true });
    if (bl) await notify(bl.account, { kind: "info", title: `${req.actorName || "Admin"} marked your blocker as sorted`, text: bl.text, link: "/", from: req.actorName || "Admin" });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "resolveBlocker"); }
}

export async function allMeetings(req, res) {
  try {
    const M = await PortalMeeting.find().sort({ date: -1, time: -1 }).limit(300).populate("account", "name role").lean();
    return res.json({ success: true, data: M });
  } catch (err) { return fail(res, err, "allMeetings"); }
}

// POST /api/portal/admin/tasks { account, title, due, refName }
export async function assignTask(req, res) {
  try {
    const b = req.body || {};
    if (!isId(b.account) || !str(b.title) || !isDay(b.due)) return res.status(400).json({ success: false, message: "Pick the employee, the task and a due date" });
    if (!(await PortalAccount.exists({ _id: b.account }))) return res.status(404).json({ success: false, message: "Employee not found" });
    let refId = null, refName = str(b.refName);
    if (isId(b.refId)) {
      const [l, c] = await Promise.all([Lead.findById(b.refId).select("name business company").lean(), SeoClient.findById(b.refId).select("name").lean()]);
      if (l) { refId = l._id; refName = l.business || l.company ? `${l.name} · ${l.business || l.company}` : l.name; }
      else if (c) { refId = c._id; refName = c.name; }
    }
    const t = await PortalTask.create({ account: b.account, title: str(b.title), refName, refId, due: b.due, from: req.actorName || "Admin" });
    await notify(b.account, { kind: "task", title: `New task from ${t.from}`, text: `${t.title}${t.refName ? ` · ${t.refName}` : ""} · due ${t.due}`, link: "/tasks", from: t.from });
    return res.status(201).json({ success: true, data: t });
  } catch (err) { return fail(res, err, "assignTask"); }
}
// GET /api/portal/admin/accounts/:id/projects → projects or clients to pick for a task (theirs first)
export async function accountProjects(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const a = await PortalAccount.findById(req.params.id).select("role developer seoMember").lean();
    if (!a) return res.status(404).json({ success: false, message: "Not found" });
    const pn = (l) => (l.business || l.company ? `${l.name} · ${l.business || l.company}` : l.name);
    if (a.seoMember) {
      const C = await SeoClient.find({ [SEO_FIELD[a.role] || "seo"]: a.seoMember }).select("name").sort({ name: 1 }).lean();
      return res.json({ success: true, data: { mine: C.map(c => ({ id: String(c._id), name: c.name, kind: "client" })), others: [] } });
    }
    const L = await Lead.find({ $or: [{ projectStage: { $nin: ["", null] } }, { developers: { $exists: true, $ne: [] } }] })
      .select("name business company projectStage projectCompleted developers").sort({ updatedAt: -1 }).limit(300).lean();
    const row = (l) => ({ id: String(l._id), name: pn(l), kind: "project", stage: l.projectCompleted ? "Project Completed" : l.projectStage || "" });
    const isMine = (l) => a.developer && (l.developers || []).some(d => String(d) === String(a.developer));
    return res.json({ success: true, data: { mine: L.filter(isMine).map(row), others: L.filter(l => !isMine(l)).map(row) } });
  } catch (err) { return fail(res, err, "accountProjects"); }
}

export async function listTasks(req, res) {
  try {
    const T = await PortalTask.find({ from: { $ne: "me" } }).sort({ due: 1 }).limit(500).populate("account", "name").lean();
    return res.json({ success: true, data: T });
  } catch (err) { return fail(res, err, "listTasks"); }
}

export async function getSettings(req, res) {
  try { return res.json({ success: true, data: await getSettingsDoc() }); }
  catch (err) { return fail(res, err, "getSettings"); }
}
export async function saveSettings(req, res) {
  try {
    const b = req.body || {}, set = {};
    if (b.approval !== undefined) set.approval = !!b.approval;
    if (b.domainOnly !== undefined) set.domainOnly = !!b.domainOnly;
    if (b.showSecrets !== undefined) set.showSecrets = !!b.showSecrets;
    const s = await PortalSetting.findOneAndUpdate({ key: "default" }, { $set: set }, { new: true, upsert: true }).lean();
    return res.json({ success: true, data: s });
  } catch (err) { return fail(res, err, "saveSettings"); }
}

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PortalAccount, PortalWork, PortalTask, PortalMeeting, PortalBlocker, PortalDay, PortalAttendance, PortalSetting, PortalMessage, PortalDoc, PORTAL_ROLES, notify , rolesOf } from "../models/Portal.js";
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

const pname = (l) => (l.business || l.company ? `${l.name} · ${l.business || l.company}` : l.name);
const stageOf = (l) => (l.projectCompleted ? "Project Completed" : l.projectStage || "");
const projectFilter = { $or: [{ projectStage: { $nin: ["", null] } }, { developers: { $exists: true, $ne: [] } }] };

// What each employee works on (SEO clients or projects), for the Employees table
async function worksOn(accs) {
  const seoIds = accs.filter(a => a.seoMember).map(a => a.seoMember);
  const devIds = accs.filter(a => a.developer).map(a => a.developer);
  const [clients, leads] = await Promise.all([
    seoIds.length ? SeoClient.find({ $or: [{ seo: { $in: seoIds } }, { ads: { $in: seoIds } }, { design: { $in: seoIds } }, { members: { $in: seoIds } }] }).select("name seo ads design members").lean() : [],
    devIds.length ? Lead.find({ developers: { $in: devIds } }).select("name business company projectStage projectCompleted developers").sort({ updatedAt: -1 }).lean() : [],
  ]);
  return (a) => {
    const L = [];
    const F = [...new Set(rolesOf(a).map(r => SEO_FIELD[r]).filter(Boolean))];
    if (a.seoMember) clients.filter(c => (c.members || []).some(x => String(x) === String(a.seoMember)) || F.some(f => String(c[f] || "") === String(a.seoMember))).forEach(c => L.push({ id: String(c._id), name: c.name, kind: "client", stage: "" }));
    if (a.developer) leads.filter(l => (l.developers || []).some(d => String(d) === String(a.developer))).forEach(l => L.push({ id: String(l._id), name: pname(l), kind: "project", stage: stageOf(l) }));
    return L;
  };
}

// Projects an employee is on (through their linked CRM developer); creates the link first if needed
async function setProjects(acc, ids) {
  const linked = acc.developer ? acc : await ensureLinks(acc);
  if (!linked.developer) { const e = new Error("Only development, design and testing roles are put on projects"); e.status = 400; throw e; }
  const keep = (Array.isArray(ids) ? [...new Set(ids.map(String))] : []).filter(isId);
  await Promise.all([
    Lead.updateMany({ developers: linked.developer, _id: { $nin: keep } }, { $pull: { developers: linked.developer } }),
    keep.length ? Lead.updateMany({ _id: { $in: keep } }, { $addToSet: { developers: linked.developer } }) : null,
  ]);
}

const DEV_ROLE = { app: "Mobile App", web: "Frontend", back: "Backend", full: "Full Stack", ux: "UI/UX Designer", test: "Tester / QA", other: "Other" };
const SEO_ROLE = { seo: "seo", seox: "seo", ads: "ads", gfx: "design" };
const ok = (res, err, where) => (err.status ? res.status(err.status).json({ success: false, message: err.message }) : fail(res, err, where));

// POST /api/portal/admin/accounts { name, email, phone, role, password, projectIds } → an active employee, added by the admin
export async function createAccount(req, res) {
  try {
    const b = req.body || {};
    const name = str(b.name), email = str(b.email).toLowerCase(), phone = str(b.phone), role = str(b.role), pw = String(b.password || "");
    if (!name || !email || !role || !pw) return res.status(400).json({ success: false, message: "Name, email, role and password are needed" });
    if (!PORTAL_ROLES.includes(role)) return res.status(400).json({ success: false, message: "Choose a role" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email" });
    checkPassword(pw);
    if (await PortalAccount.exists({ email })) return res.status(409).json({ success: false, message: "An employee with this email already exists" });
    const extra = (Array.isArray(b.roles) ? b.roles : []).map(str).filter(r => PORTAL_ROLES.includes(r) && r !== role);
    const acc = await PortalAccount.create({ name, email, phone: phone || "-", branch: str(b.branch), role, roles: [...new Set(extra)], password: await bcrypt.hash(pw, 10), status: "active", approvedBy: req.actorName || "Admin" });
    const linked = await ensureLinks(acc.toObject());
    if (linked.developer && Array.isArray(b.projectIds) && b.projectIds.length) await setProjects(linked, b.projectIds);
    return res.status(201).json({ success: true, data: { id: String(acc._id) } });
  } catch (err) { return ok(res, err, "createAccount"); }
}

// PUT /api/portal/admin/accounts/:id/projects { projectIds } → replaces the projects this employee is on
export async function updateProjects(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const acc = await PortalAccount.findById(req.params.id).lean();
    if (!acc) return res.status(404).json({ success: false, message: "Not found" });
    await setProjects(acc, req.body?.projectIds);
    return res.json({ success: true });
  } catch (err) { return ok(res, err, "updateProjects"); }
}

export async function listAccounts(req, res) {
  try {
    const accs = await PortalAccount.find().sort({ createdAt: -1 }).lean();
    const [w, devs, mems] = await Promise.all([
      worksOn(accs),
      Developer.find({ _id: { $in: accs.map(a => a.developer).filter(Boolean) } }).select("_id").lean(),
      SeoMember.find({ _id: { $in: accs.map(a => a.seoMember).filter(Boolean) } }).select("_id").lean(),
    ]);
    // linked CRM record was deleted (eg. a developer removed before the portal sync)
    const orphan = (a) => (a.developer && !devs.some(d => String(d._id) === String(a.developer))) || (a.seoMember && !mems.some(m => String(m._id) === String(a.seoMember)));
    return res.json({
      success: true,
      data: accs.map(a => ({
        id: String(a._id), name: a.name, email: a.email, phone: a.phone, branch: a.branch || "", role: a.role, roles: rolesOf(a), status: a.status, mustChange: a.mustChange,
        created: a.createdAt, lastLogin: a.lastLogin, logins: a.logins || 0, works: w(a), orphan: !!orphan(a),
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
    if (Array.isArray(b.roles)) acc.roles = [...new Set(b.roles.map(str).filter(r => PORTAL_ROLES.includes(r) && r !== acc.role))];
    if (str(b.name)) acc.name = str(b.name);
    if (b.phone !== undefined && str(b.phone)) acc.phone = str(b.phone);
    if (b.branch !== undefined) acc.branch = str(b.branch);
    await acc.save();
    const set = { name: acc.name, phone: acc.phone === "-" ? "" : acc.phone };
    if (acc.developer) await Developer.updateOne({ _id: acc.developer }, { ...set, ...(DEV_ROLE[acc.role] ? { role: DEV_ROLE[acc.role] } : {}) });
    if (acc.seoMember) await SeoMember.updateOne({ _id: acc.seoMember }, { ...set, ...(SEO_ROLE[acc.role] ? { role: SEO_ROLE[acc.role] } : {}) });
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
    const [accs, work, days, blockers, attendance] = await Promise.all([
      PortalAccount.find().select("name role status").lean(),
      PortalWork.find({ date: { $gte: from, $lte: to } }).sort({ date: -1, createdAt: -1 }).limit(3000).lean(),
      PortalDay.find({ date: { $gte: from, $lte: to } }).lean(),
      PortalBlocker.find({ resolved: false }).sort({ createdAt: -1 }).limit(200).lean(),
      PortalAttendance.find({ date: { $gte: from, $lte: to } }).lean(),
    ]);
    return res.json({ success: true, data: { accounts: accs.map(a => ({ id: String(a._id), name: a.name, role: a.role, status: a.status })), work, days, blockers, attendance } });
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
    // photos are left out of the list to keep it fast; GET /admin/meetings/:id has them
    const M = await PortalMeeting.find().select("-images").sort({ date: -1, time: -1 }).limit(300).populate("account", "name role").lean();
    return res.json({ success: true, data: M });
  } catch (err) { return fail(res, err, "allMeetings"); }
}
export async function oneMeeting(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const m = await PortalMeeting.findById(req.params.id).populate("account", "name role").lean();
    if (!m) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: m });
  } catch (err) { return fail(res, err, "oneMeeting"); }
}

// DELETE /api/portal/admin/meetings/:id → the meeting and its timesheet entry
export async function deleteMeetingAdmin(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const m = await PortalMeeting.findByIdAndDelete(req.params.id).select("_id").lean();
    if (!m) return res.status(404).json({ success: false, message: "Not found" });
    await PortalWork.deleteMany({ type: "meeting", "meta.meeting": String(m._id) });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "deleteMeetingAdmin"); }
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
    if (req.params.id !== "new" && !isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const a = req.params.id === "new" ? { role: "full" } : await PortalAccount.findById(req.params.id).select("role roles developer seoMember").lean();
    if (!a) return res.status(404).json({ success: false, message: "Not found" });
    if (a.seoMember) {
      const F = [...new Set(rolesOf(a).map(r => SEO_FIELD[r]).filter(Boolean))];
      const C = await SeoClient.find({ $or: [{ members: a.seoMember }, ...(F.length ? F : ["seo"]).map(f => ({ [f]: a.seoMember }))] }).select("name").sort({ name: 1 }).lean();
      return res.json({ success: true, data: { mine: C.map(c => ({ id: String(c._id), name: c.name, kind: "client" })), others: [] } });
    }
    const L = await Lead.find(projectFilter)
      .select("name business company projectStage projectCompleted developers").sort({ updatedAt: -1 }).limit(300).lean();
    const row = (l) => ({ id: String(l._id), name: pname(l), kind: "project", stage: stageOf(l) });
    const isMine = (l) => a.developer && (l.developers || []).some(d => String(d) === String(a.developer));
    return res.json({ success: true, data: { mine: L.filter(isMine).map(row), others: L.filter(l => !isMine(l)).map(row) } });
  } catch (err) { return fail(res, err, "accountProjects"); }
}

// GET /api/portal/admin/counts?work=&meetings=&docs=&tasks= (ISO times the admin last opened each tab)
// → what is new in each Employee Portal tab: sign-ups waiting, unread messages, and work, meetings,
//   documents and task updates from employees since that tab was last opened (default: the last 24 hours)
export async function counts(req, res) {
  try {
    const dflt = new Date(Date.now() - 864e5);
    const since = (k) => { const d = new Date(String(req.query[k] || "")); return isNaN(d) ? dflt : d; };
    const [people, messages, work, meetings, docs, tasks] = await Promise.all([
      PortalAccount.countDocuments({ status: "pending" }),
      PortalMessage.countDocuments({ from: "emp", readAdmin: false }),
      PortalWork.countDocuments({ createdAt: { $gt: since("work") } }),
      PortalMeeting.countDocuments({ createdAt: { $gt: since("meetings") } }),
      PortalDoc.countDocuments({ createdAt: { $gt: since("docs") } }),
      PortalTask.countDocuments({ from: { $ne: "me" }, status: { $ne: "todo" }, updatedAt: { $gt: since("tasks") } }),
    ]);
    const data = { people, messages, work, meetings, docs, tasks };
    return res.json({ success: true, data, total: Object.values(data).reduce((a, n) => a + n, 0) });
  } catch (err) { return fail(res, err, "counts"); }
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

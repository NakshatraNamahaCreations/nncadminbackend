import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import {
  PortalAccount, PortalWork, PortalTask, PortalMeeting, PortalBlocker, PortalDay, PortalSetting, PORTAL_ROLES,
} from "../models/Portal.js";
import { SeoMember, SeoClient, SeoWork, SeoAdsDay, SeoKeyword } from "../models/SeoTeam.js";
import Developer from "../models/Developer.js";
import Lead from "../models/Lead.js";
import { signPortalToken } from "../middleware/portalAuth.js";
import { notify } from "../models/Portal.js";
import { notifyProjectTeam } from "./portalComms.controller.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const str = (v) => String(v ?? "").trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const digits = (v) => String(v || "").replace(/\D/g, "");
const utcDay = (s) => new Date(`${s}T00:00:00.000Z`);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function fail(res, err, where) {
  console.error(`portal ${where} error:`, err);
  if (err.code === 11000) return res.status(409).json({ success: false, message: "Already exists" });
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ success: false, message: err.message });
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

export async function getSettingsDoc() {
  return (await PortalSetting.findOne({ key: "default" }).lean()) || { approval: true, domainOnly: false, showSecrets: true, domain: "nakshatranamahacreations.com" };
}

const SEO_ROLE = { seo: "seo", seox: "seo", ads: "ads", gfx: "design" };
const DEV_ROLE = { app: "Mobile App", web: "Frontend", back: "Backend", full: "Full Stack", ux: "UI/UX Designer", test: "Tester / QA", other: "Other" };
const SEO_FIELD = { seo: "seo", seox: "seo", ads: "ads", gfx: "design" };

// Create the CRM records an active employee is linked to (SEO team member or Developer)
export async function ensureLinks(acc) {
  const upd = {};
  if (SEO_ROLE[acc.role] && !acc.seoMember) {
    // reuse the SEO member already added in the CRM with this email, so nobody shows twice
    const m = (acc.email && await SeoMember.findOne({ email: acc.email }).select("_id").lean())
      || await SeoMember.create({ name: acc.name, role: SEO_ROLE[acc.role], phone: acc.phone, email: acc.email });
    upd.seoMember = m._id;
  }
  if (DEV_ROLE[acc.role] && !acc.developer) {
    const d = (acc.email && await Developer.findOne({ email: acc.email }).select("_id").lean())
      || await Developer.create({ name: acc.name, role: DEV_ROLE[acc.role], phone: acc.phone, email: acc.email });
    upd.developer = d._id;
  }
  if (Object.keys(upd).length) await PortalAccount.updateOne({ _id: acc._id }, { $set: upd });
  return { ...acc, ...upd };
}

const publicAccount = (a) => ({
  id: String(a._id), name: a.name, email: a.email, phone: a.phone, role: a.role, status: a.status,
  mustChange: !!a.mustChange, created: a.createdAt, lastLogin: a.lastLogin, logins: a.logins || 0,
});

/* ───────── public ───────── */

export async function publicSettings(req, res) {
  try {
    const s = await getSettingsDoc();
    return res.json({ success: true, data: { approval: s.approval, domainOnly: s.domainOnly, domain: s.domain, roles: PORTAL_ROLES } });
  } catch (err) { return fail(res, err, "publicSettings"); }
}

// POST /api/portal/signup { name, email, phone, role, password }
export async function signup(req, res) {
  try {
    const b = req.body || {};
    const name = str(b.name), email = str(b.email).toLowerCase(), phone = str(b.phone), role = str(b.role), pw = String(b.password || "");
    const s = await getSettingsDoc();
    if (!name || !email || !phone || !role || !pw) return res.status(400).json({ success: false, message: "Fill in every field" });
    if (!PORTAL_ROLES.includes(role)) return res.status(400).json({ success: false, message: "Choose your role" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: "Enter a valid email" });
    if (s.domainOnly && !email.endsWith(`@${s.domain}`)) return res.status(400).json({ success: false, message: `Please use your @${s.domain} email.` });
    if (digits(phone).length < 10) return res.status(400).json({ success: false, message: "Enter a 10 digit mobile number." });
    if (pw.length < 8 || !/\d/.test(pw)) return res.status(400).json({ success: false, message: "Password needs at least 8 characters and a number." });
    if (await PortalAccount.exists({ email })) return res.status(409).json({ success: false, message: "An account with this email already exists. Sign in instead." });
    const last10 = digits(phone).slice(-10);
    const clash = await PortalAccount.find({ phone: { $regex: last10.split("").join("\\D*") + "$" } }).select("_id").limit(1).lean();
    if (clash.length) return res.status(409).json({ success: false, message: "This mobile number is already registered." });

    let acc = await PortalAccount.create({ name, email, phone, role, password: await bcrypt.hash(pw, 10), status: s.approval ? "pending" : "active" });
    acc = acc.toObject();
    if (acc.status === "pending") return res.status(201).json({ success: true, pending: true, message: "Account created. The admin needs to approve it before you can sign in." });
    acc = await ensureLinks(acc);
    await PortalAccount.updateOne({ _id: acc._id }, { $set: { lastLogin: new Date() }, $inc: { logins: 1 } });
    return res.status(201).json({ success: true, data: { token: signPortalToken(acc), user: publicAccount(acc) } });
  } catch (err) { return fail(res, err, "signup"); }
}

// POST /api/portal/login { id (email or mobile), password }
export async function login(req, res) {
  try {
    const idv = str(req.body?.id).toLowerCase(), pw = String(req.body?.password || "");
    if (!idv || !pw) return res.status(400).json({ success: false, message: "Enter your email or mobile and password" });
    let acc = await PortalAccount.findOne({ email: idv }).select("+password");
    if (!acc && digits(idv).length >= 10) {
      const last10 = digits(idv).slice(-10);
      acc = await PortalAccount.findOne({ phone: { $regex: last10.split("").join("\\D*") + "$" } }).select("+password");
    }
    if (!acc || !(await bcrypt.compare(pw, acc.password))) return res.status(401).json({ success: false, message: "Email/mobile or password is wrong." });
    if (acc.status === "pending") return res.status(403).json({ success: false, message: "Your account is waiting for approval from the admin." });
    if (acc.status === "disabled") return res.status(403).json({ success: false, message: "This account is disabled. Please contact your admin." });
    acc.lastLogin = new Date(); acc.logins = (acc.logins || 0) + 1;
    await acc.save();
    const linked = await ensureLinks(acc.toObject());
    return res.json({ success: true, data: { token: signPortalToken(linked), user: publicAccount(linked) } });
  } catch (err) { return fail(res, err, "login"); }
}

/* ───────── me ───────── */

export async function getMe(req, res) {
  return res.json({ success: true, data: publicAccount(req.portal) });
}
export async function updateMe(req, res) {
  try {
    const name = str(req.body?.name), phone = str(req.body?.phone);
    if (!name || digits(phone).length < 10) return res.status(400).json({ success: false, message: "Enter your name and a 10 digit mobile number" });
    const acc = await PortalAccount.findByIdAndUpdate(req.portal._id, { name, phone }, { new: true }).lean();
    if (acc.seoMember) await SeoMember.updateOne({ _id: acc.seoMember }, { name, phone });
    if (acc.developer) await Developer.updateOne({ _id: acc.developer }, { name, phone });
    return res.json({ success: true, data: publicAccount(acc) });
  } catch (err) { return fail(res, err, "updateMe"); }
}
// PUT /api/portal/me/password { current, password }  (current not needed after an admin reset)
export async function changePassword(req, res) {
  try {
    const acc = await PortalAccount.findById(req.portal._id).select("+password");
    const pw = String(req.body?.password || "");
    if (!acc.mustChange && !(await bcrypt.compare(String(req.body?.current || ""), acc.password))) return res.status(400).json({ success: false, message: "Current password is wrong" });
    if (pw.length < 8 || !/\d/.test(pw)) return res.status(400).json({ success: false, message: "Password needs at least 8 characters and a number." });
    acc.password = await bcrypt.hash(pw, 10); acc.mustChange = false;
    await acc.save();
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "changePassword"); }
}

/* ───────── what I work on ───────── */

async function myClients(acc) {
  const f = SEO_FIELD[acc.role];
  if (!f || !acc.seoMember) return [];
  return SeoClient.find({ [f]: acc.seoMember, isActive: { $ne: false } }).select("name site budget targets start contact phone").sort({ name: 1 }).lean();
}
async function myProjects(acc) {
  if (acc.role === "acc") {
    return Lead.find({ stage: "Closed" }).select("name business company requirements projectStage value advanceReceived gstApplicable gstRate").sort({ updatedAt: -1 }).limit(300).lean();
  }
  if (!acc.developer) return [];
  return Lead.find({ developers: acc.developer }).select("name business company requirements projectStage projectStartDate projectCompletionDate projectCompleted").sort({ updatedAt: -1 }).lean();
}

export async function assigned(req, res) {
  try {
    const [clients, projects] = await Promise.all([myClients(req.portal), myProjects(req.portal)]);
    return res.json({
      success: true,
      data: {
        clients: clients.map(c => ({ id: String(c._id), name: c.name, site: c.site, budget: c.budget, targets: c.targets, start: c.start, contact: c.contact, phone: c.phone })),
        projects: projects.map(p => {
          const total = (Number(p.value) || 0) * (p.gstApplicable ? 1 + (Number(p.gstRate) || 18) / 100 : 1);
          return { id: String(p._id), name: p.business || p.company ? `${p.name} · ${p.business || p.company}` : p.name, stage: p.projectStage || "",
            ...(req.portal.role === "acc" ? { total: Math.round(total), received: Number(p.advanceReceived) || 0 }
              : { req: p.requirements || "", start: day(p.projectStartDate), due: day(p.projectCompletionDate), completed: !!p.projectCompleted }) };
        }),
      },
    });
  } catch (err) { return fail(res, err, "assigned"); }
}

/* ───────── work log ───────── */

const SEO_TYPES = { backlink: "backlink", blog: "blog", gmb: "gmb", poster: "poster", onpage: "other", optimise: "other", negative: "other", newad: "other" };

async function resolveRef(acc, refType, refId) {
  if (!refId || !isId(refId)) return null;
  if (refType === "client") {
    const c = (await myClients(acc)).find(x => String(x._id) === String(refId));
    return c ? { refType: "client", refId: c._id, refName: c.name } : null;
  }
  const p = (await myProjects(acc)).find(x => String(x._id) === String(refId));
  return p ? { refType: "project", refId: p._id, refName: p.business || p.company ? `${p.name} · ${p.business || p.company}` : p.name } : null;
}

export async function listWork(req, res) {
  try {
    const q = { account: req.portal._id };
    if (isDay(req.query.from) || isDay(req.query.to)) { q.date = {}; if (isDay(req.query.from)) q.date.$gte = req.query.from; if (isDay(req.query.to)) q.date.$lte = req.query.to; }
    const [work, days] = await Promise.all([
      PortalWork.find(q).sort({ date: -1, createdAt: -1 }).limit(2000).lean(),
      PortalDay.find({ account: req.portal._id, ...(q.date ? { date: q.date } : {}) }).lean(),
    ]);
    return res.json({ success: true, data: { work, days } });
  } catch (err) { return fail(res, err, "listWork"); }
}

// POST /api/portal/work { type, date, refType, refId, hrs, items: [{ title, url, meta }] }
export async function addWork(req, res) {
  try {
    const b = req.body || {}, acc = req.portal;
    const date = isDay(b.date) ? b.date : null;
    if (!date) return res.status(400).json({ success: false, message: "Pick a date" });
    if (await PortalDay.exists({ account: acc._id, date })) return res.status(400).json({ success: false, message: "That day is already submitted" });
    const type = str(b.type);
    if (!type) return res.status(400).json({ success: false, message: "Pick what you worked on" });
    const ref = await resolveRef(acc, b.refType, b.refId);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200).filter(i => str(i.title) || str(i.url));
    if (!items.length) return res.status(400).json({ success: false, message: "Add a title or link" });
    const hrs = Math.max(0, num(b.hrs));
    const per = Math.round((hrs / items.length) * 100) / 100;
    const out = [];
    for (const it of items) {
      const meta = it.meta && typeof it.meta === "object" ? it.meta : {};
      if (type === "bug") {
        const last = await PortalWork.find({ type: "bug" }).sort({ createdAt: -1 }).limit(1).lean();
        const n = last.length ? (parseInt(String(last[0].meta?.bug || "BUG-100").slice(4), 10) || 100) + 1 : 101;
        meta.bug = `BUG-${n}`; meta.status = "open";
        if (meta.assign && !isId(meta.assign)) delete meta.assign;
      }
      if (["screen", "revision"].includes(type)) meta.status = meta.send === false ? "draft" : "review";
      const doc = { account: acc._id, date, type, ...(ref || { refName: str(b.refName) }), title: str(it.title), url: str(it.url), hrs: per, meta };
      // SEO side work is also logged in the CRM's SEO & Ads Team work log
      if (SEO_TYPES[type] && ref?.refType === "client" && acc.seoMember) {
        const sw = await SeoWork.create({
          client: ref.refId, who: acc.seoMember, date: utcDay(date), type: SEO_TYPES[type], url: doc.url, title: doc.title,
          kw: str(meta.kw), da: meta.da ? Math.min(100, num(meta.da)) : null, platform: str(meta.platform), status: "live", by: acc.name,
        });
        doc.seoWork = sw._id;
      }
      const saved = await PortalWork.create(doc);
      out.push(saved);
      if (type === "bug" && meta.assign) {
        await notify(meta.assign, { kind: "bug", title: `${meta.bug} assigned to you${meta.sev ? ` · ${meta.sev}` : ""}`, text: `${doc.title}${doc.refName ? ` · ${doc.refName}` : ""}`, link: "/bugs", from: acc.name });
      }
      if (type === "test" && ref?.refType === "project") {
        await notifyProjectTeam(acc, ref.refId, { kind: num(meta.fail) > 0 ? "bug" : "info", title: `Test run on ${ref.refName}: ${num(meta.pass)} passed, ${num(meta.fail)} failed`, text: doc.title, link: `/projects/${ref.refId}` });
      }
    }
    return res.status(201).json({ success: true, data: out });
  } catch (err) { return fail(res, err, "addWork"); }
}

export async function deleteWork(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const w = await PortalWork.findOne({ _id: req.params.id, account: req.portal._id });
    if (!w) return res.status(404).json({ success: false, message: "Not found" });
    if (await PortalDay.exists({ account: req.portal._id, date: w.date })) return res.status(400).json({ success: false, message: "That day is already submitted" });
    if (w.seoWork) await SeoWork.deleteOne({ _id: w.seoWork });
    await w.deleteOne();
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "deleteWork"); }
}

/* bugs and designs */

// GET /api/portal/bugs → bugs I raised (tester) or bugs assigned to me (developer)
export async function myBugs(req, res) {
  try {
    const me = req.portal;
    const q = me.role === "test" ? { type: "bug", account: me._id } : { type: "bug", "meta.assign": String(me._id) };
    const bugs = await PortalWork.find(q).sort({ createdAt: -1 }).limit(300).populate("account", "name").lean();
    return res.json({ success: true, data: bugs });
  } catch (err) { return fail(res, err, "myBugs"); }
}
// GET /api/portal/bugs/activity → what the testers did on my projects: test runs and the other bugs raised
export async function bugActivity(req, res) {
  try {
    const me = req.portal, mine = String(me._id);
    const leads = me.developer ? await Lead.find({ developers: me.developer }).select("_id").lean() : [];
    const ids = leads.map(l => l._id);
    const [tests, bugs] = await Promise.all([
      PortalWork.find({ type: "test", $or: [{ refId: { $in: ids } }, { account: me._id }] }).sort({ date: -1, createdAt: -1 }).limit(60).populate("account", "name").lean(),
      ids.length ? PortalWork.find({ type: "bug", refId: { $in: ids }, account: { $ne: me._id }, "meta.assign": { $ne: mine } }).sort({ createdAt: -1 }).limit(60).populate("account", "name").lean() : [],
    ]);
    return res.json({ success: true, data: { tests, bugs } });
  } catch (err) { return fail(res, err, "bugActivity"); }
}

// Developers who can be assigned a bug
export async function developersList(req, res) {
  try {
    const L = await PortalAccount.find({ role: { $in: ["app", "web", "back", "full", "other"] }, status: "active" }).select("name role").sort({ name: 1 }).lean();
    return res.json({ success: true, data: L.map(a => ({ id: String(a._id), name: a.name, role: a.role })) });
  } catch (err) { return fail(res, err, "developersList"); }
}
// PATCH /api/portal/bugs/:id { action: fix|verify|reopen, url, hrs, note }
export async function bugAction(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const me = req.portal, b = req.body || {};
    const bug = await PortalWork.findOne({ _id: req.params.id, type: "bug" });
    if (!bug) return res.status(404).json({ success: false, message: "Bug not found" });
    const meta = { ...bug.meta };
    if (b.action === "fix") {
      if (meta.assign !== String(me._id)) return res.status(403).json({ success: false, message: "This bug is not assigned to you" });
      meta.status = "fixed"; meta.note = str(b.note);
      const date = isDay(b.date) ? b.date : new Date().toISOString().slice(0, 10);
      await PortalWork.create({ account: me._id, date, type: "bugfix", refType: bug.refType, refId: bug.refId, refName: bug.refName, title: `Fixed ${meta.bug}: ${bug.title}`, url: str(b.url), hrs: Math.max(0, num(b.hrs)), meta: { bug: meta.bug } });
    } else if (b.action === "verify" || b.action === "reopen") {
      if (String(bug.account) !== String(me._id)) return res.status(403).json({ success: false, message: "Only the tester who raised it can do this" });
      meta.status = b.action === "verify" ? "verified" : "reopened";
      if (b.action === "reopen") meta.note = str(b.note);
    } else return res.status(400).json({ success: false, message: "Unknown action" });
    bug.meta = meta; bug.markModified("meta");
    await bug.save();
    const where = bug.refName ? ` · ${bug.refName}` : "";
    if (b.action === "fix") await notify(bug.account, { kind: "bug_fixed", title: `${meta.bug} fixed by ${me.name}, please verify`, text: `${bug.title}${where}${meta.note ? ` · ${meta.note}` : ""}`, link: "/bugs", from: me.name });
    if (b.action === "verify") await notify(meta.assign, { kind: "bug_verified", title: `${meta.bug} verified by ${me.name}`, text: `${bug.title}${where}`, link: "/bugs", from: me.name });
    if (b.action === "reopen") await notify(meta.assign, { kind: "bug_reopened", title: `${meta.bug} reopened by ${me.name}`, text: `${meta.note || bug.title}${where}`, link: "/bugs", from: me.name });
    return res.json({ success: true, data: bug });
  } catch (err) { return fail(res, err, "bugAction"); }
}
// PATCH /api/portal/designs/:id { status: approved|changes, fb }
export async function designStatus(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const w = await PortalWork.findOne({ _id: req.params.id, account: req.portal._id, type: { $in: ["screen", "revision"] } });
    if (!w) return res.status(404).json({ success: false, message: "Not found" });
    const st = req.body?.status;
    if (!["approved", "changes", "review"].includes(st)) return res.status(400).json({ success: false, message: "Invalid status" });
    w.meta = { ...w.meta, status: st, ...(st === "changes" ? { fb: str(req.body?.fb) } : {}) }; w.markModified("meta");
    await w.save();
    return res.json({ success: true, data: w });
  } catch (err) { return fail(res, err, "designStatus"); }
}

/* ───────── tasks, blockers, days ───────── */

export async function listTasks(req, res) {
  try { return res.json({ success: true, data: await PortalTask.find({ account: req.portal._id }).sort({ due: 1 }).lean() }); }
  catch (err) { return fail(res, err, "listTasks"); }
}
export async function addTask(req, res) {
  try {
    const title = str(req.body?.title), due = isDay(req.body?.due) ? req.body.due : null;
    if (!title || !due) return res.status(400).json({ success: false, message: "Add the task and a due date" });
    return res.status(201).json({ success: true, data: await PortalTask.create({ account: req.portal._id, title, refName: str(req.body?.refName), due, from: "me" }) });
  } catch (err) { return fail(res, err, "addTask"); }
}
export async function taskStatus(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const st = req.body?.status;
    if (!["todo", "doing", "done"].includes(st)) return res.status(400).json({ success: false, message: "Invalid status" });
    const t = await PortalTask.findOneAndUpdate({ _id: req.params.id, account: req.portal._id }, { status: st, doneOn: st === "done" ? new Date().toISOString().slice(0, 10) : "" }, { new: true });
    if (!t) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: t });
  } catch (err) { return fail(res, err, "taskStatus"); }
}
export async function listBlockers(req, res) {
  try { return res.json({ success: true, data: await PortalBlocker.find({ account: req.portal._id }).sort({ createdAt: -1 }).limit(100).lean() }); }
  catch (err) { return fail(res, err, "listBlockers"); }
}
export async function addBlocker(req, res) {
  try {
    const text = str(req.body?.text);
    if (!text) return res.status(400).json({ success: false, message: "Say what you are waiting for" });
    const date = isDay(req.body?.date) ? req.body.date : new Date().toISOString().slice(0, 10);
    return res.status(201).json({ success: true, data: await PortalBlocker.create({ account: req.portal._id, date, text, refName: str(req.body?.refName) }) });
  } catch (err) { return fail(res, err, "addBlocker"); }
}
export async function resolveBlocker(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await PortalBlocker.updateOne({ _id: req.params.id, account: req.portal._id }, { resolved: true });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "resolveBlocker"); }
}
// POST /api/portal/days { date, at, note, plan }
export async function submitDay(req, res) {
  try {
    const date = isDay(req.body?.date) ? req.body.date : null;
    if (!date) return res.status(400).json({ success: false, message: "Invalid date" });
    const d = await PortalDay.findOneAndUpdate({ account: req.portal._id, date },
      { $set: { at: str(req.body?.at), note: str(req.body?.note), plan: str(req.body?.plan) } }, { new: true, upsert: true });
    return res.json({ success: true, data: d });
  } catch (err) { return fail(res, err, "submitDay"); }
}

/* ───────── meetings ───────── */

const meetingFields = (b) => {
  const images = (Array.isArray(b.images) ? b.images : []).filter(u => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(String(u)) && String(u).length < 900000).slice(0, 8);
  return {
    refName: str(b.refName), title: str(b.title), date: isDay(b.date) ? b.date : new Date().toISOString().slice(0, 10), time: str(b.time),
    dur: Math.max(0.25, num(b.dur) || 1), mode: str(b.mode) || "Google Meet", theirs: str(b.theirs), ours: str(b.ours),
    notes: String(b.notes || ""), images, momTxt: String(b.momTxt || ""), sentWa: str(b.sentWa), sentMail: str(b.sentMail),
  };
};
export async function listMeetings(req, res) {
  try { return res.json({ success: true, data: await PortalMeeting.find({ account: req.portal._id }).sort({ date: -1, time: -1 }).limit(200).lean() }); }
  catch (err) { return fail(res, err, "listMeetings"); }
}
export async function saveMeeting(req, res) {
  try {
    const f = meetingFields(req.body || {});
    if (!f.title) return res.status(400).json({ success: false, message: "Say what the meeting was about" });
    if (!f.notes.trim() && !f.images.length) return res.status(400).json({ success: false, message: "Write some notes or attach a photo of the notes" });
    let m;
    if (req.params.id) {
      if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
      m = await PortalMeeting.findOneAndUpdate({ _id: req.params.id, account: req.portal._id }, { $set: f }, { new: true });
      if (!m) return res.status(404).json({ success: false, message: "Not found" });
    } else {
      m = await PortalMeeting.create({ ...f, account: req.portal._id });
      // the meeting also counts on the timesheet
      if (!(await PortalDay.exists({ account: req.portal._id, date: f.date }))) {
        await PortalWork.create({ account: req.portal._id, date: f.date, type: "meeting", refName: f.refName, title: `Meeting: ${f.title}`, hrs: f.dur, meta: { meeting: String(m._id) } });
      }
    }
    return res.json({ success: true, data: m });
  } catch (err) { return fail(res, err, "saveMeeting"); }
}
export async function deleteMeeting(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await PortalMeeting.deleteOne({ _id: req.params.id, account: req.portal._id });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "deleteMeeting"); }
}

/* ───────── SEO: keyword positions, Ads: daily report ───────── */

async function myClientOr404(req, res, id) {
  const c = (await myClients(req.portal)).find(x => String(x._id) === String(id));
  if (!c) { res.status(404).json({ success: false, message: "This client is not assigned to you" }); return null; }
  return c;
}
export async function clientKeywords(req, res) {
  try {
    const c = await myClientOr404(req, res, req.query.client); if (!c) return undefined;
    const kws = await SeoKeyword.find({ client: c._id }).sort({ keyword: 1 }).lean();
    return res.json({ success: true, data: kws.map(k => ({ id: String(k._id), keyword: k.keyword, hist: (k.hist || []).map(h => ({ date: new Date(h.date).toISOString().slice(0, 10), pos: h.pos })) })) });
  } catch (err) { return fail(res, err, "clientKeywords"); }
}
// POST /api/portal/ranks { client, date, rows: [{ keyword, pos }] }
export async function saveRanks(req, res) {
  try {
    const c = await myClientOr404(req, res, req.body?.client); if (!c) return undefined;
    const date = utcDay(isDay(req.body?.date) ? req.body.date : new Date().toISOString().slice(0, 10));
    let n = 0;
    for (const r of Array.isArray(req.body?.rows) ? req.body.rows : []) {
      const kw = await SeoKeyword.findOne({ client: c._id, keyword: str(r.keyword) });
      const p = parseInt(r.pos, 10);
      if (!kw || !(p > 0)) continue;
      kw.hist = kw.hist.filter(h => new Date(h.date).getTime() !== date.getTime());
      kw.hist.push({ date, pos: p <= 100 ? p : null, url: "" });
      kw.hist.sort((a, z) => new Date(a.date) - new Date(z.date));
      await kw.save(); n++;
    }
    if (!n) return res.status(400).json({ success: false, message: "Enter at least one position" });
    const day = date.toISOString().slice(0, 10);
    if (!(await PortalDay.exists({ account: req.portal._id, date: day }))) {
      await PortalWork.create({ account: req.portal._id, date: day, type: "other", refType: "client", refId: c._id, refName: c.name, title: `Keyword positions updated (${n} keywords)`, hrs: 0.5 });
    }
    return res.json({ success: true, saved: n });
  } catch (err) { return fail(res, err, "saveRanks"); }
}
// GET /api/portal/ads?client=  → recent daily reports for that client
export async function clientAds(req, res) {
  try {
    const c = await myClientOr404(req, res, req.query.client); if (!c) return undefined;
    const L = await SeoAdsDay.find({ client: c._id }).sort({ date: -1 }).limit(8).lean();
    return res.json({ success: true, data: L.map(r => ({ ...r, date: new Date(r.date).toISOString().slice(0, 10) })) });
  } catch (err) { return fail(res, err, "clientAds"); }
}
// POST /api/portal/ads { client, date, spend, clicks, impr, conv, terms, negs, notes }
export async function saveAds(req, res) {
  try {
    const b = req.body || {};
    const c = await myClientOr404(req, res, b.client); if (!c) return undefined;
    const day = isDay(b.date) ? b.date : new Date().toISOString().slice(0, 10);
    const terms = (Array.isArray(b.terms) ? b.terms : []).slice(0, 2000).map(t => ({ t: str(t.t), clicks: num(t.clicks), impr: num(t.impr), cost: num(t.cost), conv: num(t.conv) })).filter(t => t.t);
    const doc = { client: c._id, who: req.portal.seoMember, date: utcDay(day), spend: num(b.spend), clicks: num(b.clicks), impr: num(b.impr), conv: num(b.conv), terms, negs: (Array.isArray(b.negs) ? b.negs : []).map(str).filter(Boolean), notes: str(b.notes) };
    const r = await SeoAdsDay.findOneAndUpdate({ client: c._id, date: doc.date }, { $set: doc, $setOnInsert: { sent: false } }, { new: true, upsert: true });
    if (!(await PortalWork.exists({ account: req.portal._id, date: day, type: "adsreport", refId: c._id }))) {
      await PortalWork.create({ account: req.portal._id, date: day, type: "adsreport", refType: "client", refId: c._id, refName: c.name, title: "Daily ads report", hrs: 0.5, meta: { spend: doc.spend, conv: doc.conv } });
    }
    return res.json({ success: true, data: { ...r.toObject(), date: day } });
  } catch (err) { return fail(res, err, "saveAds"); }
}
export async function adsSent(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const r = await SeoAdsDay.findById(req.params.id);
    if (!r || !(await myClients(req.portal)).some(c => String(c._id) === String(r.client))) return res.status(404).json({ success: false, message: "Not found" });
    r.sent = true; r.sentAt = new Date(); await r.save();
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "adsSent"); }
}

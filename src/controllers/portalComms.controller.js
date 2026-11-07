import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import CalendarEvent from "../models/CalendarEvent.js";
import {
  PortalAccount, PortalWork, PortalTask, PortalMeeting, PortalDay, PortalNotification, PortalMessage, notify,
} from "../models/Portal.js";
import { pingPortalChat } from "../realtime.js";
import { noEmoji } from "../utils/noEmoji.js";

// Employee Portal: bell notifications, chat with the admin, MOM send history and the calendar

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const str = (v) => String(v ?? "").trim();
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const todayStr = () => new Date().toISOString().slice(0, 10);
const pname = (p) => (p.business || p.company ? `${p.name} · ${p.business || p.company}` : p.name);

function fail(res, err, where) {
  console.error(`portal ${where} error:`, err);
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ success: false, message: err.message });
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

/* ───────── notifications (employee) ───────── */

export async function listNotifications(req, res) {
  try {
    const [list, unread, msgs] = await Promise.all([
      PortalNotification.find({ account: req.portal._id }).sort({ createdAt: -1 }).limit(60).lean(),
      PortalNotification.countDocuments({ account: req.portal._id, read: false }),
      PortalMessage.countDocuments({ account: req.portal._id, from: "admin", readEmp: false }),
    ]);
    return res.json({ success: true, data: { list, unread, unreadMessages: msgs } });
  } catch (err) { return fail(res, err, "listNotifications"); }
}
// PUT /api/portal/notifications/read { ids? }  (no ids = all) → an opened notification is removed, so it does not show again
export async function readNotifications(req, res) {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(isId);
    await PortalNotification.deleteMany({ account: req.portal._id, ...(ids.length ? { _id: { $in: ids } } : {}) });
    return res.json({ success: true });
  } catch (err) { return fail(res, err, "readNotifications"); }
}

/* ───────── chat with the admin ───────── */

export async function myMessages(req, res) {
  try {
    const L = await PortalMessage.find({ account: req.portal._id }).sort({ createdAt: -1 }).limit(300).lean();
    const [r] = await Promise.all([
      PortalMessage.updateMany({ account: req.portal._id, from: "admin", readEmp: false }, { readEmp: true, seenAt: new Date() }),
      PortalNotification.updateMany({ account: req.portal._id, kind: "message", read: false }, { read: true }),
    ]);
    // the admin's screen shows "seen" straight away
    if (r.modifiedCount) pingPortalChat(req.portal._id);
    return res.json({ success: true, data: L.reverse() });
  } catch (err) { return fail(res, err, "myMessages"); }
}
export async function sendMyMessage(req, res) {
  try {
    const text = str(noEmoji(req.body?.text)).slice(0, 4000);
    if (!text) return res.status(400).json({ success: false, message: "Type a message (emojis are not allowed in chat)" });
    const m = await PortalMessage.create({ account: req.portal._id, from: "emp", by: req.portal.name, text, refName: str(req.body?.refName), readEmp: true });
    pingPortalChat(req.portal._id);
    return res.status(201).json({ success: true, data: m });
  } catch (err) { return fail(res, err, "sendMyMessage"); }
}

/* ───────── admin side (CRM) ───────── */

// GET /api/portal/admin/threads → every employee with their last message and unread count
export async function adminThreads(req, res) {
  try {
    const [accs, last, unread] = await Promise.all([
      PortalAccount.find({ status: { $ne: "pending" } }).select("name role status").lean(),
      PortalMessage.aggregate([{ $sort: { createdAt: -1 } }, { $group: { _id: "$account", text: { $first: "$text" }, from: { $first: "$from" }, at: { $first: "$createdAt" } } }]),
      PortalMessage.aggregate([{ $match: { from: "emp", readAdmin: false } }, { $group: { _id: "$account", n: { $sum: 1 } } }]),
    ]);
    const data = accs.map(a => {
      const l = last.find(x => String(x._id) === String(a._id)), u = unread.find(x => String(x._id) === String(a._id));
      return { id: String(a._id), name: a.name, role: a.role, status: a.status, last: l ? { text: l.text, from: l.from, at: l.at } : null, unread: u ? u.n : 0 };
    }).sort((x, y) => (y.unread - x.unread) || (new Date(y.last?.at || 0) - new Date(x.last?.at || 0)) || x.name.localeCompare(y.name));
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err, "adminThreads"); }
}
export async function adminMessages(req, res) {
  try {
    if (!isId(req.params.account)) return res.status(400).json({ success: false, message: "Invalid id" });
    const L = await PortalMessage.find({ account: req.params.account }).sort({ createdAt: -1 }).limit(300).lean();
    const r = await PortalMessage.updateMany({ account: req.params.account, from: "emp", readAdmin: false }, { readAdmin: true, seenAt: new Date() });
    // the employee's screen shows "seen" straight away
    if (r.modifiedCount) pingPortalChat(req.params.account);
    return res.json({ success: true, data: L.reverse() });
  } catch (err) { return fail(res, err, "adminMessages"); }
}
export async function adminSend(req, res) {
  try {
    if (!isId(req.params.account)) return res.status(400).json({ success: false, message: "Invalid id" });
    const text = str(noEmoji(req.body?.text)).slice(0, 4000);
    if (!text) return res.status(400).json({ success: false, message: "Type a message (emojis are not allowed in chat)" });
    if (!(await PortalAccount.exists({ _id: req.params.account }))) return res.status(404).json({ success: false, message: "Employee not found" });
    const by = req.actorName || "Admin";
    const m = await PortalMessage.create({ account: req.params.account, from: "admin", by, text, refName: str(req.body?.refName), readAdmin: true });
    pingPortalChat(req.params.account);
    await notify(req.params.account, { kind: "message", title: `Message from ${by}`, text: text.slice(0, 160), link: "/messages", from: by });
    return res.status(201).json({ success: true, data: m });
  } catch (err) { return fail(res, err, "adminSend"); }
}
// POST /api/portal/admin/announce { text, roles?: [] }  → a bell notification for everyone (or some roles)
export async function adminAnnounce(req, res) {
  try {
    const text = str(req.body?.text).slice(0, 1000);
    if (!text) return res.status(400).json({ success: false, message: "Type the announcement" });
    const roles = (Array.isArray(req.body?.roles) ? req.body.roles : []).map(str).filter(Boolean);
    const accs = await PortalAccount.find({ status: "active", ...(roles.length ? { role: { $in: roles } } : {}) }).select("_id").lean();
    const by = req.actorName || "Admin";
    if (accs.length) await PortalNotification.insertMany(accs.map(a => ({ account: a._id, kind: "announce", title: `Announcement from ${by}`, text, from: by })));
    return res.json({ success: true, sent: accs.length });
  } catch (err) { return fail(res, err, "adminAnnounce"); }
}

/* ───────── meeting minutes: send history ───────── */

// POST /api/portal/meetings/:id/sent { via: whatsapp|email, to }
export async function meetingSent(req, res) {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const via = req.body?.via === "email" ? "email" : "whatsapp";
    const m = await PortalMeeting.findOneAndUpdate(
      { _id: req.params.id, account: req.portal._id },
      { $set: { [via === "email" ? "sentMail" : "sentWa"]: todayStr() }, $push: { sendLog: { $each: [{ via, to: str(req.body?.to).slice(0, 200), at: new Date() }], $slice: -50 } } },
      { new: true },
    );
    if (!m) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: m });
  } catch (err) { return fail(res, err, "meetingSent"); }
}

/* ───────── calendar ───────── */

const PROJECT_TYPES = new Set(["bug", "bugfix", "test", "build", "deploy", "feature", "page", "screen", "revision"]);

// GET /api/portal/calendar?from=&to=  → everything dated in the range, for the employee's calendar
export async function calendar(req, res) {
  try {
    const me = req.portal;
    const from = isDay(req.query.from) ? req.query.from : todayStr();
    const to = isDay(req.query.to) ? req.query.to : from;
    const end = new Date(`${to}T23:59:59.999Z`), start = new Date(`${from}T00:00:00.000Z`);
    const projects = me.developer
      ? await Lead.find({ developers: me.developer }).select("name business company projectStage projectStartDate projectCompletionDate projectCompleted history").lean()
      : [];
    const pIds = projects.map(p => p._id);
    const name = (id) => { const p = projects.find(x => String(x._id) === String(id)); return p ? pname(p) : ""; };
    const [meetings, crm, tasks, days, work] = await Promise.all([
      PortalMeeting.find({ account: me._id, date: { $gte: from, $lte: to } }).select("title refName date time dur mode momTxt sendLog").lean(),
      pIds.length ? CalendarEvent.find({ leadId: { $in: pIds }, type: { $in: ["demo", "client_response", "call_followup"] }, status: { $ne: "cancelled" }, date: { $gte: start, $lte: end } })
        .select("leadId leadName leadBusiness type title date time duration mode link").lean() : [],
      PortalTask.find({ account: me._id, due: { $gte: from, $lte: to } }).select("title refName due status from").lean(),
      PortalDay.find({ account: me._id, date: { $gte: from, $lte: to } }).select("date at").lean(),
      // project activity by the whole team (bugs, fixes, tests, builds) plus my own other work
      PortalWork.find({ date: { $gte: from, $lte: to }, $or: [{ account: me._id }, ...(pIds.length ? [{ refId: { $in: pIds }, type: { $in: [...PROJECT_TYPES] } }] : [])] })
        .select("account type title refName date hrs meta").populate("account", "name").limit(2000).lean(),
    ]);
    const out = [];
    meetings.forEach(m => out.push({ id: `m${m._id}`, kind: "meeting", date: m.date, time: m.time, title: m.title, refName: m.refName, text: m.mode, mom: !!m.momTxt, sent: (m.sendLog || []).length }));
    crm.forEach(e => out.push({ id: `c${e._id}`, kind: "client", date: day(e.date), time: e.time, title: e.title || (e.type === "demo" ? "Client meeting" : "Client follow-up"),
      refName: name(e.leadId) || e.leadBusiness || e.leadName, text: { meet: "Google Meet", office: "In person", phone: "Phone call" }[e.mode] || "", link: e.link }));
    tasks.forEach(t => out.push({ id: `t${t._id}`, kind: "task", date: t.due, title: t.title, refName: t.refName, text: t.from === "me" ? "my task" : `from ${t.from}`, done: t.status === "done" }));
    days.forEach(d => out.push({ id: `d${d._id}`, kind: "submitted", date: d.date, time: "", title: `Day submitted at ${d.at}` }));
    projects.forEach(p => {
      const s = day(p.projectStartDate), d = day(p.projectCompletionDate);
      if (s && s >= from && s <= to) out.push({ id: `s${p._id}`, kind: "start", date: s, title: "Project start", refName: pname(p) });
      if (d && d >= from && d <= to) out.push({ id: `e${p._id}`, kind: "delivery", date: d, title: p.projectCompleted ? "Delivered" : "Delivery date", refName: pname(p), text: p.projectStage });
      (p.history || []).forEach((h, i) => {
        const hd = day(h.at);
        if (hd >= from && hd <= to && /project stage|stage changed|moved to/i.test(`${h.title} ${h.meta}`) && !/₹|payment|invoice/i.test(`${h.title} ${h.meta}`))
          out.push({ id: `h${p._id}${i}`, kind: "stage", date: hd, title: h.title, text: h.meta, refName: pname(p) });
      });
    });
    work.forEach(w => {
      const mine = String(w.account?._id) === String(me._id), m = w.meta || {};
      const kind = w.type === "bug" ? "bug" : w.type === "bugfix" ? "fix" : w.type === "test" ? "test" : ["build", "deploy"].includes(w.type) ? "release" : "work";
      if (kind === "work" && !mine) return;
      out.push({
        id: `w${w._id}`, kind, date: w.date, title: w.title, refName: w.refName, by: mine ? "you" : w.account?.name || "",
        text: kind === "test" ? `${m.pass ?? 0} passed, ${m.fail ?? 0} failed` : kind === "bug" ? [m.bug, m.sev, m.status].filter(Boolean).join(" · ") : kind === "work" ? `${w.hrs || 0} h` : "",
        bad: kind === "test" ? (m.fail || 0) > 0 : kind === "bug" ? ["open", "reopened"].includes(m.status) : false,
      });
    });
    out.sort((a, b) => `${a.date}${a.time || "99"}`.localeCompare(`${b.date}${b.time || "99"}`));
    return res.json({ success: true, data: out });
  } catch (err) { return fail(res, err, "calendar"); }
}

// Tester logged a test run on a project → tell the other people on it
export async function notifyProjectTeam(acc, leadId, n) {
  try {
    if (!leadId) return;
    const l = await Lead.findById(leadId).select("developers").lean();
    if (!l?.developers?.length) return;
    const accs = await PortalAccount.find({ developer: { $in: l.developers }, _id: { $ne: acc._id }, status: "active" }).select("_id").lean();
    if (accs.length) await PortalNotification.insertMany(accs.map(a => ({ account: a._id, from: acc.name, ...n })));
  } catch (err) { console.error("portal notifyProjectTeam error:", err.message); }
}

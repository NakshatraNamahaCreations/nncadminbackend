import mongoose from "mongoose";
import Developer, { DEVELOPER_ROLES } from "../models/Developer.js";
import Lead from "../models/Lead.js";
import { PortalAccount } from "../models/Portal.js";
import { syncDeveloperLogin, removePortalAccounts } from "../utils/portalSync.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const PROJECT_FIELDS = "name business company projectStage projectCompleted developers";

function sendError(res, err, where) {
  console.error(`${where} error:`, err);
  if (err.name === "ValidationError" || err.name === "CastError") {
    return res.status(400).json({ success: false, message: err.message });
  }
  return res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
}

function pickFields(body) {
  const out = {};
  if (body.name     !== undefined) out.name     = String(body.name || "").trim();
  if (body.role     !== undefined) out.role     = DEVELOPER_ROLES.includes(body.role) ? body.role : "Other";
  if (body.email    !== undefined) out.email    = String(body.email || "").trim();
  if (body.phone    !== undefined) out.phone    = String(body.phone || "").trim();
  if (body.branch   !== undefined) out.branch   = String(body.branch || "").trim();
  if (body.skills   !== undefined) out.skills   = String(body.skills || "").trim();
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  return out;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Same email, or same name with the same (or no) phone: stops a double click or a re-add showing a developer twice
async function findDuplicate(fields, exceptId) {
  const not = exceptId ? { _id: { $ne: exceptId } } : {};
  const email = String(fields.email || "").toLowerCase();
  if (email) {
    const d = await Developer.findOne({ email, ...not }).select("name").lean();
    if (d) return `${d.name} already uses this email`;
  }
  if (fields.name) {
    const d = await Developer.findOne({ name: new RegExp(`^${escRe(fields.name)}$`, "i"), phone: fields.phone || "", ...not }).select("name").lean();
    if (d) return `${d.name} is already in the list`;
  }
  return "";
}

const validIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.map(String))].filter(isValidId) : []);

// Each developer with the projects they are assigned to
async function withProjects(devs) {
  const [projects, logins] = await Promise.all([
    Lead.find({ developers: { $in: devs.map(d => d._id) } }).select(PROJECT_FIELDS).sort({ createdAt: -1 }).lean(),
    PortalAccount.find({ developer: { $in: devs.map(d => d._id) } }).select("developer email status lastLogin").lean(),
  ]);
  return devs.map(d => {
    const mine = projects
      .filter(p => (p.developers || []).some(id => String(id) === String(d._id)))
      .map(({ developers: _omit, ...p }) => p);
    const login = logins.find(a => String(a.developer) === String(d._id));
    return {
      ...d,
      portal: login ? { status: login.status, email: login.email, lastLogin: login.lastLogin } : null,
      projects: mine,
      activeProjects: mine.filter(p => !p.projectCompleted && p.projectStage !== "Project Completed").length,
    };
  });
}

// GET /api/developers                 → all developers with their projects
// GET /api/developers?lead=<id>       → only the developers on that project
export async function getDevelopers(req, res) {
  try {
    const { lead } = req.query;
    let filter = {};
    if (lead) {
      if (!isValidId(lead)) return res.status(400).json({ success: false, message: "Invalid project id" });
      const p = await Lead.findById(lead).select("developers").lean();
      filter = { _id: { $in: p?.developers || [] } };
    }
    const devs = await Developer.find(filter).sort({ isActive: -1, name: 1 }).lean();
    return res.json({ success: true, roles: DEVELOPER_ROLES, data: await withProjects(devs) });
  } catch (err) { return sendError(res, err, "getDevelopers"); }
}

export async function createDeveloper(req, res) {
  try {
    const fields = pickFields(req.body);
    if (!fields.name) return res.status(400).json({ success: false, message: "Name is required" });
    const pw = String(req.body.portalPassword || "");
    if (pw && !fields.email) return res.status(400).json({ success: false, message: "Add the developer's email: it is their portal login." });
    const dup = await findDuplicate(fields);
    if (dup) return res.status(409).json({ success: false, message: `${dup}. Edit that developer instead.` });
    const dev = await Developer.create(fields);
    if (pw) {
      try { await syncDeveloperLogin(dev.toObject(), pw, req.actorName); }
      catch (e) { await Developer.deleteOne({ _id: dev._id }); throw e; }
    }
    const projectIds = validIds(req.body.projectIds);
    if (projectIds.length) await Lead.updateMany({ _id: { $in: projectIds } }, { $addToSet: { developers: dev._id } });
    const [data] = await withProjects([dev.toObject()]);
    return res.status(201).json({ success: true, data });
  } catch (err) { return sendError(res, err, "createDeveloper"); }
}

// PUT /api/developers/:id   { ...fields, projectIds? }  — projectIds replaces the assignment
export async function updateDeveloper(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const fields = pickFields(req.body);
    if ("name" in fields && !fields.name) return res.status(400).json({ success: false, message: "Name is required" });
    if (fields.email) {
      const dup = await Developer.findOne({ email: fields.email.toLowerCase(), _id: { $ne: id } }).select("name").lean();
      if (dup) return res.status(409).json({ success: false, message: `${dup.name} already uses this email` });
    }
    const dev = await Developer.findByIdAndUpdate(id, fields, { new: true, runValidators: true }).lean();
    if (!dev) return res.status(404).json({ success: false, message: "Developer not found" });
    // keep the portal login in step (and set a new password if one was typed)
    await syncDeveloperLogin(dev, String(req.body.portalPassword || ""), req.actorName);

    if (Array.isArray(req.body.projectIds)) {
      const projectIds = validIds(req.body.projectIds);
      await Promise.all([
        Lead.updateMany({ developers: dev._id, _id: { $nin: projectIds } }, { $pull: { developers: dev._id } }),
        Lead.updateMany({ _id: { $in: projectIds } }, { $addToSet: { developers: dev._id } }),
      ]);
    }
    const [data] = await withProjects([dev]);
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err, "updateDeveloper"); }
}

export async function deleteDeveloper(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const dev = await Developer.findByIdAndDelete(id);
    if (!dev) return res.status(404).json({ success: false, message: "Developer not found" });
    await Lead.updateMany({ developers: dev._id }, { $pull: { developers: dev._id } });
    const removed = await removePortalAccounts({ developer: dev._id });   // their Employee Portal login goes too
    return res.json({ success: true, portalRemoved: removed });
  } catch (err) { return sendError(res, err, "deleteDeveloper"); }
}

// PUT /api/developers/project/:leadId   { developerIds }  — set one project's developers
export async function setProjectDevelopers(req, res) {
  try {
    const { leadId } = req.params;
    if (!isValidId(leadId)) return res.status(400).json({ success: false, message: "Invalid project id" });
    const ids  = validIds(req.body.developerIds);
    const devs = await Developer.find({ _id: { $in: ids } }).select("_id name").lean();
    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ success: false, message: "Project not found" });

    const before = new Set((lead.developers || []).map(String));
    const after  = devs.map(d => d._id);
    lead.developers = after;
    const added   = devs.filter(d => !before.has(String(d._id))).map(d => d.name);
    const removed = before.size - (after.length - added.length);
    if (added.length || removed) {
      lead.history.push({
        title: "Developers Updated",
        meta:  devs.length ? devs.map(d => d.name).join(", ") : "No developers assigned",
        by:    req.actorName || "Admin",
        at:    new Date(),
      });
    }
    await lead.save();
    return res.json({ success: true, data: devs });
  } catch (err) { return sendError(res, err, "setProjectDevelopers"); }
}

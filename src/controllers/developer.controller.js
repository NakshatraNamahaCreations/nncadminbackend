import mongoose from "mongoose";
import Developer, { DEVELOPER_ROLES } from "../models/Developer.js";
import Lead from "../models/Lead.js";

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

const validIds = (ids) => (Array.isArray(ids) ? [...new Set(ids.map(String))].filter(isValidId) : []);

// Each developer with the projects they are assigned to
async function withProjects(devs) {
  const projects = await Lead.find({ developers: { $in: devs.map(d => d._id) } })
    .select(PROJECT_FIELDS)
    .sort({ createdAt: -1 })
    .lean();
  return devs.map(d => {
    const mine = projects
      .filter(p => (p.developers || []).some(id => String(id) === String(d._id)))
      .map(({ developers: _omit, ...p }) => p);
    return {
      ...d,
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
    const dev = await Developer.create(fields);
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
    const dev = await Developer.findByIdAndUpdate(id, fields, { new: true, runValidators: true }).lean();
    if (!dev) return res.status(404).json({ success: false, message: "Developer not found" });

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
    return res.json({ success: true });
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

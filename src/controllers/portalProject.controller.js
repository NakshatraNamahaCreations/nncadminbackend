import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import Developer from "../models/Developer.js";
import Document from "../models/Document.js";
import Integration from "../models/Integration.js";
import ProjectExtra from "../models/ProjectExtra.js";
import { PortalAccount, PortalWork, PortalMeeting } from "../models/Portal.js";
import { decryptSecret } from "../utils/secretBox.js";
import { getSettingsDoc } from "./portal.controller.js";

// Project pages in the Employee Portal: only projects whose CRM developers include this employee.
// Money (deal value, invoices, quotations, payments) is never sent.

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const pname = (p) => (p.business || p.company ? `${p.name} · ${p.business || p.company}` : p.name);
const MONEY_DOC = /invoice|quotation|quote|payment|receipt|proforma|bill/i;
// Lead drawer uploads default to the "Invoice" tag, so judge those by the file name, not the tag
const leadDocOk = (d) => !MONEY_DOC.test(`${d.name} ${d.originalName}`);
const weekStart = () => { const d = new Date(); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); };

function fail(res, err, where) {
  console.error(`portal project ${where} error:`, err);
  if (err.name === "CastError") return res.status(400).json({ success: false, message: "Invalid id" });
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

async function myLead(req, res, id, select) {
  if (!req.portal.developer) { res.status(403).json({ success: false, message: "Projects are only for the development team" }); return null; }
  if (!isId(id)) { res.status(400).json({ success: false, message: "Invalid id" }); return null; }
  const p = await Lead.findOne({ _id: id, developers: req.portal.developer }).select(select).lean();
  if (!p) { res.status(404).json({ success: false, message: "This project is not assigned to you" }); return null; }
  return p;
}

// Portal accounts linked to these CRM developers, so work can show who did it
async function teamOf(devIds) {
  const [devs, accs] = await Promise.all([
    Developer.find({ _id: { $in: devIds } }).select("name role email phone").lean(),
    PortalAccount.find({ developer: { $in: devIds } }).select("name role developer").lean(),
  ]);
  return devs.map(d => {
    const a = accs.find(x => String(x.developer) === String(d._id));
    return { id: String(d._id), name: d.name, role: d.role, email: d.email || "", phone: d.phone || "", account: a ? String(a._id) : "" };
  });
}

// GET /api/portal/projects
export async function listProjects(req, res) {
  try {
    if (!req.portal.developer) return res.json({ success: true, data: [] });
    const leads = await Lead.find({ developers: req.portal.developer })
      .select("name business company industry location requirements projectStage projectStartDate projectCompletionDate projectCompleted agreedTimeline developers documents momLogs")
      .sort({ updatedAt: -1 }).lean();
    const ids = leads.map(l => l._id), ws = weekStart();
    const [docs, ints, extras, work, devs] = await Promise.all([
      Document.find({ leadId: { $in: ids } }).select("leadId type name").lean(),
      Integration.find({ lead: { $in: ids } }).select("lead status").lean(),
      ProjectExtra.find({ lead: { $in: ids }, status: { $in: ["approved", "in_progress"] } }).select("lead").lean(),
      PortalWork.find({ refId: { $in: ids } }).select("refId account date title type hrs meta").sort({ date: -1, createdAt: -1 }).limit(3000).lean(),
      teamOf([...new Set(leads.flatMap(l => (l.developers || []).map(String)))]),
    ]);
    const me = String(req.portal._id);
    const data = leads.map(l => {
      const id = String(l._id), W = work.filter(w => String(w.refId) === id);
      const I = ints.filter(i => String(i.lead) === id);
      const nDocs = docs.filter(d => String(d.leadId) === id && !MONEY_DOC.test(d.type)).length + (l.documents || []).filter(leadDocOk).length;
      return {
        id, name: pname(l), client: l.name, industry: l.industry || "", location: l.location || "", req: l.requirements || "",
        stage: l.projectStage || "", start: day(l.projectStartDate), due: day(l.projectCompletionDate), completed: !!l.projectCompleted, timeline: l.agreedTimeline || 0,
        team: devs.filter(d => (l.developers || []).some(x => String(x) === d.id)).map(d => ({ name: d.name, role: d.role })),
        docs: nDocs + (l.momLogs || []).length, integrations: I.length, intIssues: I.filter(i => i.status === "issue").length, intLive: I.filter(i => i.status === "live").length,
        extras: extras.filter(x => String(x.lead) === id).length,
        openBugs: W.filter(w => w.type === "bug" && ["open", "reopened"].includes(w.meta?.status)).length,
        myWeek: W.filter(w => String(w.account) === me && w.date >= ws).reduce((a, w) => a + (w.hrs || 0), 0),
        teamWeek: W.filter(w => w.date >= ws).reduce((a, w) => a + (w.hrs || 0), 0),
        last: W[0] ? { date: W[0].date, title: W[0].title } : null,
      };
    });
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err, "listProjects"); }
}

// GET /api/portal/projects/:id → everything the team needs for one project
export async function projectDetail(req, res) {
  try {
    const l = await myLead(req, res, req.params.id,
      "name business company industry location requirements projectStage projectStartDate projectCompletionDate projectCompleted onboardedDate agreedTimeline developers documents momLogs history");
    if (!l) return undefined;
    const name = pname(l);
    const showSecrets = (await getSettingsDoc()).showSecrets !== false;
    const [docs, ints, extras, work, meetings, team] = await Promise.all([
      Document.find({ leadId: l._id }).sort({ date: -1 }).lean(),
      Integration.find({ lead: l._id }).sort({ category: 1, service: 1 }).lean(),
      ProjectExtra.find({ lead: l._id, status: { $ne: "cancelled" } }).sort({ requestedDate: -1 }).lean(),
      PortalWork.find({ refId: l._id }).sort({ date: -1, createdAt: -1 }).limit(400).populate("account", "name role").lean(),
      PortalMeeting.find({ $or: [{ refName: name }, { refName: l.name }, ...(l.business ? [{ refName: l.business }] : [])] }).sort({ date: -1 }).limit(50).populate("account", "name").lean(),
      teamOf(l.developers || []),
    ]);
    const files = [
      ...docs.filter(d => !MONEY_DOC.test(d.type)).map(d => ({ id: String(d._id), name: d.name, kind: d.type === "mom" ? "Minutes" : d.type === "client_input" ? "From the client" : "Document", date: day(d.date), notes: d.notes, url: d.fileUrl, file: d.originalFileName, size: d.fileSize })),
      ...(l.documents || []).filter(leadDocOk).map((d, i) => ({ id: `l${i}`, name: d.name || d.originalName, kind: d.tag || "Document", date: d.documentDate || day(d.uploadedAt), notes: d.notes, url: d.url, file: d.originalName, size: d.size })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const moms = [
      ...(l.momLogs || []).map((m, i) => ({ id: `c${i}`, src: "crm", title: m.title, text: m.summary, attendees: m.attendees, date: day(m.date || m.at), by: m.by })),
      ...meetings.map(m => ({ id: String(m._id), src: "portal", title: m.title, text: m.momTxt || m.notes, attendees: [m.theirs, m.ours].filter(Boolean).join(" | "), date: m.date, by: m.account?.name || "" })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return res.json({
      success: true,
      data: {
        id: String(l._id), name, client: l.name, business: l.business || l.company || "", industry: l.industry || "", location: l.location || "", req: l.requirements || "",
        stage: l.projectStage || "", start: day(l.projectStartDate), due: day(l.projectCompletionDate), onboarded: day(l.onboardedDate), completed: !!l.projectCompleted, timeline: l.agreedTimeline || 0,
        team, files, moms, showSecrets,
        history: (l.history || []).filter(h => /project|stage|developer|deliver|onboard|complet/i.test(`${h.title} ${h.meta}`) && !/₹|payment|invoice|advance/i.test(`${h.title} ${h.meta}`))
          .slice(-30).reverse().map(h => ({ title: h.title, meta: h.meta, by: h.by, at: h.at })),
        integrations: ints.map(i => ({
          id: String(i._id), service: i.service, category: i.category, owner: i.accountOwner, mode: i.mode, status: i.status, loginUrl: i.loginUrl, username: i.username,
          secrets: showSecrets ? (i.secrets || []).map(s => ({ id: String(s._id), label: s.label })) : [], renewal: day(i.renewalDate), notes: i.notes, updated: i.updatedAt,
        })),
        extras: extras.map(x => ({ id: String(x._id), title: x.title, description: x.description, status: x.status, date: day(x.requestedDate) })),
        work: work.map(w => ({ ...w, by: w.account?.name || "", byRole: w.account?.role || "", account: w.account?._id })),
      },
    });
  } catch (err) { return fail(res, err, "projectDetail"); }
}

// POST /api/portal/projects/:id/integrations/:iid/secrets/:sid/reveal
export async function revealProjectSecret(req, res) {
  try {
    const l = await myLead(req, res, req.params.id, "_id");
    if (!l) return undefined;
    if ((await getSettingsDoc()).showSecrets === false) return res.status(403).json({ success: false, message: "The admin has turned off passwords in the portal" });
    const { iid, sid } = req.params;
    if (!isId(iid) || !isId(sid)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await Integration.findOne({ _id: iid, lead: l._id }).select("secrets");
    const secret = doc?.secrets.id(sid);
    if (!secret) return res.status(404).json({ success: false, message: "Not found" });
    let value;
    try { value = decryptSecret(secret.value); }
    catch (e) { return res.status(500).json({ success: false, message: e.status ? e.message : "Could not decrypt this value" }); }
    await Integration.updateOne({ _id: iid }, { $push: { revealLog: { $each: [{ label: secret.label, by: `${req.portal.name} (Employee Portal)`, at: new Date() }], $slice: -50 } } });
    return res.json({ success: true, value });
  } catch (err) { return fail(res, err, "revealProjectSecret"); }
}

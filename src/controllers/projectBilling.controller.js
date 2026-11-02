import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import ProjectExtra, { EXTRA_STATUSES, PAYMENT_MODES } from "../models/ProjectExtra.js";
import RecurringService, { SERVICE_TYPES } from "../models/RecurringService.js";

/*
 * Billing after the original deal:
 *   - Additional work (one-time extras)   → /api/project-extras
 *   - Monthly services (recurring)        → /api/recurring-services
 */

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const LEAD_FIELDS = "name business company phone projectStage";

function sendError(res, err, where) {
  console.error(`${where} error:`, err);
  if (err.name === "ValidationError" || err.name === "CastError") {
    return res.status(400).json({ success: false, message: err.message });
  }
  return res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
}

const withGst = (amount, gstApplicable, gstRate) =>
  Math.round((Number(amount) || 0) * (gstApplicable ? 1 + (Number(gstRate) || 0) / 100 : 1));

const toDate = (v) => (v ? new Date(v) : null);

function pickPayment(body, actor) {
  const amount = Math.max(0, Number(body.amount) || 0);
  return {
    amount,
    date:      toDate(body.date) || new Date(),
    mode:      PAYMENT_MODES.includes(body.mode) ? body.mode : "UPI",
    reference: String(body.reference || "").trim(),
    note:      String(body.note || "").trim(),
    by:        actor || "Admin",
  };
}

async function ensureLead(leadId) {
  if (!leadId || !isValidId(leadId)) {
    const e = new Error("Project is required"); e.status = 400; throw e;
  }
  if (!(await Lead.exists({ _id: leadId }))) {
    const e = new Error("Project not found"); e.status = 404; throw e;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Additional work (one-time extras)
// ═════════════════════════════════════════════════════════════════════════════

function pickExtra(body) {
  const out = {};
  if (body.title         !== undefined) out.title         = String(body.title || "").trim();
  if (body.description   !== undefined) out.description   = String(body.description || "").trim();
  if (body.amount        !== undefined) out.amount        = Math.max(0, Number(body.amount) || 0);
  if (body.gstApplicable !== undefined) out.gstApplicable = !!body.gstApplicable;
  if (body.gstRate       !== undefined) out.gstRate       = Math.max(0, Number(body.gstRate) || 0);
  if (body.status        !== undefined && EXTRA_STATUSES.includes(body.status)) out.status = body.status;
  if (body.requestedDate !== undefined) out.requestedDate = toDate(body.requestedDate) || new Date();
  return out;
}

function extraView(doc) {
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const total = withGst(o.amount, o.gstApplicable, o.gstRate);
  const paid  = (o.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  return { ...o, total, gst: total - (o.amount || 0), paid, balance: o.status === "cancelled" ? 0 : Math.max(0, total - paid) };
}

// GET /api/project-extras?lead=<id>   (no lead → all, with project names)
export async function listExtras(req, res) {
  try {
    const { lead } = req.query;
    if (lead && !isValidId(lead)) return res.status(400).json({ success: false, message: "Invalid project id" });
    const query = ProjectExtra.find(lead ? { lead } : {}).sort({ requestedDate: -1, createdAt: -1 });
    if (!lead) query.populate("lead", LEAD_FIELDS);
    const docs = await query.lean();
    return res.json({ success: true, data: docs.filter(d => d.lead).map(extraView) });
  } catch (err) { return sendError(res, err, "listExtras"); }
}

export async function createExtra(req, res) {
  try {
    await ensureLead(req.body.lead);
    const fields = pickExtra(req.body);
    if (!fields.title) return res.status(400).json({ success: false, message: "Title is required" });
    const doc = await ProjectExtra.create({
      ...fields,
      lead: req.body.lead,
      addedBy: req.actorName || "Admin",
      updatedBy: req.actorName || "Admin",
    });
    return res.status(201).json({ success: true, data: extraView(doc) });
  } catch (err) { return sendError(res, err, "createExtra"); }
}

export async function updateExtra(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await ProjectExtra.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    const fields = pickExtra(req.body);
    if ("title" in fields && !fields.title) return res.status(400).json({ success: false, message: "Title is required" });
    Object.assign(doc, fields, { updatedBy: req.actorName || "Admin" });
    await doc.save();
    return res.json({ success: true, data: extraView(doc) });
  } catch (err) { return sendError(res, err, "updateExtra"); }
}

export async function deleteExtra(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await ProjectExtra.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true });
  } catch (err) { return sendError(res, err, "deleteExtra"); }
}

export async function addExtraPayment(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const payment = pickPayment(req.body, req.actorName);
    if (!payment.amount) return res.status(400).json({ success: false, message: "Amount is required" });
    const doc = await ProjectExtra.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    doc.payments.push(payment);
    doc.updatedBy = req.actorName || "Admin";
    await doc.save();
    return res.json({ success: true, data: extraView(doc) });
  } catch (err) { return sendError(res, err, "addExtraPayment"); }
}

export async function deleteExtraPayment(req, res) {
  try {
    const { id, paymentId } = req.params;
    if (!isValidId(id) || !isValidId(paymentId)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await ProjectExtra.findById(id);
    if (!doc?.payments.id(paymentId)) return res.status(404).json({ success: false, message: "Payment not found" });
    doc.payments.pull(paymentId);
    await doc.save();
    return res.json({ success: true, data: extraView(doc) });
  } catch (err) { return sendError(res, err, "deleteExtraPayment"); }
}

// ═════════════════════════════════════════════════════════════════════════════
// Monthly services (recurring)
// ═════════════════════════════════════════════════════════════════════════════

// Today's date in India (server may run in UTC). Stored dates come from
// <input type="date"> as UTC midnight, so they are read with UTC getters too.
function istToday() {
  const d = new Date(Date.now() + 330 * 60000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const periodOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/*
 * Month-by-month dues from the start month up to this month (or the end month
 * if the service was stopped earlier). Each month: paid | partial | waived |
 * overdue (billing day passed, not fully paid) | due (billing day not reached).
 */
export function buildSchedule(svc, today = istToday()) {
  const monthly = withGst(svc.amount, svc.gstApplicable, svc.gstRate);
  const start   = new Date(svc.startDate);
  const lastDay = svc.endDate && new Date(svc.endDate) < today ? new Date(svc.endDate) : today;

  const byPeriod = new Map();
  for (const p of svc.payments || []) {
    if (!byPeriod.has(p.period)) byPeriod.set(p.period, []);
    byPeriod.get(p.period).push(p);
  }

  const rows = [];
  let y = start.getUTCFullYear(), m = start.getUTCMonth();
  while (y < lastDay.getUTCFullYear() || (y === lastDay.getUTCFullYear() && m <= lastDay.getUTCMonth())) {
    const period   = `${y}-${String(m + 1).padStart(2, "0")}`;
    const dueDate  = new Date(Date.UTC(y, m, svc.billingDay || 1));
    const payments = byPeriod.get(period) || [];
    const paid     = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const waived   = payments.some(p => p.waived);

    let status;
    if (waived) status = "waived";
    else if (paid >= monthly) status = "paid";
    else if (dueDate < today) status = "overdue";
    else status = paid > 0 ? "partial" : "due";

    rows.push({ period, dueDate, amount: waived ? 0 : monthly, paid, balance: waived ? 0 : Math.max(0, monthly - paid), status, payments });
    m += 1;
    if (m === 12) { m = 0; y += 1; }
  }
  return rows.reverse(); // latest month first
}

function serviceView(doc, today = istToday()) {
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  const schedule = buildSchedule(o, today);
  const overdue  = schedule.filter(r => r.status === "overdue");
  const current  = schedule.find(r => r.period === periodOf(today)) || null;
  return {
    ...o,
    monthlyTotal: withGst(o.amount, o.gstApplicable, o.gstRate),
    active:       !o.endDate || new Date(o.endDate) >= today,
    schedule,
    current,
    billed:        schedule.reduce((s, r) => s + r.amount, 0),
    collected:     schedule.reduce((s, r) => s + r.paid, 0),
    overdueCount:  overdue.length,
    overdueAmount: overdue.reduce((s, r) => s + r.balance, 0),
  };
}

function pickService(body) {
  const out = {};
  if (body.name          !== undefined) out.name          = String(body.name || "").trim();
  if (body.type          !== undefined) out.type          = SERVICE_TYPES.includes(body.type) ? body.type : "Other";
  if (body.amount        !== undefined) out.amount        = Math.max(0, Number(body.amount) || 0);
  if (body.gstApplicable !== undefined) out.gstApplicable = !!body.gstApplicable;
  if (body.gstRate       !== undefined) out.gstRate       = Math.max(0, Number(body.gstRate) || 0);
  if (body.billingDay    !== undefined) out.billingDay    = Math.min(28, Math.max(1, parseInt(body.billingDay, 10) || 1));
  if (body.startDate     !== undefined) out.startDate     = toDate(body.startDate);
  if (body.endDate       !== undefined) out.endDate       = toDate(body.endDate);
  if (body.notes         !== undefined) out.notes         = String(body.notes || "").trim();
  return out;
}

// GET /api/recurring-services?lead=<id>   (no lead → all, with project names)
export async function listServices(req, res) {
  try {
    const { lead } = req.query;
    if (lead && !isValidId(lead)) return res.status(400).json({ success: false, message: "Invalid project id" });
    const query = RecurringService.find(lead ? { lead } : {}).sort({ createdAt: -1 });
    if (!lead) query.populate("lead", LEAD_FIELDS);
    const docs  = await query.lean();
    const today = istToday();
    return res.json({ success: true, period: periodOf(today), data: docs.filter(d => d.lead).map(d => serviceView(d, today)) });
  } catch (err) { return sendError(res, err, "listServices"); }
}

export async function createService(req, res) {
  try {
    await ensureLead(req.body.lead);
    const fields = pickService(req.body);
    if (!fields.name)      return res.status(400).json({ success: false, message: "Service name is required" });
    if (!fields.startDate) return res.status(400).json({ success: false, message: "Start date is required" });
    const doc = await RecurringService.create({
      ...fields,
      lead: req.body.lead,
      addedBy: req.actorName || "Admin",
      updatedBy: req.actorName || "Admin",
    });
    return res.status(201).json({ success: true, data: serviceView(doc) });
  } catch (err) { return sendError(res, err, "createService"); }
}

export async function updateService(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await RecurringService.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    const fields = pickService(req.body);
    if ("name" in fields && !fields.name)           return res.status(400).json({ success: false, message: "Service name is required" });
    if ("startDate" in fields && !fields.startDate) return res.status(400).json({ success: false, message: "Start date is required" });
    Object.assign(doc, fields, { updatedBy: req.actorName || "Admin" });
    await doc.save();
    return res.json({ success: true, data: serviceView(doc) });
  } catch (err) { return sendError(res, err, "updateService"); }
}

export async function deleteService(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await RecurringService.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true });
  } catch (err) { return sendError(res, err, "deleteService"); }
}

// POST /api/recurring-services/:id/payments  { period, amount, date, mode, reference, note, waived }
export async function addServicePayment(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const period = String(req.body.period || "");
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ success: false, message: "Month is required" });
    const waived  = !!req.body.waived;
    const payment = { ...pickPayment(req.body, req.actorName), period, waived };
    if (waived) payment.amount = 0;
    else if (!payment.amount) return res.status(400).json({ success: false, message: "Amount is required" });

    const doc = await RecurringService.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    doc.payments.push(payment);
    doc.updatedBy = req.actorName || "Admin";
    await doc.save();
    return res.json({ success: true, data: serviceView(doc) });
  } catch (err) { return sendError(res, err, "addServicePayment"); }
}

export async function deleteServicePayment(req, res) {
  try {
    const { id, paymentId } = req.params;
    if (!isValidId(id) || !isValidId(paymentId)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await RecurringService.findById(id);
    if (!doc?.payments.id(paymentId)) return res.status(404).json({ success: false, message: "Payment not found" });
    doc.payments.pull(paymentId);
    await doc.save();
    return res.json({ success: true, data: serviceView(doc) });
  } catch (err) { return sendError(res, err, "deleteServicePayment"); }
}

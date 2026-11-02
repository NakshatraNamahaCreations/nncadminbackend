import mongoose from "mongoose";
import Integration, { INTEGRATION_CATEGORIES, INTEGRATION_STATUSES } from "../models/Integration.js";
import Lead from "../models/Lead.js";
import { encryptSecret, decryptSecret } from "../utils/secretBox.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Never send encrypted values — only whether each secret has one
function toSafe(doc) {
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  o.secrets = (o.secrets || []).map(s => ({ _id: s._id, label: s.label, hasValue: !!s.value }));
  delete o.revealLog;
  return o;
}

function sendError(res, err, where) {
  console.error(`${where} error:`, err);
  if (err.name === "ValidationError") return res.status(400).json({ success: false, message: err.message });
  return res.status(err.status || 500).json({ success: false, message: err.message || "Server error" });
}

// Plain (non-secret) fields accepted on create/update
function pickFields(body) {
  const out = {};
  if (body.service      !== undefined) out.service      = String(body.service || "").trim();
  if (body.category     !== undefined) out.category     = INTEGRATION_CATEGORIES.includes(body.category) ? body.category : "Other";
  if (body.accountOwner !== undefined) out.accountOwner = body.accountOwner === "nnc" ? "nnc" : "client";
  if (body.mode         !== undefined) out.mode         = body.mode === "test" ? "test" : "live";
  if (body.status       !== undefined && INTEGRATION_STATUSES.includes(body.status)) out.status = body.status;
  if (body.loginUrl     !== undefined) out.loginUrl     = String(body.loginUrl || "").trim();
  if (body.username     !== undefined) out.username     = String(body.username || "").trim();
  if (body.cost         !== undefined) out.cost         = Math.max(0, Number(body.cost) || 0);
  if (body.billingCycle !== undefined) out.billingCycle = ["one_time", "monthly", "yearly"].includes(body.billingCycle) ? body.billingCycle : "";
  if (body.renewalDate  !== undefined) out.renewalDate  = body.renewalDate ? new Date(body.renewalDate) : null;
  if (body.notes        !== undefined) out.notes        = String(body.notes || "").trim();
  return out;
}

/*
 * Merge incoming secrets with stored ones.
 * Incoming: [{ _id?, label, value? }]
 *   - value given (non-empty) → encrypt and store
 *   - value omitted/blank on an existing _id → keep the stored value
 *   - stored secrets not present in the list → removed
 */
function mergeSecrets(existing = [], incoming = []) {
  const byId = new Map(existing.map(s => [String(s._id), s]));
  return incoming
    .filter(s => String(s?.label || "").trim())
    .map(s => {
      const prev  = s._id ? byId.get(String(s._id)) : null;
      const value = String(s.value ?? "");
      return {
        ...(prev ? { _id: prev._id } : {}),
        label: String(s.label).trim(),
        value: value ? encryptSecret(value) : (prev?.value || ""),
      };
    });
}

// ---------------------------------------------------------------------------
// GET /api/integrations?lead=<projectId>  → one project's integrations
// GET /api/integrations[?category=&status=] → all projects' integrations,
//     each with its project's name (for the sidebar Integrations page)
// ---------------------------------------------------------------------------
export async function getIntegrations(req, res) {
  try {
    const { lead, category, status } = req.query;

    if (lead) {
      if (!isValidId(lead)) return res.status(400).json({ success: false, message: "Invalid project id" });
      const docs = await Integration.find({ lead }).sort({ createdAt: -1 }).lean();
      return res.json({ success: true, data: docs.map(toSafe) });
    }

    const filter = {};
    if (category && INTEGRATION_CATEGORIES.includes(category)) filter.category = category;
    if (status && INTEGRATION_STATUSES.includes(status)) filter.status = status;

    const docs = await Integration.find(filter)
      .populate("lead", "name business company phone projectStage")
      .sort({ createdAt: -1 })
      .lean();

    // Skip integrations whose project was deleted
    return res.json({ success: true, data: docs.filter(d => d.lead).map(toSafe) });
  } catch (err) {
    return sendError(res, err, "getIntegrations");
  }
}

// ---------------------------------------------------------------------------
// POST /api/integrations
// ---------------------------------------------------------------------------
export async function createIntegration(req, res) {
  try {
    const { lead, secrets } = req.body;
    if (!lead || !isValidId(lead)) return res.status(400).json({ success: false, message: "Project is required" });
    const fields = pickFields(req.body);
    if (!fields.service) return res.status(400).json({ success: false, message: "Service name is required" });

    const exists = await Lead.exists({ _id: lead });
    if (!exists) return res.status(404).json({ success: false, message: "Project not found" });

    const doc = await Integration.create({
      ...fields,
      lead,
      secrets: mergeSecrets([], Array.isArray(secrets) ? secrets : []),
      addedBy: req.actorName || "Admin",
      updatedBy: req.actorName || "Admin",
    });
    return res.status(201).json({ success: true, data: toSafe(doc) });
  } catch (err) {
    return sendError(res, err, "createIntegration");
  }
}

// ---------------------------------------------------------------------------
// PUT /api/integrations/:id
// ---------------------------------------------------------------------------
export async function updateIntegration(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await Integration.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Integration not found" });

    const fields = pickFields(req.body);
    if ("service" in fields && !fields.service) {
      return res.status(400).json({ success: false, message: "Service name is required" });
    }
    Object.assign(doc, fields);
    if (Array.isArray(req.body.secrets)) doc.secrets = mergeSecrets(doc.secrets, req.body.secrets);
    doc.updatedBy = req.actorName || "Admin";

    await doc.save();
    return res.json({ success: true, data: toSafe(doc) });
  } catch (err) {
    return sendError(res, err, "updateIntegration");
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/integrations/:id
// ---------------------------------------------------------------------------
export async function deleteIntegration(req, res) {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await Integration.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Integration not found" });
    return res.json({ success: true });
  } catch (err) {
    return sendError(res, err, "deleteIntegration");
  }
}

// ---------------------------------------------------------------------------
// POST /api/integrations/:id/secrets/:secretId/reveal
// Returns one decrypted secret and records who viewed it.
// ---------------------------------------------------------------------------
export async function revealSecret(req, res) {
  try {
    const { id, secretId } = req.params;
    if (!isValidId(id) || !isValidId(secretId)) return res.status(400).json({ success: false, message: "Invalid id" });

    const doc = await Integration.findById(id).select("secrets");
    const secret = doc?.secrets.id(secretId);
    if (!secret) return res.status(404).json({ success: false, message: "Secret not found" });

    let value;
    try {
      value = decryptSecret(secret.value);
    } catch (e) {
      if (e.status) throw e; // missing key → clear config error
      return res.status(500).json({ success: false, message: "Could not decrypt — the encryption key may have changed" });
    }

    await Integration.updateOne(
      { _id: id },
      { $push: { revealLog: { $each: [{ label: secret.label, by: req.actorName || "Admin", at: new Date() }], $slice: -50 } } }
    );
    return res.json({ success: true, value });
  } catch (err) {
    return sendError(res, err, "revealSecret");
  }
}

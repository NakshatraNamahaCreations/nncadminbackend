import Credential, { encrypt, decrypt } from "../models/Credential.js";
import mongoose from "mongoose";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Strip encrypted password from response — only send it when explicitly requested (reveal)
const safeDoc = (doc) => {
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  obj.password = obj.password ? "••••••••" : "";
  return obj;
};

// ─── GET all (or filtered) ────────────────────────────────────
export const getCredentials = async (req, res) => {
  try {
    const { q, category, pinned } = req.query;
    const filter = {};

    if (q?.trim()) {
      if (q.trim().length >= 2) {
        filter.$text = { $search: q.trim() };
      }
    }
    if (category) filter.category = category;
    if (pinned === "true") filter.pinned = true;

    const docs = await Credential.find(filter)
      .sort({ pinned: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      credentials: docs.map(d => ({ ...d, password: d.password ? "••••••••" : "" })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST create ──────────────────────────────────────────────
export const createCredential = async (req, res) => {
  try {
    const { label, category, username, password, url, notes, tags, pinned } = req.body;
    if (!label?.trim()) return res.status(400).json({ success: false, message: "Label is required" });

    const doc = await Credential.create({
      label:    label.trim(),
      category: category || "Other",
      username: username?.trim() || "",
      password: password ? encrypt(password) : "",
      url:      url?.trim() || "",
      notes:    notes?.trim() || "",
      tags:     Array.isArray(tags) ? tags : [],
      pinned:   !!pinned,
      addedBy:  req.user?.name || "Owner",
    });

    return res.status(201).json({ success: true, credential: safeDoc(doc) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT update ───────────────────────────────────────────────
export const updateCredential = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const doc = await Credential.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const { label, category, username, password, url, notes, tags, pinned } = req.body;

    if (label?.trim())    doc.label    = label.trim();
    if (category)         doc.category = category;
    if (username !== undefined) doc.username = username?.trim() || "";
    if (password?.trim()) doc.password = encrypt(password.trim());
    if (url !== undefined)   doc.url   = url?.trim() || "";
    if (notes !== undefined) doc.notes = notes?.trim() || "";
    if (Array.isArray(tags)) doc.tags  = tags;
    if (pinned !== undefined) doc.pinned = Boolean(pinned);

    await doc.save();
    return res.json({ success: true, credential: safeDoc(doc) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE ───────────────────────────────────────────────────
export const deleteCredential = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await Credential.findByIdAndDelete(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST reveal password (returns decrypted value for one doc)
export const revealPassword = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await Credential.findById(id).select("password").lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    const plain = decrypt(doc.password);
    return res.json({ success: true, password: plain });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH pin toggle ─────────────────────────────────────────
export const togglePin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const doc = await Credential.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    doc.pinned = !doc.pinned;
    await doc.save();
    return res.json({ success: true, credential: safeDoc(doc) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

import mongoose from "mongoose";
import SalesDeskSetting from "../models/SalesDeskSetting.js";

async function getDoc() {
  const doc = await SalesDeskSetting.findOne({ key: "default" });
  return doc || SalesDeskSetting.create({ key: "default" });
}

function view(doc) {
  const o = doc.toObject({ flattenMaps: true });
  const now = Date.now();
  o.snoozes = (o.snoozes || []).filter(s => new Date(s.until).getTime() > now);
  return o;
}

// GET /api/sales-desk/settings
export async function getSettings(req, res) {
  try {
    // Read-only: defaults are returned without saving until something is changed
    const doc = (await SalesDeskSetting.findOne({ key: "default" })) || new SalesDeskSetting({ key: "default" });
    return res.json({ success: true, data: view(doc) });
  } catch (err) {
    console.error("getSalesDeskSettings error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/sales-desk/settings  { rules?, bankAccountId?, upi?, reviewLink?, templates? }
export async function updateSettings(req, res) {
  try {
    const b = req.body || {};
    const doc = await getDoc();
    if (b.rules && typeof b.rules === "object") {
      for (const k of ["maxAuto", "bigAmount", "quietDays", "afterSend", "reviewDays"]) {
        if (b.rules[k] !== undefined) doc.rules[k] = Math.max(0, Number(b.rules[k]) || 0);
      }
      if (b.rules.holdPause !== undefined) doc.rules.holdPause = !!b.rules.holdPause;
    }
    if (b.bankAccountId !== undefined) {
      doc.bankAccountId = mongoose.Types.ObjectId.isValid(b.bankAccountId) ? b.bankAccountId : null;
    }
    if (b.calendar && typeof b.calendar === "object") {
      const c = b.calendar, hm = (v) => /^\d{2}:\d{2}$/.test(String(v || ""));
      if (hm(c.start)) doc.calendar.start = c.start;
      if (hm(c.end))   doc.calendar.end = c.end;
      if (Array.isArray(c.days)) doc.calendar.days = [...new Set(c.days.map(Number).filter(d => d >= 0 && d <= 6))];
      if (c.buffer !== undefined) doc.calendar.buffer = Math.max(0, Number(c.buffer) || 0);
      if (c.remind !== undefined) doc.calendar.remind = Math.max(0, Number(c.remind) || 0);
      if (c.office !== undefined) doc.calendar.office = String(c.office || "").trim();
    }
    if (b.upi !== undefined)        doc.upi = String(b.upi || "").trim();
    if (b.reviewLink !== undefined) doc.reviewLink = String(b.reviewLink || "").trim();
    if (b.templates && typeof b.templates === "object") {
      for (const [id, text] of Object.entries(b.templates)) {
        if (text == null || text === "") doc.templates.delete(id);
        else doc.templates.set(id, String(text));
      }
    }
    await doc.save();
    return res.json({ success: true, data: view(doc) });
  } catch (err) {
    console.error("updateSalesDeskSettings error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/sales-desk/snooze  { keys: [...], until }  — hide items until a date ("until" empty = un-snooze)
export async function snoozeItems(req, res) {
  try {
    const keys = Array.isArray(req.body?.keys) ? [...new Set(req.body.keys.map(String))].slice(0, 2000) : [];
    if (!keys.length) return res.status(400).json({ success: false, message: "keys required" });
    const until = req.body.until ? new Date(req.body.until) : null;
    if (until && isNaN(until.getTime())) return res.status(400).json({ success: false, message: "Invalid date" });
    const doc = await getDoc();
    const now = Date.now();
    doc.snoozes = doc.snoozes.filter(s => !keys.includes(s.key) && new Date(s.until).getTime() > now);
    if (until) for (const key of keys) doc.snoozes.push({ key, until, by: req.actorName || "" });
    await doc.save();
    return res.json({ success: true, data: view(doc) });
  } catch (err) {
    console.error("snoozeItems error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

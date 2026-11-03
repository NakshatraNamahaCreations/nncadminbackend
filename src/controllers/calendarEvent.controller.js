import mongoose from "mongoose";
import CalendarEvent from "../models/CalendarEvent.js";
import Lead from "../models/Lead.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/* ── GET /api/calendar-events?year=&month=&type= ─────────────── */
export const getEvents = async (req, res) => {
  try {
    const parsedYear  = parseInt(req.query.year, 10);
    const parsedMonth = parseInt(req.query.month, 10);
    const year  = Number.isFinite(parsedYear)  ? parsedYear  : new Date().getFullYear();
    const month = Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth : new Date().getMonth() + 1;
    const type  = req.query.type;

    // Flat list: ?from=&to= (date range) or ?pending=1 (not done, up to 8 days ahead)
    if (req.query.from || req.query.to || req.query.pending) {
      const q = {};
      if (req.query.pending) {
        q.done = { $ne: true };
        q.status = { $nin: ["cancelled", "done"] };
        q.date = { $lte: new Date(Date.now() + 8 * 864e5) };
      } else {
        q.date = {};
        if (req.query.from) q.date.$gte = new Date(req.query.from);
        if (req.query.to)   q.date.$lt  = new Date(req.query.to);
      }
      if (type) q.type = type;
      const list = await CalendarEvent.find(q).sort({ date: 1, time: 1 }).limit(2000).lean();
      return res.json({ success: true, list });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 1);

    const query = { date: { $gte: startDate, $lt: endDate } };
    if (type) query.type = type;

    const events = await CalendarEvent.find(query).sort({ date: 1 }).lean();

    // Group by day of month
    const grouped = {};
    for (const ev of events) {
      const day = new Date(ev.date).getDate();
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(ev);
    }

    return res.json({ success: true, data: grouped });
  } catch (err) {
    console.error("getEvents error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── POST /api/calendar-events ───────────────────────────────── */
export const createEvent = async (req, res) => {
  try {
    const { leadId, enquiryId, type, date, title, notes, time, duration, mode, email, link, amount, leadName: nameIn, leadPhone: phoneIn } = req.body;

    if (!type || !date) {
      return res.status(400).json({
        success: false,
        message: "type and date are required",
      });
    }

    let leadName = "", leadPhone = "", leadBusiness = "", leadStage = "";

    if (leadId) {
      if (!isValidObjectId(leadId)) {
        return res.status(400).json({ success: false, message: "Invalid lead id" });
      }
      const lead = await Lead.findById(leadId).lean();
      if (!lead) {
        return res.status(404).json({ success: false, message: "Lead not found" });
      }
      leadName     = lead.name     || "";
      leadPhone    = lead.phone    || lead.mobile || "";
      leadBusiness = lead.business || lead.company || "";
      leadStage    = lead.stage    || "";
    } else if (enquiryId) {
      if (!isValidObjectId(enquiryId)) {
        return res.status(400).json({ success: false, message: "Invalid enquiry id" });
      }
      // Dynamic import to avoid circular dep
      const { default: Enquiry } = await import("../models/Enquiry.js");
      const enq = await Enquiry.findById(enquiryId).lean();
      if (enq) {
        leadName     = enq.name    || "";
        leadPhone    = enq.phone   || "";
        leadBusiness = enq.company || "";
      }
    }

    // Entries without a lead/enquiry (eg. a walk-in call) keep the name typed in
    if (!leadId && !enquiryId) { leadName = String(nameIn || "").trim(); leadPhone = String(phoneIn || "").trim(); }

    const event = await CalendarEvent.create({
      leadId:    leadId    || null,
      enquiryId: enquiryId || null,
      leadName,
      leadPhone,
      leadBusiness,
      leadStage,
      type,
      date:      new Date(date),
      title:     title || "",
      notes:     notes || "",
      time:      String(time || ""),
      duration:  Number(duration) || 30,
      mode:      ["meet", "office", "phone"].includes(mode) ? mode : "",
      email:     String(email || ""),
      link:      String(link || ""),
      amount:    Number(amount) || 0,
      createdBy: req.user?.name || req.user?.email || "",
    });

    return res.status(201).json({ success: true, data: event });
  } catch (err) {
    console.error("createEvent error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── PUT /api/calendar-events/:id ───────────────────────────── */
// Reschedule, add a meeting summary, or mark done / cancelled / no-show
export const updateEvent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const b = req.body || {};
    const set = {};
    if (b.date)              set.date = new Date(b.date);
    for (const k of ["time", "title", "notes", "summary", "outcome", "email", "link"]) {
      if (b[k] !== undefined) set[k] = String(b[k] || "");
    }
    if (b.duration !== undefined) set.duration = Number(b.duration) || 30;
    if (b.amount !== undefined)   set.amount = Number(b.amount) || 0;
    if (b.mode !== undefined)     set.mode = ["meet", "office", "phone"].includes(b.mode) ? b.mode : "";
    if (b.status && ["scheduled", "done", "cancelled", "noshow"].includes(b.status)) set.status = b.status;
    if (b.done !== undefined) {
      set.done = !!b.done;
      set.doneAt = b.done ? new Date() : null;
      if (b.done && !set.status) set.status = "done";
    }
    if (set.date && !set.status && b.done === undefined) { set.status = "scheduled"; set.done = false; }
    const ev = await CalendarEvent.findByIdAndUpdate(req.params.id, { $set: set }, { new: true, runValidators: true }).lean();
    if (!ev) return res.status(404).json({ success: false, message: "Event not found" });
    return res.json({ success: true, data: ev });
  } catch (err) {
    console.error("updateEvent error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── DELETE /api/calendar-events/:id ────────────────────────── */
export const deleteEvent = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }
    const ev = await CalendarEvent.findByIdAndDelete(req.params.id);
    if (!ev) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    return res.json({ success: true, message: "Event deleted" });
  } catch (err) {
    console.error("deleteEvent error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

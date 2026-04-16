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

    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 1);

    const query = { date: { $gte: startDate, $lt: endDate } };
    if (type) query.type = type;

    // Hard cap of 500 as a safety net — typical months have 20-60 events.
    const events = await CalendarEvent.find(query).sort({ date: 1 }).limit(500).lean();

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
    const { leadId, enquiryId, type, date, title, notes } = req.body;

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
      createdBy: req.user?.name || req.user?.email || "",
    });

    return res.status(201).json({ success: true, data: event });
  } catch (err) {
    console.error("createEvent error:", err);
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

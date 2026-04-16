import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Lead from "../models/Lead.js";
import Rep from "../models/Rep.js";
import Document from "../models/Document.js";
import TodayPlanTask from "../models/TodayPlanTask.js";
import { clearDashboardCache } from "../services/dashboard.service.js";
import { clearAnalyticsCache } from "./analytics.controller.js";
import { clearTodayPlanCache } from "./todayPlan.controller.js";
import {
  sendWelcomeEmail,
  sendProjectInitiationEmail,
  sendProjectCompletionEmail,
  sendMOMEmail,
  sendFollowupEmail,
  sendCustomEmail,
  sendPaymentReminderEmail,
  sendPaymentReceiptEmail,
  sendDocumentRequestEmail,
} from "../services/emailService.js";

const STAGES = [
  "Lead Capture",
  "Reachable",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Closed",
  "Closed Won",
];

const PRIORITIES = ["Hot", "Warm", "Cold"];
const SOURCES = ["WhatsApp", "Website", "Call", "Instagram", "Referral", "Google Ads", "JustDial"];

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clean = (v) => {
  try {
    if (v == null) return "";
    if (typeof v === "object") {
      if (typeof v.text === "string") return v.text.trim();
      return "";
    }
    return String(v).trim();
  } catch (error) {
    console.error("clean error:", error);
    return "";
  }
};

const toNum = (v, def = 0) => {
  try {
    if (v == null || v === "") return def;

    if (typeof v === "string" && v.includes("/")) {
      const first = Number(v.split("/")[0]);
      return Number.isFinite(first) ? first : def;
    }

    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  } catch (error) {
    console.error("toNum error:", error);
    return def;
  }
};

const isValidObjectId = (id) => {
  try {
    return mongoose.Types.ObjectId.isValid(id);
  } catch (error) {
    console.error("isValidObjectId error:", error);
    return false;
  }
};

const startOfDay = (date = new Date()) => {
  try {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  } catch (error) {
    console.error("startOfDay error:", error);
    return new Date();
  }
};

const endOfDay = (date = new Date()) => {
  try {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  } catch (error) {
    console.error("endOfDay error:", error);
    return new Date();
  }
};

const getDueLabel = (dateValue) => {
  try {
    if (!dateValue) return "ASAP";

    const now = new Date();
    const taskDate = new Date(dateValue);

    const todayStart = startOfDay(now).getTime();
    const taskStart = startOfDay(taskDate).getTime();
    const diffDays = Math.round((taskStart - todayStart) / 86400000);

    if (diffDays < 0) return "Overdue";
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";

    return taskDate.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  } catch (error) {
    console.error("getDueLabel error:", error);
    return "ASAP";
  }
};

const normalizeStage = (value) => {
  try {
    const stage = clean(value);

    if (!stage) return "Lead Capture";

    const map = {
      "Lead Capture": "Lead Capture",
      Contacted: "Reachable",
      Reachable: "Reachable",
      Qualified: "Qualified",
      Proposal: "Proposal",
      Negotiation: "Negotiation",
      Won: "Closed Won",
      Lost: "Closed",
      Closed: "Closed",
      "Closed Won": "Closed Won",
    };

    return map[stage] || "Lead Capture";
  } catch (error) {
    console.error("normalizeStage error:", error);
    return "Lead Capture";
  }
};

const normalizePriority = (value) => {
  try {
    const priority = clean(value);
    return PRIORITIES.includes(priority) ? priority : "Hot";
  } catch (error) {
    console.error("normalizePriority error:", error);
    return "Hot";
  }
};

const normalizeSource = (value) => {
  try {
    const source = clean(value);
    return SOURCES.includes(source) ? source : clean(value) || "WhatsApp";
  } catch (error) {
    console.error("normalizeSource error:", error);
    return "WhatsApp";
  }
};

const normalizeStatus = (value, stage = "") => {
  try {
    const status = clean(value);

    if (["new", "in_progress", "won", "lost", "closed"].includes(status)) {
      return status;
    }

    const normalizedStage = normalizeStage(stage);

    if (normalizedStage === "Closed Won") return "won";
    if (normalizedStage === "Closed") return "closed";
    if (["Qualified", "Proposal", "Negotiation", "Reachable"].includes(normalizedStage)) {
      return "in_progress";
    }

    return "new";
  } catch (error) {
    console.error("normalizeStatus error:", error);
    return "new";
  }
};

const syncTodayPlanTaskFromFollowup = async (lead, followup) => {
  try {
    if (!lead || !followup) return null;

    const plannedDate = followup?.dueDate ? new Date(followup.dueDate) : new Date();
    const sameDayStart = startOfDay(plannedDate);
    const sameDayEnd = endOfDay(plannedDate);

    const title = clean(followup.title) || `Follow-up - ${clean(lead.name) || "Lead"}`;

    const existing = await TodayPlanTask.findOne({
      leadId: lead._id,
      taskType: "follow_up",
      plannedDate: { $gte: sameDayStart, $lte: sameDayEnd },
      title,
    });

    const payload = {
      leadId: lead._id,
      title,
      taskType: "follow_up",
      priority: ["hot", "urgent"].includes(clean(lead.priority).toLowerCase()) ? "urgent" : "medium",
      status: followup.done ? "completed" : "pending",
      section: "follow_up_today",
      dueLabel: getDueLabel(plannedDate),
      subtitle:
        clean(lead.requirements) ||
        clean(lead.business) ||
        clean(lead.company) ||
        "Lead follow-up",
      city: clean(lead.location),
      ownerName: clean(lead.repName) || clean(lead.rep) || "Unassigned",
      source: clean(lead.source),
      service: clean(lead.business) || clean(lead.company),
      phone: clean(lead.phone) || clean(lead.mobile),
      notes: `${clean(followup.channel)} • ${clean(followup.status)}`.trim(),
      plannedDate,
      sortOrder: Number(followup.dayIndex || 0),
      completedAt: followup.done ? new Date() : null,
    };

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
      return existing;
    }

    const created = await TodayPlanTask.create(payload);
    return created;
  } catch (error) {
    console.error("syncTodayPlanTaskFromFollowup error:", error);
    return null;
  }
};

const normalizeBantDetails = (input = {}) => {
  try {
    const cleanText = (v) => {
      try {
        if (v == null) return "";
        if (typeof v === "object") return String(v.text || "").trim();
        return String(v).trim();
      } catch (error) {
        console.error("cleanText error:", error);
        return "";
      }
    };

    const toNumber = (v, def = 0) => {
      try {
        if (v == null || v === "") return def;

        if (typeof v === "string" && v.includes("/")) {
          const first = Number(v.split("/")[0]);
          return Number.isFinite(first) ? first : def;
        }

        const n = Number(v);
        return Number.isFinite(n) ? n : def;
      } catch (error) {
        console.error("toNumber error:", error);
        return def;
      }
    };

    const normalized = {
      budgetMin: toNumber(input?.budgetMin, 0),
      budgetMax: toNumber(input?.budgetMax, 0),
      authorityName: cleanText(input?.authorityName),
      authorityRole: cleanText(input?.authorityRole),
      need: cleanText(input?.need),
      timeline: cleanText(input?.timeline),
      score: 0,
    };

    let score = 0;

    if (normalized.budgetMin > 0 || normalized.budgetMax > 0) score += 1;
    if (normalized.authorityName) score += 1;
    if (normalized.need) score += 1;
    if (normalized.timeline) score += 1;

    normalized.score = score;
    return normalized;
  } catch (error) {
    console.error("normalizeBantDetails error:", error);
    return {
      budgetMin: 0,
      budgetMax: 0,
      authorityName: "",
      authorityRole: "",
      need: "",
      timeline: "",
      score: 0,
    };
  }
};

const buildStageTimestamps = (currentStage = "Lead Capture", existing = []) => {
  try {
    if (Array.isArray(existing) && existing.length > 0) {
      return existing.map((item) => ({
        label: clean(item?.label),
        done: Boolean(item?.done),
        at: item?.at ? new Date(item.at) : null,
      }));
    }

    const normalizedStage = normalizeStage(currentStage);
    const currentIndex = STAGES.indexOf(normalizedStage);

    return STAGES.map((label, index) => ({
      label,
      done: currentIndex >= 0 ? index <= currentIndex : index === 0,
      at: currentIndex >= 0 && index <= currentIndex ? new Date() : null,
    }));
  } catch (error) {
    console.error("buildStageTimestamps error:", error);
    return [];
  }
};

const buildDefaultFollowups = (existing = []) => {
  try {
    if (Array.isArray(existing) && existing.length > 0) {
      return existing.map((item, idx) => ({
        dayIndex: toNum(item?.dayIndex, idx + 1),
        title: clean(item?.title),
        channel: clean(item?.channel) || "Call",
        status: clean(item?.status) || "Pending",
        done: Boolean(item?.done),
        dueDate: item?.dueDate ? new Date(item.dueDate) : null,
        by: clean(item?.by) || "User",
        at: item?.at ? new Date(item.at) : new Date(),
      }));
    }

    return [
      {
        dayIndex: 1,
        title: "First Contact",
        channel: "Call",
        status: "Pending",
        done: false,
        dueDate: null,
        by: "User",
        at: new Date(),
      },
      {
        dayIndex: 3,
        title: "WhatsApp Follow-up",
        channel: "WhatsApp",
        status: "Pending",
        done: false,
        dueDate: null,
        by: "User",
        at: new Date(),
      },
      {
        dayIndex: 5,
        title: "Qualification Call",
        channel: "Call",
        status: "Pending",
        done: false,
        dueDate: null,
        by: "User",
        at: new Date(),
      },
      {
        dayIndex: 7,
        title: "Proposal Reminder",
        channel: "WhatsApp",
        status: "Pending",
        done: false,
        dueDate: null,
        by: "User",
        at: new Date(),
      },
      {
        dayIndex: 10,
        title: "Final Follow-up",
        channel: "Call",
        status: "Pending",
        done: false,
        dueDate: null,
        by: "User",
        at: new Date(),
      },
    ];
  } catch (error) {
    console.error("buildDefaultFollowups error:", error);
    return [];
  }
};

const computeStageTimings = (stageTimestamps = []) => {
  try {
    const result = {
      new: 0,
      qualified: 0,
      proposal: 0,
      negotiation: 0,
      closed: 0,
    };

    if (!Array.isArray(stageTimestamps) || !stageTimestamps.length) {
      return result;
    }

    const getTime = (label) => {
      const found = stageTimestamps.find((x) => clean(x?.label) === label && x?.at);
      return found?.at ? new Date(found.at).getTime() : null;
    };

    const leadCapture = getTime("Lead Capture");
    const qualified = getTime("Qualified");
    const proposal = getTime("Proposal");
    const negotiation = getTime("Negotiation");
    const closed = getTime("Closed") || getTime("Closed Won");
    const now = Date.now();

    if (leadCapture && qualified) result.new = Math.max(0, Math.round((qualified - leadCapture) / 86400000));
    if (qualified && proposal) result.qualified = Math.max(0, Math.round((proposal - qualified) / 86400000));
    if (proposal && negotiation) result.proposal = Math.max(0, Math.round((negotiation - proposal) / 86400000));
    if (negotiation && closed) result.negotiation = Math.max(0, Math.round((closed - negotiation) / 86400000));
    if (closed) result.closed = Math.max(0, Math.round((now - closed) / 86400000));

    return result;
  } catch (error) {
    console.error("computeStageTimings error:", error);
    return {
      new: 0,
      qualified: 0,
      proposal: 0,
      negotiation: 0,
      closed: 0,
    };
  }
};

const normalizeLeadBeforeSave = (lead) => {
  try {
    if (!lead) return lead;

    lead.name = clean(lead.name);
    lead.phone = clean(lead.phone);
    lead.mobile = clean(lead.mobile) || clean(lead.phone);
    lead.email = clean(lead.email).toLowerCase();
    lead.business = clean(lead.business);
    lead.company = clean(lead.company) || clean(lead.business);
    lead.industry = clean(lead.industry);
    lead.location = clean(lead.location);
    lead.requirements = clean(lead.requirements);

    lead.branch = clean(lead.branch) || "Bangalore";
    lead.source = normalizeSource(lead.source);
    lead.stage = normalizeStage(lead.stage);
    lead.priority = normalizePriority(lead.priority);
    lead.status = normalizeStatus(lead.status, lead.stage);

    lead.rep = clean(lead.rep);
    lead.repName = clean(lead.repName) || clean(lead.rep);
    lead.days = clean(lead.days) || "0d";
    lead.value = toNum(lead.value, 0);
    lead.dealValue = toNum(lead.dealValue, lead.value || 0);

    lead.bantDetails = normalizeBantDetails(lead.bantDetails || {});
    lead.bant = `${lead.bantDetails.score}/4`;

    if (!Array.isArray(lead.notes)) lead.notes = [];
    if (!Array.isArray(lead.commLogs)) lead.commLogs = [];
    if (!Array.isArray(lead.history)) lead.history = [];
    if (!Array.isArray(lead.documents)) lead.documents = [];
    if (!Array.isArray(lead.followups)) lead.followups = [];
    if (!Array.isArray(lead.stageTimestamps)) lead.stageTimestamps = [];

    lead.stageTimings = computeStageTimings(lead.stageTimestamps);

    return lead;
  } catch (error) {
    console.error("normalizeLeadBeforeSave error:", error);
    return lead;
  }
};

const serializeLead = (lead) => {
  try {
    const obj = lead?.toObject ? lead.toObject() : { ...lead };

    obj.id = obj._id?.toString();
    obj.docs = Array.isArray(obj.documents) ? obj.documents.length : 0;
    obj.rep = obj.repName || obj.rep || "";
    obj.repName = obj.repName || obj.rep || "";
    obj.mobile = obj.mobile || obj.phone || "";
    obj.company = obj.company || obj.business || "";
    obj.dealValue = Number(obj.dealValue || obj.value || 0);
    obj.value = Number(obj.value || 0);
    obj.advanceReceived = Number(obj.advanceReceived || 0);
    obj.bant = obj.bant || `${toNum(obj?.bantDetails?.score, 0)}/4`;
    obj.stage = normalizeStage(obj.stage);
    obj.priority = normalizePriority(obj.priority);
    obj.source = normalizeSource(obj.source);

    if (Array.isArray(obj.documents)) {
      obj.documents = obj.documents.map((doc) => ({
        ...doc,
        fileName: doc?.fileName || doc?.originalName || "",
        fileUrl: doc?.fileUrl || doc?.url || "",
        url: doc?.url || doc?.fileUrl || "",
        mimeType: doc?.mimeType || "",
      }));
    }

    return obj;
  } catch (error) {
    console.error("serializeLead error:", error);
    return lead;
  }
};

const getRepDetails = async (body = {}) => {
  try {
    let repId = null;
    let repName = clean(body.repName) || clean(body.rep);

    if (body.repId && isValidObjectId(body.repId)) {
      const repDoc = await Rep.findById(body.repId);
      if (repDoc) {
        repId = repDoc._id;
        repName = repDoc.name || repName;
      }
    } else if (repName) {
      const repDoc = await Rep.findOne({ name: repName });
      if (repDoc) {
        repId = repDoc._id;
        repName = repDoc.name || repName;
      }
    }

    return {
      repId,
      repName,
    };
  } catch (error) {
    console.error("getRepDetails error:", error);
    return {
      repId: null,
      repName: clean(body.repName) || clean(body.rep),
    };
  }
};

export const getLeads = async (req, res) => {
  try {
    const { branch, stage, priority, source, bant, rep, q, status } = req.query;
    const page     = Math.max(1, parseInt(req.query.page  || "1",  10));
    const limit    = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const skip     = (page - 1) * limit;

    const filter = {};

    if (branch && branch !== "All") filter.branch = clean(branch);
    if (stage && stage !== "All") filter.stage = normalizeStage(stage);
    if (priority && priority !== "All") filter.priority = normalizePriority(priority);
    if (source && source !== "All") filter.source = clean(source);
    if (bant && bant !== "All") filter.bant = clean(bant);
    if (rep && rep !== "All") {
      const repName = clean(rep);
      filter.$or = [{ rep: repName }, { repName: repName }];
    }
    if (status && status !== "All") filter.status = normalizeStatus(status);

    if (q && clean(q)) {
      const cleaned = clean(q);
      // Use text index for name/phone/email/business — much faster than regex $or
      // Fall back to phone regex for partial number matching (text index requires full words)
      const isNumeric = /^\d+$/.test(cleaned);
      if (isNumeric) {
        // Phone number partial match — regex needed, but only on indexed phone field
        const phoneRegex = new RegExp(escapeRegex(cleaned), "i");
        const phoneClause = { $or: [{ phone: phoneRegex }, { mobile: phoneRegex }] };
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, phoneClause];
          delete filter.$or;
        } else {
          Object.assign(filter, phoneClause);
        }
      } else {
        // Text index search — uses lead_text_search index, very fast
        filter.$text = { $search: cleaned };
      }
    }

    const [leads, totalCount] = await Promise.all([
      Lead.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Lead.countDocuments(filter),
    ]);

    const data = leads.map((x) => serializeLead(x));

    return res.json({
      success: true,
      count:   data.length,
      total:   totalCount,
      page,
      pages:   Math.ceil(totalCount / limit),
      data,
    });
  } catch (err) {
    console.error("getLeads error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch leads",
    });
  }
};

export const exportLeadsCsv = async (req, res) => {
  try {
    const { branch, stage, priority, source, bant, rep, q, status } = req.query;

    const filter = {};

    if (branch && branch !== "All") filter.branch = clean(branch);
    if (stage && stage !== "All") filter.stage = normalizeStage(stage);
    if (priority && priority !== "All") filter.priority = normalizePriority(priority);
    if (source && source !== "All") filter.source = clean(source);
    if (bant && bant !== "All") filter.bant = clean(bant);
    if (status && status !== "All") filter.status = normalizeStatus(status);

    if (rep && rep !== "All") {
      const repName = clean(rep);
      filter.$or = [{ rep: repName }, { repName: repName }];
    }

    if (q && clean(q)) {
      const regex = new RegExp(escapeRegex(clean(q)), "i");

      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          {
            $or: [
              { name: regex },
              { phone: regex },
              { mobile: regex },
              { business: regex },
              { company: regex },
              { email: regex },
            ],
          },
        ];
        delete filter.$or;
      } else {
        filter.$or = [
          { name: regex },
          { phone: regex },
          { mobile: regex },
          { business: regex },
          { company: regex },
          { email: regex },
        ];
      }
    }

    const leads = await Lead.find(filter)
      .select("name phone email business company stage branch repName advanceReceived createdAt notes")
      .sort({ createdAt: -1 })
      .lean();

    const escapeCsv = (value) => {
      try {
        if (value == null) return "";
        const str = String(value).replace(/"/g, '""');
        return `"${str}"`;
      } catch (error) {
        console.error("escapeCsv error:", error);
        return `""`;
      }
    };

    const headers = [
      "Name",
      "Phone",
      "Mobile",
      "Email",
      "Business",
      "Company",
      "Industry",
      "Location",
      "Branch",
      "Source",
      "Stage",
      "Status",
      "Priority",
      "Value",
      "Deal Value",
      "Days",
      "BANT",
      "Rep",
      "Documents",
      "Created At",
    ];

    const rows = leads.map((lead) => {
      const data = serializeLead(lead);

      return [
        escapeCsv(data.name || ""),
        escapeCsv(data.phone || ""),
        escapeCsv(data.mobile || ""),
        escapeCsv(data.email || ""),
        escapeCsv(data.business || ""),
        escapeCsv(data.company || ""),
        escapeCsv(data.industry || ""),
        escapeCsv(data.location || ""),
        escapeCsv(data.branch || ""),
        escapeCsv(data.source || ""),
        escapeCsv(data.stage || ""),
        escapeCsv(data.status || ""),
        escapeCsv(data.priority || ""),
        escapeCsv(Number(data.value || 0)),
        escapeCsv(Number(data.dealValue || 0)),
        escapeCsv(data.days || ""),
        escapeCsv(data.bant || ""),
        escapeCsv(data.repName || data.rep || ""),
        escapeCsv(data.docs || 0),
        escapeCsv(data.createdAt ? new Date(data.createdAt).toISOString() : ""),
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const fileName = `leads-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    return res.status(200).send(csv);
  } catch (err) {
    console.error("exportLeadsCsv error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to export leads",
    });
  }
};

export const getLeadById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    return res.json({
      success: true,
      data: serializeLead(lead),
    });
  } catch (err) {
    console.error("getLeadById error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch lead",
    });
  }
};

export const createLead = async (req, res) => {
  try {
    const body = req.body || {};

    if (!clean(body.name) || !clean(body.phone)) {
      return res.status(400).json({
        success: false,
        message: "name and phone are required",
      });
    }

    const repInfo = await getRepDetails(body);
    const finalStage = normalizeStage(body.stage);
    const finalStatus = normalizeStatus(body.status, finalStage);
    const bantDetails = normalizeBantDetails(body.bantDetails || {});
    const stageTimestamps = buildStageTimestamps(finalStage, body.stageTimestamps);
    const followups = buildDefaultFollowups(body.followups);

    /* Allow historical lead dates: if caller sends a createdAt / leadDateTime, use it */
    const historicalDate = body.createdAt || body.leadDateTime
      ? new Date(body.createdAt || body.leadDateTime)
      : null;
    const leadTimestamp = historicalDate && !isNaN(historicalDate) ? historicalDate : new Date();

    const lead = new Lead({
      name: clean(body.name),
      phone: clean(body.phone),
      mobile: clean(body.mobile) || clean(body.phone),
      email: clean(body.email).toLowerCase(),
      business: clean(body.business),
      company: clean(body.company) || clean(body.business),
      industry: clean(body.industry),
      location: clean(body.location),
      requirements: clean(body.requirements),

      branch: clean(body.branch) || "Bangalore",
      source: normalizeSource(body.source),
      stage: finalStage,
      status: finalStatus,
      priority: normalizePriority(body.priority),
      value: toNum(body.value, 0),
      dealValue: toNum(body.dealValue, toNum(body.value, 0)),
      days: clean(body.days) || "0d",

      rep: repInfo.repName || "User",
      repName: repInfo.repName || "User",
      repId: repInfo.repId || null,

      bantDetails,
      bant: `${bantDetails.score}/4`,

      stageTimestamps,
      stageTimings: computeStageTimings(stageTimestamps),
      followups,

      history: [
        {
          title: "Lead Created",
          meta: `Stage: ${finalStage}`,
          by: repInfo.repName || "System",
          at: leadTimestamp,
        },
      ],
    });

    /* Stamp createdAt with the historical date before first save */
    lead.createdAt = leadTimestamp;
    normalizeLeadBeforeSave(lead);
    await lead.save();
    clearDashboardCache();
    clearAnalyticsCache();
    clearTodayPlanCache();

    // Fire-and-forget welcome email — does not block the response
    if (lead.email) {
      sendWelcomeEmail({
        name: lead.name,
        email: lead.email,
        business: lead.business,
      }).catch(err => console.error("Welcome email send failed:", err.message));
    }

    return res.status(201).json({
      success: true,
      data: serializeLead(lead),
    });
  } catch (err) {
    console.error("createLead error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create lead",
    });
  }
};

export const updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    if (body.name != null && !clean(body.name)) {
      return res.status(400).json({
        success: false,
        message: "Name cannot be empty",
      });
    }

    if (body.phone != null && !clean(body.phone)) {
      return res.status(400).json({
        success: false,
        message: "Phone cannot be empty",
      });
    }

    const oldStage = lead.stage;
    const repInfo = await getRepDetails(body);

    if (body.name != null) lead.name = clean(body.name);
    if (body.phone != null) {
      lead.phone = clean(body.phone);
      if (!clean(body.mobile)) {
        lead.mobile = clean(body.phone);
      }
    }
    if (body.mobile != null) lead.mobile = clean(body.mobile) || clean(lead.phone);
    if (body.email != null) lead.email = clean(body.email).toLowerCase();
    if (body.business != null) lead.business = clean(body.business);
    if (body.company != null) lead.company = clean(body.company) || clean(body.business) || lead.company;
    if (body.industry != null) lead.industry = clean(body.industry);
    if (body.location != null) lead.location = clean(body.location);
    if (body.requirements != null) lead.requirements = clean(body.requirements);

    if (body.branch != null) lead.branch = clean(body.branch) || "Bangalore";
    if (body.source != null) lead.source = normalizeSource(body.source);
    if (body.stage != null) lead.stage = normalizeStage(body.stage);
    if (body.status != null || body.stage != null) {
      lead.status = normalizeStatus(body.status, lead.stage);
    }
    if (body.priority != null) lead.priority = normalizePriority(body.priority);

    if (body.rep != null || body.repName != null || body.repId != null) {
      lead.rep = repInfo.repName || "";
      lead.repName = repInfo.repName || "";
      lead.repId = repInfo.repId || null;
    }

    if (body.value != null) lead.value = toNum(body.value, lead.value);
    if (body.dealValue != null) {
      lead.dealValue = toNum(body.dealValue, lead.value);
    } else if (body.value != null) {
      lead.dealValue = toNum(body.value, lead.value);
    }

    if (body.advanceReceived != null) lead.advanceReceived = toNum(body.advanceReceived, 0);
    if (body.advanceReceivedDate != null) lead.advanceReceivedDate = body.advanceReceivedDate || null;
    if (body.agreedTimeline != null)  lead.agreedTimeline  = toNum(body.agreedTimeline, 0);
    if (body.onboardedDate != null)   lead.onboardedDate   = body.onboardedDate || null;
    if (body.clientOnboardedDate != null) lead.onboardedDate = body.clientOnboardedDate || null;

    // Auto-calculate finalPaymentDate = advanceReceivedDate + agreedTimeline days
    if (body.finalPaymentDate != null) {
      lead.finalPaymentDate = body.finalPaymentDate || null;
    } else {
      const baseDate = lead.advanceReceivedDate;
      const days     = lead.agreedTimeline;
      if (baseDate && days > 0) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + days);
        lead.finalPaymentDate = d;
      }
    }
    if (body.projectCompleted != null) lead.projectCompleted = Boolean(body.projectCompleted);
    if (body.projectCompletionDate != null) lead.projectCompletionDate = body.projectCompletionDate || null;

    if (body.gstApplicable != null) lead.gstApplicable = Boolean(body.gstApplicable);
    if (body.gstRate != null) lead.gstRate = Number(body.gstRate) || 18;

    if (body.days != null) lead.days = clean(body.days) || lead.days;

    if (body.bantDetails != null) {
      const nextBant = {
        ...(lead.bantDetails?.toObject?.() || lead.bantDetails || {}),
        ...(body.bantDetails || {}),
      };

      lead.bantDetails = normalizeBantDetails(nextBant);
      lead.bant = `${lead.bantDetails.score}/4`;
    }

    if (Array.isArray(body.stageTimestamps)) {
      lead.stageTimestamps = buildStageTimestamps(lead.stage, body.stageTimestamps);
    } else if (body.stage != null && oldStage !== lead.stage) {
      const previous = Array.isArray(lead.stageTimestamps) ? [...lead.stageTimestamps] : [];
      const existingMap = new Map(previous.map((item) => [clean(item.label), item]));
      const rebuilt = buildStageTimestamps(lead.stage, []);

      lead.stageTimestamps = rebuilt.map((item) => {
        const old = existingMap.get(clean(item.label));
        if (old && old.at) {
          return {
            label: item.label,
            done: item.done || old.done,
            at: old.at,
          };
        }

        if (item.label === lead.stage) {
          return {
            label: item.label,
            done: true,
            at: new Date(),
          };
        }

        return item;
      });
    }

    if (Array.isArray(body.followups)) {
      lead.followups = buildDefaultFollowups(body.followups);
    }

    normalizeLeadBeforeSave(lead);

    lead.history.unshift({
      title: oldStage !== lead.stage ? "Stage Updated" : "Lead Updated",
      meta: oldStage !== lead.stage ? `${oldStage} → ${lead.stage}` : "",
      by: clean(body.by) || lead.repName || lead.rep || "System",
      at: new Date(),
    });

    await lead.save();
    clearDashboardCache();
    clearAnalyticsCache();
    clearTodayPlanCache();

    return res.json({
      success: true,
      data: serializeLead(lead),
    });
  } catch (err) {
    console.error("updateLead error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update lead",
    });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    await Lead.deleteOne({ _id: id });

    return res.json({
      success: true,
      message: "Lead deleted successfully",
    });
  } catch (err) {
    console.error("deleteLead error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to delete lead",
    });
  }
};

export const addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, by } = req.body || {};

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    if (!clean(text)) {
      return res.status(400).json({
        success: false,
        message: "text required",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    normalizeLeadBeforeSave(lead);

    lead.notes.unshift({
      text: clean(text),
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    lead.history.unshift({
      title: "Note Added",
      meta: clean(text).slice(0, 80),
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({
      success: true,
      data: lead.notes,
    });
  } catch (err) {
    console.error("addNote error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save note",
    });
  }
};

export const markFollowupDone = async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, notes, by } = req.body || {};

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid lead id" });
    }

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    normalizeLeadBeforeSave(lead);

    // Mark all pending/overdue followups as done
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    let markedCount = 0;
    for (const fu of lead.followups || []) {
      if (!fu.done && fu.dueDate && new Date(fu.dueDate) <= today) {
        fu.done = true;
        fu.status = "Completed";
        markedCount++;
      }
    }

    // Log note
    const noteText = `Call Log [${clean(outcome) || "Completed"}]${clean(notes) ? ": " + clean(notes) : ""}`;
    lead.notes.unshift({ text: noteText, by: clean(by) || lead.repName || lead.rep || "User", at: new Date() });
    lead.history.unshift({
      title: "Follow-up Completed",
      meta: noteText.slice(0, 80),
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({ success: true, message: `${markedCount} follow-up(s) marked done`, data: lead.followups });
  } catch (err) {
    console.error("markFollowupDone error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed" });
  }
};

export const addComm = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, summary, by, durationMin } = req.body || {};

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    if (!clean(summary)) {
      return res.status(400).json({
        success: false,
        message: "summary required",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    normalizeLeadBeforeSave(lead);

    lead.commLogs.unshift({
      type: clean(type) || "Communication",
      summary: clean(summary),
      durationMin: toNum(durationMin, 0),
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    lead.history.unshift({
      title: clean(type) || "Communication Logged",
      meta: clean(summary).slice(0, 80),
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({
      success: true,
      data: lead.commLogs,
    });
  } catch (err) {
    console.error("addComm error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save communication log",
    });
  }
};

export const addFollowup = async (req, res) => {
  try {
    const { id } = req.params;
    const { dayIndex, title, channel, status, dueDate, done, by } = req.body || {};

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    if (!clean(title)) {
      return res.status(400).json({
        success: false,
        message: "title required",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    normalizeLeadBeforeSave(lead);

    const nextFollowup = {
      dayIndex: toNum(dayIndex, (lead.followups?.length || 0) + 1),
      title: clean(title),
      channel: clean(channel) || "Call",
      status: clean(status) || "Pending",
      done: Boolean(done),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    };

    lead.followups.unshift(nextFollowup);

    lead.history.unshift({
      title: "Follow-up Added",
      meta: `${nextFollowup.title} • ${nextFollowup.channel} • ${nextFollowup.status}`,
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();
    await syncTodayPlanTaskFromFollowup(lead, nextFollowup);

    return res.json({
      success: true,
      message: "Follow-up added and synced to Today's Plan",
      data: lead.followups,
    });
  } catch (err) {
    console.error("addFollowup error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to add follow-up",
    });
  }
};

export const uploadDoc = async (req, res) => {
  try {
    const { id } = req.params;
    const { tag, by, name, notes, documentDate } = req.body || {};
    const file = req.file;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "file required",
      });
    }

    const lead = await Lead.findById(id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    normalizeLeadBeforeSave(lead);

    const fileUrl = `/uploads/leads/${file.filename}`;
    const mimeType = file.mimetype || "";

    lead.documents.unshift({
      tag: clean(tag) || "Invoice",
      originalName: file.originalname || "",
      name: clean(name) || file.originalname || "",
      notes: clean(notes),
      url: fileUrl,
      fileUrl,
      fileName: file.filename || "",
      mimeType,
      size: file.size || 0,
      uploadedAt: new Date(),
      documentDate: clean(documentDate),
      by: clean(by) || lead.repName || lead.rep || "User",
    });

    lead.history.unshift({
      title: "Document Uploaded",
      meta: clean(tag) || "Document",
      by: clean(by) || lead.repName || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    // Map drawer tag → Document model enum value
    const tagToType = { invoice:"invoice", quotation:"quotation", mom:"mom", client_input:"client_input", contract:"other", proposal:"quotation", receipt:"invoice" };
    const rawTag    = (clean(tag) || "invoice").toLowerCase().replace(/\s+/g, "_");
    const docType   = tagToType[rawTag] || "other";

    // Also save to the global Documents collection so it appears in the Documents page
    Document.create({
      type:             docType,
      linkedLead:       lead.name || lead.business || String(lead._id),
      leadId:           lead._id,
      date:             clean(documentDate) ? new Date(clean(documentDate)) : new Date(),
      name:             clean(name) || file.originalname || "",
      notes:            clean(notes) || "",
      originalFileName: file.originalname || "",
      storedFileName:   file.filename || "",
      fileUrl:          fileUrl,
      fileSize:         file.size || 0,
      mimeType:         mimeType,
    }).catch(e => console.error("syncDoc to Documents collection failed:", e.message));

    return res.json({
      success: true,
      data: lead.documents.map((doc) => ({
        ...doc,
        fileName: doc?.fileName || doc?.originalName || "",
        fileUrl: doc?.fileUrl || doc?.url || "",
        url: doc?.url || doc?.fileUrl || "",
      })),
    });
  } catch (err) {
    console.error("uploadDoc error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to upload document",
    });
  }
};

// DELETE /api/leads/:id/docs/:docId
export const deleteDoc = async (req, res) => {
  try {
    const { id, docId } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid lead id" });

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    // Support index-based delete (route: /docs/index/:idx)
    let docIndex = -1;
    const { idx } = req.params;
    if (idx !== undefined) {
      docIndex = parseInt(idx, 10);
      if (isNaN(docIndex) || docIndex < 0 || docIndex >= lead.documents.length) {
        return res.status(404).json({ success: false, message: "Document index out of range" });
      }
    } else {
      docIndex = lead.documents.findIndex((d) =>
        String(d._id)          === docId ||
        String(d.fileName)     === docId ||
        String(d.originalName) === docId ||
        String(d.name)         === docId
      );
    }
    if (docIndex === -1) return res.status(404).json({ success: false, message: "Document not found" });

    const doc = lead.documents[docIndex];

    // Delete physical file if it exists
    if (doc.fileName || doc.url) {
      const fileName = doc.fileName || (doc.url || "").split("/").pop();
      if (fileName) {
        const filePath = path.join(process.cwd(), "uploads", "leads", fileName);
        fs.promises.unlink(filePath).catch(() => {}); // ignore if already missing
      }
    }

    const removedDoc = lead.documents[docIndex];
    lead.documents.splice(docIndex, 1);
    await lead.save();

    // Also remove from the global Documents collection
    const storedName = removedDoc.fileName || (removedDoc.url || "").split("/").pop() || "";
    if (storedName) {
      Document.deleteOne({ leadId: lead._id, storedFileName: storedName }).catch(() => {});
      Document.deleteOne({ leadId: lead._id, fileUrl: removedDoc.url || removedDoc.fileUrl }).catch(() => {});
    }

    return res.json({ success: true, data: lead.documents });
  } catch (err) {
    console.error("deleteDoc error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to delete document" });
  }
};

export const getPipelineData = async (req, res) => {
  try {
    // Exclude heavy nested arrays (history, commLogs, momLogs, emailLogs, notes)
    // Pipeline only needs display fields + documents count
    const leads = await Lead.find({})
      .sort({ createdAt: -1 })
      .select("name phone business requirements source priority value branch repName rep bant documents stage createdAt")
      .lean();

    const grouped = {
      "Lead Capture": [],
      Reachable: [],
      Qualified: [],
      Proposal: [],
      Negotiation: [],
      Closed: [],
      "Closed Won": [],
    };

    for (const item of leads) {
      try {
        const obj = serializeLead(item);
        const stage = normalizeStage(obj.stage);

        const mappedLead = {
          id: obj._id,
          name: obj.name || "-",
          phone: obj.phone || "-",
          business: obj.business || "-",
          requirements: obj.requirements || "-",
          source: obj.source || "-",
          priority: obj.priority || "-",
          value: Number(obj.value || 0),
          branch: obj.branch || "-",
          rep: obj.repName || obj.rep || "-",
          bant: obj.bant || "0/4",
          docs: Array.isArray(obj.documents) ? obj.documents.length : 0,
          stage,
          createdAt: obj.createdAt,
        };

        if (!grouped[stage]) {
          grouped[stage] = [];
        }

        grouped[stage].push(mappedLead);
      } catch (error) {
        console.error("getPipelineData item error:", error);
      }
    }

    return res.json({
      success: true,
      data: grouped,
    });
  } catch (error) {
    console.error("getPipelineData error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch pipeline data",
    });
  }
};

export const getLeadCalendarData = async (req, res) => {
  try {
    const now = new Date();

    const year = Number(req.query.year || now.getFullYear());
    const month = Number(req.query.month || now.getMonth() + 1);

    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid year or month",
      });
    }

    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(year, month, 1, 0, 0, 0, 0);

    const monthLeads = await Lead.find({
      createdAt: {
        $gte: startDate,
        $lt: endDate,
      },
    }).sort({ createdAt: 1 });

    const dayMap = {};

    for (const lead of monthLeads) {
      try {
        const leadDate = new Date(lead.createdAt);
        const day = leadDate.getDate();

        if (!dayMap[day]) {
          dayMap[day] = {
            count: 0,
            totalValue: 0,
            leads: [],
          };
        }

        dayMap[day].count += 1;
        dayMap[day].totalValue += Number(lead.value || 0);

        dayMap[day].leads.push({
          id: lead._id,
          name: lead.name || "-",
          phone: lead.phone || "-",
          business: lead.business || "-",
          requirements: lead.requirements || "-",
          branch: lead.branch || "-",
          stage: normalizeStage(lead.stage),
          priority: normalizePriority(lead.priority),
          rep: lead.repName || lead.rep || "-",
          source: lead.source || "-",
          value: Number(lead.value || 0),
          createdAt: lead.createdAt,
        });
      } catch (error) {
        console.error("day map item error:", error);
      }
    }

    const upcomingStart = new Date();
    upcomingStart.setHours(0, 0, 0, 0);

    const upcomingEnd = new Date();
    upcomingEnd.setDate(upcomingEnd.getDate() + 15);
    upcomingEnd.setHours(23, 59, 59, 999);

    const upcomingLeads = await Lead.find({
      createdAt: {
        $gte: upcomingStart,
        $lte: upcomingEnd,
      },
    })
      .sort({ createdAt: 1 })
      .limit(10);

    const overdueLeads = await Lead.find({
      createdAt: {
        $lt: upcomingStart,
      },
      stage: { $nin: ["Closed", "Closed Won"] },
    })
      .sort({ createdAt: -1 })
      .limit(10);

    return res.json({
      success: true,
      data: {
        year,
        month,
        monthName: new Date(year, month - 1, 1).toLocaleString("en-US", {
          month: "long",
        }),
        calendar: dayMap,
        upcoming: upcomingLeads.map((lead) => ({
          id: lead._id,
          name: lead.name || "-",
          business: lead.business || "-",
          requirements: lead.requirements || "-",
          rep: lead.repName || lead.rep || "-",
          stage: normalizeStage(lead.stage),
          priority: normalizePriority(lead.priority),
          createdAt: lead.createdAt,
          value: Number(lead.value || 0),
        })),
        overdue: overdueLeads.map((lead) => ({
          id: lead._id,
          name: lead.name || "-",
          business: lead.business || "-",
          requirements: lead.requirements || "-",
          rep: lead.repName || lead.rep || "-",
          stage: normalizeStage(lead.stage),
          priority: normalizePriority(lead.priority),
          createdAt: lead.createdAt,
          value: Number(lead.value || 0),
        })),
      },
    });
  } catch (err) {
    console.error("getLeadCalendarData error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch calendar data",
    });
  }
};

export const getTodayPlanData = async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Targeted queries instead of full collection scan:
    // 1. Leads in actionable stages (Lead Capture, Proposal, Negotiation, Closed, Closed Won)
    // 2. Leads with pending/overdue followups
    const [stageLeads, followupLeads] = await Promise.all([
      Lead.find({ stage: { $in: ["Lead Capture", "Proposal", "Negotiation", "Closed", "Closed Won"] } })
        .sort({ createdAt: -1 })
        .limit(300)
        .select("name phone email business requirements branch repName rep source stage priority value createdAt")
        .lean(),
      Lead.find({
        followups: {
          $elemMatch: {
            done: { $ne: true },
            $or: [
              { status: { $in: ["Pending", "Due", "Overdue"] } },
              { dueDate: { $lte: new Date(todayStart.getTime() + 86_400_000) } },
            ],
          },
        },
      })
        .sort({ createdAt: -1 })
        .limit(300)
        .select("name phone email business requirements branch repName rep source stage priority value followups createdAt")
        .lean(),
    ]);

    // Merge unique leads (followup leads may overlap with stage leads)
    const seenIds = new Set();
    const leads = [];
    for (const lead of [...stageLeads, ...followupLeads]) {
      const id = String(lead._id);
      if (!seenIds.has(id)) { seenIds.add(id); leads.push(lead); }
    }

    const isToday = (date) => {
      try {
        if (!date) return false;
        const d = new Date(date);
        return (
          d.getDate() === now.getDate() &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      } catch (error) {
        console.error("isToday error:", error);
        return false;
      }
    };

    const isOverdue = (date) => {
      try {
        if (!date) return false;
        return new Date(date).getTime() < now.getTime();
      } catch (error) {
        console.error("isOverdue error:", error);
        return false;
      }
    };

    const tasks = [];

    for (const lead of leads) {
      const data = serializeLead(lead);

      if (data.stage === "Lead Capture") {
        tasks.push({
          id: `new-${data._id}`,
          leadId: data._id,
          type: "new_call",
          clientName: data.name || "-",
          phone: data.phone || "",
          title: "New lead — call within 5 minutes of enquiry",
          branch: data.branch || "-",
          rep: data.repName || data.rep || "-",
          source: data.source || "-",
          stage: data.stage || "-",
          value: Number(data.value || 0),
          priority: "urgent",
          overdue: true,
          timeLabel: "ASAP",
          note: `Source: ${data.source || "-"} · ${data.business || data.industry || "New enquiry"}`,
          done: false,
        });
      }

      if (["Proposal", "Negotiation"].includes(data.stage) && Number(data.value || 0) > 0) {
        tasks.push({
          id: `payment-${data._id}`,
          leadId: data._id,
          type: "payment",
          clientName: data.name || "-",
          phone: data.phone || "",
          title: `Follow up on payment for ₹${Number(data.value || 0).toLocaleString("en-IN")}`,
          branch: data.branch || "-",
          rep: data.repName || data.rep || "-",
          source: data.source || "-",
          stage: data.stage || "-",
          value: Number(data.value || 0),
          priority: data.priority === "Hot" ? "urgent" : "high",
          overdue: true,
          timeLabel: "11:00 AM",
          note: `${data.stage} · Payment pending`,
          done: false,
        });
      }

      if (data.stage === "Proposal") {
        tasks.push({
          id: `proposal-${data._id}`,
          leadId: data._id,
          type: "proposal",
          clientName: data.name || "-",
          phone: data.phone || "",
          title: "Check if the client reviewed the proposal",
          branch: data.branch || "-",
          rep: data.repName || data.rep || "-",
          source: data.source || "-",
          stage: data.stage || "-",
          value: Number(data.value || 0),
          priority: "medium",
          overdue: false,
          timeLabel: "3:00 PM",
          note: "Proposal follow-up",
          done: false,
        });
      }

      if (["Closed", "Closed Won"].includes(data.stage)) {
        tasks.push({
          id: `onboarding-${data._id}`,
          leadId: data._id,
          type: "onboarding",
          clientName: data.name || "-",
          phone: data.phone || "",
          title: "Onboarding check-in and project kickoff details",
          branch: data.branch || "-",
          rep: data.repName || data.rep || "-",
          source: data.source || "-",
          stage: data.stage || "-",
          value: Number(data.value || 0),
          priority: "medium",
          overdue: false,
          timeLabel: "4:00 PM",
          note: `Project value ₹${Number(data.value || 0).toLocaleString("en-IN")}`,
          done: false,
        });
      }

      for (const fu of data.followups || []) {
        const shouldInclude =
          !fu.done &&
          (clean(fu.status) === "Pending" ||
            clean(fu.status) === "Due" ||
            clean(fu.status) === "Overdue" ||
            isToday(fu.dueDate) ||
            isOverdue(fu.dueDate));

        if (shouldInclude) {
          tasks.push({
            id: `followup-${data._id}-${fu.dayIndex || Math.random()}`,
            leadId: data._id,
            type: "followup",
            clientName: data.name || "-",
            phone: data.phone || "",
            title: fu.title || "Lead follow-up",
            branch: data.branch || "-",
            rep: data.repName || data.rep || "-",
            source: data.source || "-",
            stage: data.stage || "-",
            value: Number(data.value || 0),
            priority: isOverdue(fu.dueDate) || clean(fu.status) === "Overdue" ? "urgent" : "high",
            overdue: isOverdue(fu.dueDate) || clean(fu.status) === "Overdue",
            timeLabel: fu.dueDate
              ? new Date(fu.dueDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "ASAP",
            note: `${fu.channel || "Call"} · ${fu.status || "Pending"}`,
            done: Boolean(fu.done),
          });
        }
      }
    }

    const stats = {
      total: tasks.length,
      done: tasks.filter((x) => x.done).length,
      progress: tasks.length ? Math.round((tasks.filter((x) => x.done).length / tasks.length) * 100) : 0,
      urgentCount: tasks.filter((item) => item.priority === "urgent" || item.overdue).length,
      counts: {
        newCalls: tasks.filter((item) => item.type === "new_call").length,
        followUps: tasks.filter((item) => item.type === "followup").length,
        payments: tasks.filter((item) => item.type === "payment").length,
        proposals: tasks.filter((item) => item.type === "proposal").length,
        meetings: 0,
        onboarding: tasks.filter((item) => item.type === "onboarding").length,
      },
    };

    const schedule = tasks
      .map((item) => ({
        id: item.id,
        timeLabel: item.timeLabel || "ASAP",
        clientName: item.clientName,
        title: item.title,
        phone: item.phone,
        leadId: item.leadId,
      }))
      .sort((a, b) => String(a.timeLabel).localeCompare(String(b.timeLabel)));

    return res.json({
      success: true,
      data: {
        dateLabel: new Date().toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        stats,
        tasks,
        schedule,
      },
    });
  } catch (error) {
    console.error("getTodayPlanData error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch today plan data",
    });
  }
};

/* ─────────────────────────────────────────────────────────── */
/*  Send automated email to lead's client                     */
/*  POST /api/leads/:id/send-email                            */
/*  body: { type, demoLink, meetingDate, attendees,           */
/*          summary, actionItems, followupNumber }            */
/* ─────────────────────────────────────────────────────────── */
export const sendLeadEmail = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const { type, demoLink, meetingDate, attendees, summary, actionItems, followupNumber } = req.body;
    if (!type) return res.status(400).json({ success: false, message: "Email type is required" });
    if (!lead.email) return res.status(400).json({ success: false, message: "Lead has no email address" });

    const payload = {
      name: lead.name,
      email: lead.email,
      business: lead.business || lead.company,
      repName: lead.repName || lead.rep,
    };

    if (type === "initiation") {
      if (!lead.projectStartDate) {
        lead.projectStartDate = new Date();
      }
      await sendProjectInitiationEmail({
        ...payload,
        startDate: lead.projectStartDate,
        timeline: lead.agreedTimeline,
      });
      lead.emailLogs.push({ type: "initiation", sentTo: lead.email, subject: "Project Initiation", body: `Project initiation email sent. Start date: ${lead.projectStartDate ? new Date(lead.projectStartDate).toLocaleDateString("en-IN") : "TBD"}. Timeline: ${lead.agreedTimeline || "TBD"} days.`, sentAt: new Date() });

    } else if (type === "completion") {
      if (!lead.projectCompleted) {
        lead.projectCompleted = true;
        lead.projectCompletionDate = lead.projectCompletionDate || new Date();
      }
      await sendProjectCompletionEmail({
        ...payload,
        completionDate: lead.projectCompletionDate,
        demoLink,
      });
      lead.emailLogs.push({ type: "completion", sentTo: lead.email, subject: "Project Completion", body: `Project completion email sent. Demo link: ${demoLink || "Not provided"}.`, sentAt: new Date() });

    } else if (type === "mom") {
      await sendMOMEmail({
        ...payload,
        meetingDate: meetingDate || new Date(),
        attendees,
        summary,
        actionItems,
      });
      lead.emailLogs.push({ type: "mom", sentTo: lead.email, subject: `MOM - ${meetingDate || "Today"}`, body: `Meeting minutes for ${meetingDate || "today"} shared with ${attendees || "attendees"}. Summary: ${String(summary || "").slice(0, 150)}`, sentAt: new Date() });

    } else if (type === "followup") {
      const num = Number(followupNumber) || 1;
      await sendFollowupEmail({
        ...payload,
        followupNumber: num,
        completionDate: lead.projectCompletionDate,
      });
      lead.emailLogs.push({ type: `followup_${num}`, sentTo: lead.email, subject: `Follow-up ${num}/3`, body: `Follow-up ${num}/3 email sent to check satisfaction and gather feedback.`, sentAt: new Date() });

    } else if (type === "custom") {
      const { subject, body } = req.body;
      if (!subject || !body) return res.status(400).json({ success: false, message: "Subject and body are required for custom email" });
      await sendCustomEmail({
        name: lead.name,
        email: lead.email,
        subject,
        body,
      });
      lead.emailLogs.push({ type: "custom", sentTo: lead.email, subject, body: String(body).slice(0, 300), sentAt: new Date() });

    } else if (type === "payment_reminder") {
      const { amountDue, dueDate, invoiceNumber, stage } = req.body;
      if (!amountDue) return res.status(400).json({ success: false, message: "amountDue is required" });
      await sendPaymentReminderEmail({
        name: lead.name,
        email: lead.email,
        business: lead.business || lead.company,
        amountDue,
        dueDate,
        invoiceNumber,
        stage: stage || 1,
      });
      lead.emailLogs.push({ type: `payment_reminder_${stage || 1}`, sentTo: lead.email, subject: `Payment Reminder Stage ${stage || 1}`, body: `Payment reminder (Stage ${stage || 1}) sent. Amount due: ₹${amountDue}. Due date: ${dueDate || "ASAP"}. Invoice: ${invoiceNumber || "N/A"}.`, sentAt: new Date() });

    } else if (type === "payment_receipt") {
      const { receiptNumber, invoiceNumber, amountPaid, remainingAmount, paymentDate, services } = req.body;
      if (!amountPaid) return res.status(400).json({ success: false, message: "amountPaid is required" });
      await sendPaymentReceiptEmail({
        name: lead.name,
        email: lead.email,
        business: lead.business || lead.company,
        receiptNumber,
        invoiceNumber,
        amountPaid,
        remainingAmount: remainingAmount || 0,
        paymentDate: paymentDate || new Date(),
        services,
      });
      lead.emailLogs.push({ type: "payment_receipt", sentTo: lead.email, subject: `Payment Receipt #${receiptNumber || ""}`, body: `Payment receipt sent. Amount paid: ₹${amountPaid}. Remaining: ₹${remainingAmount || 0}. Receipt #${receiptNumber || "N/A"}.`, sentAt: new Date() });

    } else if (type === "document_request") {
      const { serviceType } = req.body;
      await sendDocumentRequestEmail({
        name: lead.name,
        email: lead.email,
        business: lead.business || lead.company,
        serviceType: serviceType || "website",
      });
      lead.emailLogs.push({ type: "document_request", sentTo: lead.email, subject: "Document Request", body: `Document request email sent for ${serviceType || "website"} project. Checklist of required files shared.`, sentAt: new Date() });

    } else {
      return res.status(400).json({ success: false, message: "Invalid email type" });
    }

    await lead.save();
    return res.status(200).json({ success: true, message: "Email sent successfully" });
  } catch (err) {
    console.error("sendLeadEmail error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to send email" });
  }
};

/* ─────────────────────────────────────────────────────────── */
/*  Add MOM and optionally email to client                    */
/*  POST /api/leads/:id/mom                                   */
/*  body: { title, summary, attendees, date, sendEmail }      */
/* ─────────────────────────────────────────────────────────── */
export const addMOM = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const { title, summary, attendees, date, actionItems, sendEmail: doSend } = req.body;
    if (!summary) return res.status(400).json({ success: false, message: "Summary is required" });

    const mom = {
      title: title || "Meeting Notes",
      summary,
      attendees: attendees || "",
      date: date ? new Date(date) : new Date(),
      by: lead.repName || "User",
      at: new Date(),
    };
    lead.momLogs.push(mom);

    if (doSend && lead.email) {
      sendMOMEmail({
        name: lead.name,
        email: lead.email,
        business: lead.business || lead.company,
        meetingDate: mom.date,
        attendees: mom.attendees,
        summary: mom.summary,
        actionItems: actionItems || [],
        repName: lead.repName || lead.rep,
      }).catch(err => console.error("MOM email send failed:", err.message));
      lead.emailLogs.push({ type: "mom", sentTo: lead.email, subject: `MOM - ${mom.date.toLocaleDateString("en-IN")}`, body: `Meeting minutes for ${mom.date.toLocaleDateString("en-IN")} shared. Attendees: ${mom.attendees || "N/A"}. Summary: ${String(mom.summary || "").slice(0, 150)}`, sentAt: new Date() });
    }

    lead.history.push({ title: "Meeting MOM added", meta: title || "Meeting Notes", by: lead.repName || "User", at: new Date() });
    await lead.save();

    return res.status(200).json({ success: true, message: "MOM added", data: mom });
  } catch (err) {
    console.error("addMOM error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to add MOM" });
  }
};

/* ─────────────────────────────────────────────────────────── */
/*  Update approval status                                     */
/*  PATCH /api/leads/:id/approval                             */
/*  body: { approvalStatus }                                  */
/* ─────────────────────────────────────────────────────────── */
export const updateApprovalStatus = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const { approvalStatus } = req.body;
    if (!approvalStatus) return res.status(400).json({ success: false, message: "approvalStatus required" });

    lead.approvalStatus = approvalStatus;
    lead.history.push({ title: `Approval status → ${approvalStatus}`, by: "User", at: new Date() });
    await lead.save();

    return res.status(200).json({ success: true, message: "Approval status updated" });
  } catch (err) {
    console.error("updateApprovalStatus error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to update approval status" });
  }
};

/* ─────────────────────────────────────────────────────────── */
/*  Add / update client response on an email log entry         */
/*  PATCH /api/leads/:id/email-logs/:logId/response           */
/*  body: { response }                                        */
/* ─────────────────────────────────────────────────────────── */
export const addEmailLogResponse = async (req, res) => {
  try {
    const { id, logId } = req.params;
    const { response } = req.body;

    if (!response?.trim()) {
      return res.status(400).json({ success: false, message: "Response text is required" });
    }

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const log = lead.emailLogs.id(logId);
    if (!log) return res.status(404).json({ success: false, message: "Email log entry not found" });

    log.response    = response.trim();
    log.respondedAt = new Date();

    await lead.save();

    return res.json({ success: true, message: "Response saved", data: lead.emailLogs });
  } catch (err) {
    console.error("addEmailLogResponse error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to save response" });
  }
};
import Lead from "../models/Lead.js";

const STAGES = ["Lead Capture", "Reachable", "Qualified", "Proposal", "Closed"];

const clean = (v) => {
  try {
    if (v == null) return "";
    if (typeof v === "object") {
      if (typeof v.text === "string") return v.text.trim();
      return "";
    }
    return String(v).trim();
  } catch {
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
  } catch {
    return def;
  }
};

const normalizeBantDetails = (input = {}) => {
  try {
    const cleanText = (v) => {
      if (v == null) return "";
      if (typeof v === "object") return String(v.text || "").trim();
      return String(v).trim();
    };

    const toNumber = (v, def = 0) => {
      if (v == null || v === "") return def;
      if (typeof v === "string" && v.includes("/")) {
        const first = Number(v.split("/")[0]);
        return Number.isFinite(first) ? first : def;
      }
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
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
      return existing;
    }

    const currentIndex = STAGES.indexOf(currentStage);

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
      return existing;
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

const normalizeLeadBeforeSave = (lead) => {
  try {
    if (!lead) return lead;

    lead.name = clean(lead.name);
    lead.phone = clean(lead.phone);
    lead.email = clean(lead.email);
    lead.business = clean(lead.business);
    lead.industry = clean(lead.industry);
    lead.location = clean(lead.location);
    lead.branch = clean(lead.branch);
    lead.source = clean(lead.source);
    lead.stage = clean(lead.stage) || "Lead Capture";
    lead.priority = clean(lead.priority);
    lead.rep = clean(lead.rep);
    lead.days = clean(lead.days);
    lead.value = toNum(lead.value, 0);

    lead.bantDetails = normalizeBantDetails(lead.bantDetails || {});
    lead.bant = `${lead.bantDetails.score}/4`;

    if (!Array.isArray(lead.notes)) lead.notes = [];
    if (!Array.isArray(lead.commLogs)) lead.commLogs = [];
    if (!Array.isArray(lead.history)) lead.history = [];
    if (!Array.isArray(lead.documents)) lead.documents = [];
    if (!Array.isArray(lead.followups)) lead.followups = [];
    if (!Array.isArray(lead.stageTimestamps)) lead.stageTimestamps = [];

    return lead;
  } catch (error) {
    console.error("normalizeLeadBeforeSave error:", error);
    return lead;
  }
};

export const getLeads = async (req, res) => {
  try {
    const { branch, stage, priority, source, bant, rep, q } = req.query;

    const filter = {};

    if (branch && branch !== "All") filter.branch = clean(branch);
    if (stage && stage !== "All") filter.stage = clean(stage);
    if (priority && priority !== "All") filter.priority = clean(priority);
    if (source && source !== "All") filter.source = clean(source);
    if (bant && bant !== "All") filter.bant = clean(bant);
    if (rep && rep !== "All") filter.rep = clean(rep);

    if (q && clean(q)) {
      const regex = new RegExp(clean(q), "i");
      filter.$or = [
        { name: regex },
        { phone: regex },
        { business: regex },
        { email: regex },
      ];
    }

    const leads = await Lead.find(filter).sort({ createdAt: -1 });

    const data = leads.map((x) => {
      const obj = x.toObject();
      obj.docs = Array.isArray(obj.documents) ? obj.documents.length : 0;
      return obj;
    });

    return res.json({
      success: true,
      count: data.length,
      total: data.reduce((s, x) => s + (Number(x.value) || 0), 0),
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch leads",
    });
  }
};

export const getLeadById = async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const obj = lead.toObject();
    obj.docs = Array.isArray(obj.documents) ? obj.documents.length : 0;

    return res.json({ success: true, data: obj });
  } catch (err) {
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

    const finalStage = clean(body.stage) || "Lead Capture";
    const bantDetails = normalizeBantDetails(body.bantDetails || {});
    const stageTimestamps = buildStageTimestamps(finalStage, body.stageTimestamps);
    const followups = buildDefaultFollowups(body.followups);

    const lead = await Lead.create({
      name: clean(body.name),
      phone: clean(body.phone),
      email: clean(body.email),
      business: clean(body.business),
      industry: clean(body.industry),
      location: clean(body.location),

      branch: clean(body.branch) || "Bangalore",
      source: clean(body.source) || "WhatsApp",
      stage: finalStage,
      priority: clean(body.priority) || "Hot",
      value: toNum(body.value, 0),
      days: clean(body.days) || "0d",
      rep: clean(body.rep) || "User",

      bantDetails,
      bant: `${bantDetails.score}/4`,

      stageTimestamps,
      followups,

      history: [
        {
          title: "Lead Created",
          meta: `Stage: ${finalStage}`,
          by: clean(body.rep) || "System",
          at: new Date(),
        },
      ],
    });

    const obj = lead.toObject();
    obj.docs = Array.isArray(obj.documents) ? obj.documents.length : 0;

    return res.status(201).json({ success: true, data: obj });
  } catch (err) {
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

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    const oldStage = lead.stage;

    if (body.name != null) lead.name = clean(body.name);
    if (body.phone != null) lead.phone = clean(body.phone);
    if (body.email != null) lead.email = clean(body.email);
    if (body.business != null) lead.business = clean(body.business);
    if (body.industry != null) lead.industry = clean(body.industry);
    if (body.location != null) lead.location = clean(body.location);

    if (body.branch != null) lead.branch = clean(body.branch) || "Bangalore";
    if (body.source != null) lead.source = clean(body.source) || "Referral";
    if (body.stage != null) lead.stage = clean(body.stage) || "Lead Capture";
    if (body.priority != null) lead.priority = clean(body.priority) || "Hot";
    if (body.rep != null) lead.rep = clean(body.rep);

    if (body.value != null) lead.value = toNum(body.value, lead.value);
    if (body.days != null) lead.days = clean(body.days) || lead.days;

    if (body.bantDetails != null) {
      const next = {
        ...(lead.bantDetails?.toObject?.() || lead.bantDetails || {}),
        ...(body.bantDetails || {}),
      };
      lead.bantDetails = normalizeBantDetails(next);
      lead.bant = `${lead.bantDetails.score}/4`;
    }

    if (Array.isArray(body.stageTimestamps)) {
      lead.stageTimestamps = body.stageTimestamps;
    } else if (body.stage != null && oldStage !== lead.stage) {
      lead.stageTimestamps = buildStageTimestamps(lead.stage, []);
    }

    if (Array.isArray(body.followups)) {
      lead.followups = body.followups;
    }

    normalizeLeadBeforeSave(lead);

    lead.history.unshift({
      title: oldStage !== lead.stage ? "Stage Updated" : "Lead Updated",
      meta: oldStage !== lead.stage ? `${oldStage} → ${lead.stage}` : "",
      by: clean(body.by) || lead.rep || "System",
      at: new Date(),
    });

    await lead.save();

    const obj = lead.toObject();
    obj.docs = Array.isArray(obj.documents) ? obj.documents.length : 0;

    return res.json({ success: true, data: obj });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update lead",
    });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    await Lead.deleteOne({ _id: id });
    return res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
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

    if (!clean(text)) {
      return res.status(400).json({ success: false, message: "text required" });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    normalizeLeadBeforeSave(lead);

    lead.notes.unshift({
      text: clean(text),
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    });

    lead.history.unshift({
      title: "Note Added",
      meta: clean(text).slice(0, 80),
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({ success: true, data: lead.notes });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save note",
    });
  }
};

export const addComm = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, summary, by, durationMin } = req.body || {};

    if (!clean(summary)) {
      return res.status(400).json({ success: false, message: "summary required" });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    normalizeLeadBeforeSave(lead);

    lead.commLogs.unshift({
      type: clean(type) || "Communication",
      summary: clean(summary),
      durationMin: toNum(durationMin, 0),
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    });

    lead.history.unshift({
      title: clean(type) || "Communication Logged",
      meta: clean(summary).slice(0, 80),
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({ success: true, data: lead.commLogs });
  } catch (err) {
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
      dueDate: dueDate ? new Date(dueDate) : null,
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    };

    lead.followups.unshift(nextFollowup);

    lead.history.unshift({
      title: "Follow-up Added",
      meta: `${nextFollowup.title} • ${nextFollowup.channel} • ${nextFollowup.status}`,
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({
      success: true,
      data: lead.followups,
    });
  } catch (err) {
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

    if (!file) {
      return res.status(400).json({ success: false, message: "file required" });
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found" });
    }

    normalizeLeadBeforeSave(lead);

    const url = `/uploads/leads/${file.filename}`;

    lead.documents.unshift({
      tag: clean(tag) || "Invoice",
      originalName: file.originalname || "",
      name: clean(name) || file.originalname || "",
      notes: clean(notes),
      url,
      size: file.size || 0,
      uploadedAt: new Date(),
      documentDate: clean(documentDate),
      by: clean(by) || lead.rep || "User",
    });

    lead.history.unshift({
      title: "Document Uploaded",
      meta: clean(tag) || "Document",
      by: clean(by) || lead.rep || "User",
      at: new Date(),
    });

    await lead.save();

    return res.json({ success: true, data: lead.documents });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to upload document",
    });
  }
};

export const getPipelineData = async (req, res) => {
  try {
    const leads = await Lead.find({}).sort({ createdAt: -1 });

    const grouped = {
      "Lead Capture": [],
      Reachable: [],
      Qualified: [],
      Proposal: [],
      Closed: [],
    };

    for (const item of leads) {
      const obj = item.toObject();

      const mappedLead = {
        id: obj._id,
        name: obj.name || "-",
        phone: obj.phone || "-",
        business: obj.business || "-",
        source: obj.source || "-",
        priority: obj.priority || "-",
        value: Number(obj.value || 0),
        branch: obj.branch || "-",
        rep: obj.rep || "-",
        bant: obj.bant || "0/4",
        docs: Array.isArray(obj.documents) ? obj.documents.length : 0,
        stage: obj.stage || "Lead Capture",
        createdAt: obj.createdAt,
      };

      if (!grouped[mappedLead.stage]) {
        grouped[mappedLead.stage] = [];
      }

      grouped[mappedLead.stage].push(mappedLead);
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
          branch: lead.branch || "-",
          stage: lead.stage || "Lead Capture",
          priority: lead.priority || "Hot",
          rep: lead.rep || "-",
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
      stage: { $ne: "Closed" },
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
          rep: lead.rep || "-",
          stage: lead.stage || "Lead Capture",
          priority: lead.priority || "Hot",
          createdAt: lead.createdAt,
          value: Number(lead.value || 0),
        })),
        overdue: overdueLeads.map((lead) => ({
          id: lead._id,
          name: lead.name || "-",
          business: lead.business || "-",
          rep: lead.rep || "-",
          stage: lead.stage || "Lead Capture",
          priority: lead.priority || "Hot",
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
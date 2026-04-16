import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import TodayPlanTask from "../models/TodayPlanTask.js";

const clean = (v) => {
  try {
    if (v == null) return "";
    return String(v).trim();
  } catch (error) {
    console.error("clean error:", error);
    return "";
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

const isToday = (date) => {
  try {
    if (!date) return false;
    const d = new Date(date);
    const now = new Date();
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
    return new Date(date).getTime() < Date.now();
  } catch (error) {
    console.error("isOverdue error:", error);
    return false;
  }
};

const formatDateLabel = (date = new Date()) => {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch (error) {
    console.error("formatDateLabel error:", error);
    return "";
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

const normalizeTaskType = (value) => {
  try {
    const v = clean(value).toLowerCase();

    if (["new_call", "new call"].includes(v)) return "new_call";
    if (["follow_up", "follow up", "followup"].includes(v)) return "follow_up";
    if (["payment"].includes(v)) return "payment";
    if (["proposal"].includes(v)) return "proposal";
    if (["meeting"].includes(v)) return "meeting";
    if (["onboarding"].includes(v)) return "onboarding";

    return "follow_up";
  } catch (error) {
    console.error("normalizeTaskType error:", error);
    return "follow_up";
  }
};

const normalizePriority = (value) => {
  try {
    const v = clean(value).toLowerCase();
    if (["low", "medium", "high", "urgent"].includes(v)) return v;
    return "medium";
  } catch (error) {
    console.error("normalizePriority error:", error);
    return "medium";
  }
};

const normalizeSection = (value, taskType = "follow_up") => {
  try {
    const v = clean(value).toLowerCase();

    if (["call_immediately", "follow_up_today", "other"].includes(v)) {
      return v;
    }

    if (taskType === "new_call") return "call_immediately";
    if (taskType === "follow_up") return "follow_up_today";

    return "other";
  } catch (error) {
    console.error("normalizeSection error:", error);
    return "other";
  }
};

const serializeTask = (task) => {
  try {
    const obj = task?.toObject ? task.toObject() : { ...task };

    obj.leadId =
      obj.leadId && typeof obj.leadId === "object" && obj.leadId._id
        ? String(obj.leadId._id)
        : obj.leadId
        ? String(obj.leadId)
        : null;

    return obj;
  } catch (error) {
    console.error("serializeTask error:", error);
    return task;
  }
};

const buildTaskPayloadFromLead = (lead, input = {}) => {
  try {
    const taskType = normalizeTaskType(input.taskType || "follow_up");
    const plannedDate = input.plannedDate ? new Date(input.plannedDate) : new Date();

    return {
      leadId: lead?._id || null,
      title:
        clean(input.title) ||
        `${taskType === "new_call" ? "New Lead" : "Task"} - ${clean(lead?.name) || "Lead"}`,
      taskType,
      priority: normalizePriority(input.priority || "medium"),
      status: clean(input.status) === "completed" ? "completed" : "pending",
      section: normalizeSection(input.section, taskType),
      dueLabel: clean(input.dueLabel) || getDueLabel(plannedDate),
      subtitle:
        clean(input.subtitle) ||
        clean(lead?.requirements) ||
        clean(lead?.business) ||
        clean(lead?.company) ||
        "Lead task",
      city: clean(input.city) || clean(lead?.location),
      ownerName: clean(input.ownerName) || clean(lead?.repName) || clean(lead?.rep) || "Unassigned",
      source: clean(input.source) || clean(lead?.source),
      service: clean(input.service) || clean(lead?.business) || clean(lead?.company),
      phone: clean(input.phone) || clean(lead?.phone) || clean(lead?.mobile),
      notes: clean(input.notes),
      plannedDate,
      completedAt: clean(input.status) === "completed" ? new Date() : null,
      sortOrder: Number(input.sortOrder || 0),
    };
  } catch (error) {
    console.error("buildTaskPayloadFromLead error:", error);
    throw error;
  }
};

export const createTodayPlanTask = async (req, res) => {
  try {
    const body = req.body || {};
    let payload;

    if (body.leadId) {
      if (!isValidObjectId(body.leadId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid lead id",
        });
      }

      const lead = await Lead.findById(body.leadId);

      if (!lead) {
        return res.status(404).json({
          success: false,
          message: "Lead not found",
        });
      }

      payload = buildTaskPayloadFromLead(lead, body);
    } else {
      payload = {
        title: clean(body.title) || "Task",
        taskType: normalizeTaskType(body.taskType),
        priority: normalizePriority(body.priority),
        status: clean(body.status) === "completed" ? "completed" : "pending",
        section: normalizeSection(body.section, body.taskType),
        dueLabel: clean(body.dueLabel) || getDueLabel(body.plannedDate ? new Date(body.plannedDate) : new Date()),
        subtitle: clean(body.subtitle),
        city: clean(body.city),
        ownerName: clean(body.ownerName),
        source: clean(body.source),
        service: clean(body.service),
        phone: clean(body.phone),
        notes: clean(body.notes),
        plannedDate: body.plannedDate ? new Date(body.plannedDate) : new Date(),
        sortOrder: Number(body.sortOrder || 0),
        completedAt: clean(body.status) === "completed" ? new Date() : null,
      };
    }

    const task = await TodayPlanTask.create(payload);

    return res.status(201).json({
      success: true,
      data: serializeTask(task),
    });
  } catch (error) {
    console.error("createTodayPlanTask error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create task",
    });
  }
};

export const createTodayPlanTaskFromLead = async (req, res) => {
  try {
    const { leadId } = req.params;
    const body = req.body || {};

    if (!isValidObjectId(leadId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid lead id",
      });
    }

    const lead = await Lead.findById(leadId);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    const payload = buildTaskPayloadFromLead(lead, body);
    const task = await TodayPlanTask.create(payload);

    return res.status(201).json({
      success: true,
      data: serializeTask(task),
    });
  } catch (error) {
    console.error("createTodayPlanTaskFromLead error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create task from lead",
    });
  }
};

export const toggleTodayPlanTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await TodayPlanTask.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    task.status = task.status === "completed" ? "pending" : "completed";
    task.completedAt = task.status === "completed" ? new Date() : null;

    await task.save();

    return res.json({
      success: true,
      data: serializeTask(task),
    });
  } catch (error) {
    console.error("toggleTodayPlanTaskStatus error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update task status",
    });
  }
};

export const deleteTodayPlanTask = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid task id",
      });
    }

    const task = await TodayPlanTask.findById(id);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "Task not found",
      });
    }

    await TodayPlanTask.deleteOne({ _id: id });

    return res.json({
      success: true,
      message: "Task deleted successfully",
    });
  } catch (error) {
    console.error("deleteTodayPlanTask error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete task",
    });
  }
};

// ─── 5-minute TTL cache + request coalescing ─────────────────────────────────
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const _pending = new Map();

const cacheGet = (key) => {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return entry.data;
};

const cacheSet = (key, data) => _cache.set(key, { ts: Date.now(), data });

export const clearTodayPlanCache = () => { _cache.clear(); _pending.clear(); };

// ─── Targeted lead fetch config ───────────────────────────────────────────────
const RELEVANT_STAGES = ["Lead Capture", "Proposal", "Negotiation", "Qualified", "Closed", "Closed Won"];

const LEAD_SELECT = "_id name phone mobile location repName rep source business company requirements priority stage followups";

// ─── Sync auto-task builder — zero DB calls ───────────────────────────────────
// existingKeys: Set<"leadId-taskType-title"> built from today's DB tasks
const buildAutoTasksFromLeadsSync = (leads, existingKeys) => {
  const autoTasks = [];
  const now = new Date();

  for (const lead of leads) {
    const leadId    = String(lead._id);
    const leadName  = clean(lead.name) || "Lead";
    const phone     = clean(lead.phone) || clean(lead.mobile);
    const city      = clean(lead.location);
    const ownerName = clean(lead.repName) || clean(lead.rep) || "Unassigned";
    const source    = clean(lead.source);
    const service   = clean(lead.business) || clean(lead.company);
    const subtitle  = clean(lead.requirements) || clean(lead.business) || "Lead task";
    const stage     = clean(lead.stage);
    const priorityText = clean(lead.priority).toLowerCase();

    // O(1) duplicate check — replaces async TodayPlanTask.findOne per lead
    const notExists = (taskType, title) => !existingKeys.has(`${leadId}-${taskType}-${title}`);

    if (stage === "Lead Capture") {
      const title = `New Lead - ${leadName}`;
      if (notExists("new_call", title)) {
        autoTasks.push({
          _id: `auto-new-${leadId}`,
          leadId,
          title,
          taskType: "new_call",
          priority: "urgent",
          status: "pending",
          section: "call_immediately",
          dueLabel: "ASAP",
          subtitle,
          city,
          ownerName,
          source,
          service,
          phone,
          notes: "Auto-generated from lead stage",
          plannedDate: now,
          sortOrder: 0,
          isAutoGenerated: true,
        });
      }
    }

    if (Array.isArray(lead.followups)) {
      for (const fu of lead.followups) {
        const shouldInclude =
          !fu.done &&
          (
            clean(fu.status).toLowerCase() === "pending" ||
            clean(fu.status).toLowerCase() === "due"     ||
            clean(fu.status).toLowerCase() === "overdue" ||
            isToday(fu.dueDate)   ||
            isOverdue(fu.dueDate)
          );

        if (!shouldInclude) continue;

        const title = clean(fu.title) || `Follow-up - ${leadName}`;

        if (notExists("follow_up", title)) {
          autoTasks.push({
            _id: `auto-followup-${leadId}-${fu.dayIndex || Date.now()}`,
            leadId,
            title,
            taskType: "follow_up",
            priority: isOverdue(fu.dueDate) ? "urgent" : "high",
            status: fu.done ? "completed" : "pending",
            section: "follow_up_today",
            dueLabel: getDueLabel(fu.dueDate || now),
            subtitle,
            city,
            ownerName,
            source,
            service,
            phone,
            notes: `${clean(fu.channel) || "Call"} • ${clean(fu.status) || "Pending"}`,
            plannedDate: fu.dueDate ? new Date(fu.dueDate) : now,
            sortOrder: Number(fu.dayIndex || 0),
            isAutoGenerated: true,
          });
        }
      }
    }

    if (["Proposal", "Negotiation"].includes(stage)) {
      const title = `Payment Follow-up - ${leadName}`;
      if (notExists("payment", title)) {
        autoTasks.push({
          _id: `auto-payment-${leadId}`,
          leadId,
          title,
          taskType: "payment",
          priority: priorityText === "hot" ? "urgent" : "high",
          status: "pending",
          section: "other",
          dueLabel: "Today",
          subtitle: `Payment pending • ${subtitle}`,
          city,
          ownerName,
          source,
          service,
          phone,
          notes: "Auto-generated from proposal/negotiation stage",
          plannedDate: now,
          sortOrder: 10,
          isAutoGenerated: true,
        });
      }
    }

    if (stage === "Proposal") {
      const title = `Proposal Review - ${leadName}`;
      if (notExists("proposal", title)) {
        autoTasks.push({
          _id: `auto-proposal-${leadId}`,
          leadId,
          title,
          taskType: "proposal",
          priority: "medium",
          status: "pending",
          section: "other",
          dueLabel: "Today",
          subtitle: "Check whether proposal was reviewed",
          city,
          ownerName,
          source,
          service,
          phone,
          notes: "Auto-generated from proposal stage",
          plannedDate: now,
          sortOrder: 20,
          isAutoGenerated: true,
        });
      }
    }

    if (stage === "Qualified") {
      const title = `Meeting Setup - ${leadName}`;
      if (notExists("meeting", title)) {
        autoTasks.push({
          _id: `auto-meeting-${leadId}`,
          leadId,
          title,
          taskType: "meeting",
          priority: "medium",
          status: "pending",
          section: "other",
          dueLabel: "Today",
          subtitle: "Schedule discussion with client",
          city,
          ownerName,
          source,
          service,
          phone,
          notes: "Auto-generated from qualified stage",
          plannedDate: now,
          sortOrder: 30,
          isAutoGenerated: true,
        });
      }
    }

    if (["Closed", "Closed Won"].includes(stage)) {
      const title = `Onboarding - ${leadName}`;
      if (notExists("onboarding", title)) {
        autoTasks.push({
          _id: `auto-onboarding-${leadId}`,
          leadId,
          title,
          taskType: "onboarding",
          priority: "medium",
          status: "pending",
          section: "other",
          dueLabel: "Today",
          subtitle: "Kickoff and onboarding follow-up",
          city,
          ownerName,
          source,
          service,
          phone,
          notes: "Auto-generated from closed stage",
          plannedDate: now,
          sortOrder: 40,
          isAutoGenerated: true,
        });
      }
    }
  }

  return autoTasks;
};

export const getTodayPlanDashboard = async (req, res) => {
  try {
    // Serve from cache if fresh (invalidates at day boundary since key includes date string)
    const cacheKey = `today-plan-${new Date().toDateString()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Request coalescing: reuse in-flight fetch for concurrent requests
    if (_pending.has(cacheKey)) {
      const result = await _pending.get(cacheKey);
      return res.json(result);
    }

    const fetchPromise = _fetchTodayPlan(cacheKey);
    _pending.set(cacheKey, fetchPromise);
    fetchPromise.finally(() => _pending.delete(cacheKey));

    const response = await fetchPromise;
    return res.json(response);
  } catch (error) {
    console.error("getTodayPlanDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch today's plan dashboard",
    });
  }
};

const _fetchTodayPlan = async (cacheKey) => {
    const todayStart = startOfDay(new Date());
    const todayEnd   = endOfDay(new Date());

    // Single parallel fetch — 2 queries total instead of 1 + N+1
    const [dbTasks, leads] = await Promise.all([
      TodayPlanTask.find({ plannedDate: { $gte: todayStart, $lte: todayEnd } })
        .sort({ section: 1, sortOrder: 1, createdAt: -1 })
        .lean(),
      Lead.find({
        $or: [
          { stage: { $in: RELEVANT_STAGES } },
          { followups: { $elemMatch: { done: { $ne: true } } } },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(300)
        .select(LEAD_SELECT)
        .lean(),
    ]);

    // Build O(1) dedup set — replaces N+1 TodayPlanTask.findOne calls in loop
    const existingTaskKeys = new Set(
      dbTasks
        .filter(t => t.leadId)
        .map(t => `${String(t.leadId)}-${t.taskType}-${t.title}`)
    );

    const manualTasks = dbTasks.map(serializeTask);
    const autoTasks   = buildAutoTasksFromLeadsSync(leads, existingTaskKeys);

    const taskMap = new Map();
    for (const task of [...manualTasks, ...autoTasks]) {
      const key = `${task.leadId || "no-lead"}-${task.taskType}-${task.title}`;
      if (!taskMap.has(key)) taskMap.set(key, task);
    }

    const allTasks = Array.from(taskMap.values());

    const totalTasks     = allTasks.length;
    const completedTasks = allTasks.filter(t => t.status === "completed").length;
    const pendingTasks   = totalTasks - completedTasks;
    const urgentTasks    = allTasks.filter(t => t.status === "pending" && t.priority === "urgent").length;

    const summary = {
      newCalls:   allTasks.filter(t => t.taskType === "new_call").length,
      followUps:  allTasks.filter(t => t.taskType === "follow_up").length,
      payments:   allTasks.filter(t => t.taskType === "payment").length,
      proposals:  allTasks.filter(t => t.taskType === "proposal").length,
      meetings:   allTasks.filter(t => t.taskType === "meeting").length,
      onboarding: allTasks.filter(t => t.taskType === "onboarding").length,
    };

    const immediateTasks = allTasks.filter(
      t => t.section === "call_immediately" || t.taskType === "new_call"
    );

    const scheduleTasks = allTasks
      .filter(t => t.section !== "call_immediately" && t.taskType !== "new_call")
      .sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));

    const response = {
      success: true,
      data: {
        header: {
          dateLabel:         formatDateLabel(new Date()),
          totalTasks,
          completedTasks,
          pendingTasks,
          urgentTasks,
          completionPercent: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
        },
        summary,
        sections: { immediateTasks, scheduleTasks },
      },
    };

    cacheSet(cacheKey, response);
    return response;
};

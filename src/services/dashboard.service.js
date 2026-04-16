import Lead from "../models/Lead.js";
import Document from "../models/Document.js";
import Admin from "../models/Admin.js";
import Rep from "../models/Rep.js";
import MonthlyTarget from "../models/MonthlyTarget.js";
import Enquiry from "../models/Enquiry.js";

/* ─── In-memory cache (5 min TTL) + request coalescing ───── */
const _cache = new Map();
const CACHE_TTL = 5 * 60_000; // 5 minutes — avoids cold-start delays every morning
const _pending = new Map();   // request coalescing: reuse in-flight promises

function fromCache(key) {
  const hit = _cache.get(key);
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data : null;
}
function setCache(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}
export function clearDashboardCache() {
  _cache.clear();
  _pending.clear();
}

/* ─── Constants ──────────────────────────────────────────── */
const BRANCHES = ["Bangalore", "Mumbai", "Mysore"];
const CLOSED_STAGES = ["closed", "won", "deal closed", "closed won"];

const isClosedExpr = {
  $in: [{ $toLower: { $ifNull: ["$stage", ""] } }, CLOSED_STAGES],
};

/* ─── Helpers ────────────────────────────────────────────── */
function formatCurrencyShort(amount = 0) {
  const v = Number(amount || 0);
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(2)}L`;
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toLocaleString("en-IN")}`;
}

function getLeadName(lead = {}) {
  return lead?.name || lead?.leadName || lead?.customerName || "Unknown Lead";
}

function getLeadAmount(lead = {}) {
  return Number(lead?.dealValue || lead?.value || 0);
}

/* ─── Funnel parser (from aggregation group-by-stage result) */
const STAGE_FUNNEL = {
  reachable: ["contacted", "reachable", "follow up", "follow-up", "qualified", "proposal", "quotation", "quoted", "closed", "won", "deal closed"],
  qualified: ["qualified", "proposal", "quotation", "quoted", "closed", "won", "deal closed"],
  proposal:  ["proposal", "quotation", "quoted", "closed", "won", "deal closed"],
  closed:    ["closed", "won", "deal closed", "closed won"],
};

function parseFunnel(rows = []) {
  let enquiries = 0, reachable = 0, qualified = 0, proposal = 0, closed = 0;
  for (const { _id: stage, count } of rows) {
    const s = String(stage || "").toLowerCase();
    enquiries += count;
    if (STAGE_FUNNEL.reachable.some(k => s.includes(k))) reachable += count;
    if (STAGE_FUNNEL.qualified.some(k => s.includes(k))) qualified += count;
    if (STAGE_FUNNEL.proposal.some(k =>  s.includes(k))) proposal  += count;
    if (STAGE_FUNNEL.closed.some(k =>   s.includes(k)))  closed    += count;
  }
  return { enquiries, reachable, qualified, proposal, closed };
}

function parseBranchPerf(rows = []) {
  const map = {};
  for (const r of rows) {
    map[r._id] = {
      name:    r._id,
      leads:   r.total,
      closed:  r.closed,
      revenue: r.revenue,
      rate:    r.total > 0 ? Math.round((r.closed / r.total) * 100) : 0,
    };
  }
  return BRANCHES.map(b => map[b] || { name: b, leads: 0, closed: 0, revenue: 0, rate: 0 });
}

function buildInsight(branchPerformance = []) {
  if (!branchPerformance.length) return "No branch performance data available yet.";
  const sorted = [...branchPerformance].sort((a, b) => b.rate - a.rate);
  const top = sorted[0], bot = sorted[sorted.length - 1];
  if (!top || !bot) return "Performance insight not available.";
  return `${top.name}'s ${top.rate}% close rate leads all branches. Replicate in ${bot.name} for +${formatCurrencyShort(Math.max(top.revenue - bot.revenue, 0))} opportunity.`;
}

/* ─── Main export ────────────────────────────────────────── */
export async function getDashboardSummary() {
  const cached = fromCache("dashboard");
  if (cached) return cached;

  // Request coalescing: if a fetch is already in-flight, reuse it
  if (_pending.has("dashboard")) return _pending.get("dashboard");

  const promise = _fetchDashboardSummary();
  _pending.set("dashboard", promise);
  promise.finally(() => _pending.delete("dashboard"));
  return promise;
}

async function _fetchDashboardSummary() {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const threshold8d = new Date(Date.now() - 8 * 86_400_000);

  const [
    facetResult,
    monthlyLeadsCount,
    monthlyClosedCount,
    adminCount,
    repCount,
    docCount,
    totalEnquiryCount,
    monthlyEnquiryCount,
    recentLeads,
    recentDocs,
    approvalWatchlist,
    followupQueue,
    paymentAlerts,
    todayFollowupLeads,
  ] = await Promise.all([

    /* 1. Single $facet — ONE collection scan for all summary stats */
    Lead.aggregate([{
      $facet: {

        funnel: [
          { $group: { _id: { $toLower: { $ifNull: ["$stage", "unknown"] } }, count: { $sum: 1 } } },
        ],

        branchPerf: [
          { $group: {
            _id:     { $ifNull: ["$branch", "Unknown"] },
            total:   { $sum: 1 },
            closed:  { $sum: { $cond: [isClosedExpr, 1, 0] } },
            revenue: { $sum: { $cond: [isClosedExpr, { $ifNull: ["$value", 0] }, 0] } },
          }},
        ],

        projectStats: [
          { $match: { onboardedDate: { $ne: null } } },
          { $group: {
            _id: null,
            inDevelopment: { $sum: { $cond: [{
              $and: [
                { $eq: ["$projectCompleted", false] },
                { $not: { $in: [{ $ifNull: ["$approvalStatus", "pending"] }, ["on_hold", "restarted"]] } },
              ],
            }, 1, 0] } },
            pendingApproval: { $sum: { $cond: [{
              $and: [
                { $eq: ["$projectCompleted", true] },
                { $ne: [{ $ifNull: ["$approvalStatus", "pending"] }, "approved"] },
              ],
            }, 1, 0] } },
            completed: { $sum: { $cond: [{
              $and: [
                { $eq: ["$projectCompleted", true] },
                { $eq: [{ $ifNull: ["$approvalStatus", "pending"] }, "approved"] },
              ],
            }, 1, 0] } },
            onHold: { $sum: { $cond: [{ $in: [{ $ifNull: ["$approvalStatus", "pending"] }, ["on_hold", "restarted"]] }, 1, 0] } },
            overdue: { $sum: { $cond: [{
              $and: [
                { $eq: ["$projectCompleted", false] },
                { $lt: [{
                  $add: [
                    { $ifNull: ["$projectStartDate", { $ifNull: ["$onboardedDate", now] }] },
                    { $multiply: [{ $ifNull: ["$agreedTimeline", 8] }, 86_400_000] },
                  ],
                }, now] },
              ],
            }, 1, 0] } },
          }},
        ],

        paymentHealth: [
          { $match: { value: { $gt: 0 } } },
          { $group: {
            _id:                null,
            totalAgreed:        { $sum: "$value" },
            advanceCollected:   { $sum: { $ifNull: ["$advanceReceived", 0] } },
            fullyPaidCount:     { $sum: { $cond: [{ $gte: [{ $ifNull: ["$advanceReceived", 0] }, "$value"] }, 1, 0] } },
            partialCount:       { $sum: { $cond: [{ $and: [{ $gt: [{ $ifNull: ["$advanceReceived", 0] }, 0] }, { $lt: [{ $ifNull: ["$advanceReceived", 0] }, "$value"] }] }, 1, 0] } },
            unpaidCount:        { $sum: { $cond: [{ $lte: [{ $ifNull: ["$advanceReceived", 0] }, 0] }, 1, 0] } },
            thisMonthCollected: { $sum: { $cond: [{
              $and: [
                { $gte: [{ $ifNull: ["$advanceReceivedDate", new Date(0)] }, monthStart] },
                { $lt:  [{ $ifNull: ["$advanceReceivedDate", new Date(0)] }, monthEnd]   },
              ],
            }, { $ifNull: ["$advanceReceived", 0] }, 0] } },
          }},
        ],

        totals: [
          { $group: {
            _id:         null,
            totalLeads:  { $sum: 1 },
            dealsClosed: { $sum: { $cond: [isClosedExpr, 1, 0] } },
            revenue:     { $sum: { $cond: [isClosedExpr, { $ifNull: ["$value", 0] }, 0] } },
          }},
        ],

        monthlyRevenue: [
          { $match: { createdAt: { $gte: monthStart, $lt: monthEnd } } },
          { $group: {
            _id:     null,
            revenue: { $sum: { $cond: [isClosedExpr, { $ifNull: ["$value", 0] }, 0] } },
          }},
        ],
      },
    }]),

    /* 2. Lightweight counts — use indexed fields */
    Lead.countDocuments({ createdAt: { $gte: monthStart, $lt: monthEnd } }),
    Lead.countDocuments({
      createdAt: { $gte: monthStart, $lt: monthEnd },
      $or: [{ stage: /closed/i }, { stage: /won/i }, { status: /closed/i }, { status: /won/i }],
    }),
    Admin.countDocuments({ isActive: true }),
    Rep.countDocuments({ isActive: true }),
    Document.countDocuments(),
    Enquiry.countDocuments(),
    Enquiry.countDocuments({ createdAt: { $gte: monthStart, $lt: monthEnd } }),

    /* 3. Recent leads for activity — top 15 only, minimal fields */
    Lead.find({})
      .sort({ updatedAt: -1 })
      .limit(15)
      .select("name branch repName rep stage value dealValue history updatedAt createdAt")
      .lean(),

    /* 4. Recent documents — top 10 */
    Document.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select("type name originalFileName notes linkedLead createdAt updatedAt")
      .lean(),

    /* 5. Approval watchlist — uses { projectCompleted, approvalStatus } index */
    Lead.find({ projectCompleted: true, approvalStatus: { $nin: ["approved"] } })
      .sort({ projectCompletionDate: 1 })
      .limit(8)
      .select("name business company phone email repName rep projectCompletionDate approvalStatus emailLogs")
      .lean(),

    /* 6. Follow-up queue — uses { onboardedDate } index */
    Lead.find({ onboardedDate: { $ne: null, $lte: threshold8d }, projectCompleted: { $ne: true } })
      .sort({ onboardedDate: 1 })
      .limit(8)
      .select("name business company phone email repName rep onboardedDate projectStartDate emailLogs")
      .lean(),

    /* 7. Payment alerts — uses { value } index */
    Lead.find({ value: { $gt: 0 }, $expr: { $lt: [{ $ifNull: ["$advanceReceived", 0] }, "$value"] } })
      .sort({ createdAt: 1 })
      .limit(20)
      .select("name business company phone repName rep value dealValue advanceReceived stage createdAt")
      .lean(),

    /* 8. Today's followups — uses { followups.dueDate } index */
    Lead.find({
      followups: { $elemMatch: { done: { $ne: true }, dueDate: { $gte: todayStart, $lt: todayEnd } } },
    })
      .limit(20)
      .select("name branch rep repName followups")
      .lean(),
  ]);

  /* ── Parse facet results ───────────────────────────────── */
  const facet       = facetResult[0] || {};
  const funnel      = parseFunnel(facet.funnel || []);
  const branchPerf  = parseBranchPerf(facet.branchPerf || []);
  const insight     = buildInsight(branchPerf);
  const rawPS       = facet.projectStats?.[0]   || {};
  const rawPH       = facet.paymentHealth?.[0]  || {};
  const rawTotals   = facet.totals?.[0]         || {};
  const rawMonthRev = facet.monthlyRevenue?.[0] || {};

  const projectStats = {
    inDevelopment:   rawPS.inDevelopment   || 0,
    pendingApproval: rawPS.pendingApproval || 0,
    completed:       rawPS.completed       || 0,
    onHold:          rawPS.onHold          || 0,
    overdue:         rawPS.overdue         || 0,
  };

  const paymentHealth = {
    totalAgreed:        rawPH.totalAgreed        || 0,
    advanceCollected:   rawPH.advanceCollected    || 0,
    balancePending:     Math.max(0, (rawPH.totalAgreed || 0) - (rawPH.advanceCollected || 0)),
    thisMonthCollected: rawPH.thisMonthCollected  || 0,
    fullyPaidCount:     rawPH.fullyPaidCount      || 0,
    partialCount:       rawPH.partialCount        || 0,
    unpaidCount:        rawPH.unpaidCount         || 0,
  };

  /* ── Approval watchlist ────────────────────────────────── */
  const approvalWatchlistData = approvalWatchlist.map(lead => {
    const completedOn = lead.projectCompletionDate ? new Date(lead.projectCompletionDate) : null;
    const daysWaiting = completedOn ? Math.floor((Date.now() - completedOn.getTime()) / 86_400_000) : 0;
    return {
      leadId:         lead._id,
      name:           getLeadName(lead),
      business:       lead.business || lead.company || "",
      phone:          lead.phone    || "",
      email:          lead.email    || "",
      repName:        lead.repName  || lead.rep || "",
      approvalStatus: lead.approvalStatus || "pending",
      completedOn:    completedOn ? completedOn.toISOString() : null,
      daysWaiting,
      emailLogsCount: Array.isArray(lead.emailLogs) ? lead.emailLogs.filter(e => e.type?.startsWith("followup")).length : 0,
    };
  });

  /* ── Follow-up queue ───────────────────────────────────── */
  const followupQueueData = followupQueue.map(lead => {
    const startDate      = lead.projectStartDate || lead.onboardedDate;
    const daysSinceStart = startDate ? Math.floor((now - new Date(startDate)) / 86_400_000) : 0;
    const followupsSent  = Array.isArray(lead.emailLogs) ? lead.emailLogs.filter(e => e.type?.startsWith("followup")).length : 0;
    return {
      leadId:       lead._id,
      name:         getLeadName(lead),
      business:     lead.business || lead.company || "",
      phone:        lead.phone    || "",
      email:        lead.email    || "",
      repName:      lead.repName  || lead.rep || "",
      daysSinceStart,
      followupsSent,
      nextFollowup: Math.min(followupsSent + 1, 3),
    };
  });

  /* ── Payment alerts ────────────────────────────────────── */
  const paymentAlertsData = paymentAlerts.map(lead => {
    const value          = Number(lead.value || lead.dealValue || 0);
    const advance        = Number(lead.advanceReceived || 0);
    const daysSinceLead  = lead.createdAt
      ? Math.floor((now - new Date(lead.createdAt)) / 86_400_000)
      : null;
    return {
      leadId:          lead._id,
      name:            getLeadName(lead),
      business:        lead.business || lead.company || "",
      phone:           lead.phone    || "",
      repName:         lead.repName  || lead.rep || "",
      stage:           lead.stage    || "",
      totalValue:      value,
      advanceReceived: advance,
      remaining:       value - advance,
      advancePct:      value > 0 ? Math.round((advance / value) * 100) : 0,
      isNotPaid:       advance === 0,
      daysSinceLead,
    };
  });

  /* ── Recent activity ───────────────────────────────────── */
  const leadActivities = [];
  for (const lead of recentLeads) {
    if (Array.isArray(lead.history)) {
      lead.history.forEach(item => {
        const t = String(item?.title || "").toLowerCase();
        leadActivities.push({
          type:     t.includes("closed") ? "deal_closed" : t.includes("overdue") ? "followup_overdue" : "activity",
          title:    item?.title || "Lead updated",
          subtitle: `${getLeadName(lead)} • ${lead?.branch || "General"}`,
          amount:   t.includes("closed") ? getLeadAmount(lead) : 0,
          time:     item?.at || lead?.updatedAt,
          meta:     lead?.branch || "General",
          by:       item?.by || lead?.repName || "System",
        });
      });
    }
  }
  const docActivities = recentDocs.map(doc => ({
    type:     "document",
    title:    `${doc?.type || "Document"} uploaded — ${doc?.name || doc?.originalFileName || "File"}`,
    subtitle: doc?.notes || doc?.linkedLead || "Document activity",
    amount:   0,
    time:     doc?.createdAt || doc?.updatedAt || new Date(),
    meta:     "Documents",
    by:       "System",
  }));
  const recentActivity = [...leadActivities, ...docActivities]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 8);

  /* ── Today's followups ─────────────────────────────────── */
  const todayFollowupItems = [];
  let overdueCount = 0;
  for (const lead of todayFollowupLeads) {
    if (!Array.isArray(lead.followups)) continue;
    for (const item of lead.followups) {
      if (item?.done) continue;
      const dueDate = item?.dueDate ? new Date(item.dueDate) : null;
      if (!dueDate || isNaN(dueDate)) continue;
      const isOverdue = dueDate < todayStart;
      const isToday   = dueDate >= todayStart && dueDate < todayEnd;
      if (!isOverdue && !isToday) continue;
      if (isOverdue) overdueCount++;
      todayFollowupItems.push({
        leadName: getLeadName(lead),
        title:    item?.title || "Follow-up call",
        priority: isOverdue ? "Hot" : "Warm",
        branch:   lead?.branch || "General",
        dayIndex: item?.dayIndex || 1,
        dueDate,
      });
    }
  }
  const todayFollowups = todayFollowupItems
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 6);

  /* ── Assemble final result ─────────────────────────────── */
  const totalLeads     = rawTotals.totalLeads  || 0;
  const dealsClosed    = rawTotals.dealsClosed || 0;
  const totalRevenue   = rawTotals.revenue     || 0;
  const conversionRate = totalLeads > 0 ? Number(((dealsClosed / totalLeads) * 100).toFixed(1)) : 0;

  const result = {
    success: true,
    data: {
      summary: {
        totalLeads:           totalLeads,
        activeLeads:          totalLeads - dealsClosed,
        totalEnquiries:       totalEnquiryCount,
        thisMonthEnquiries:   monthlyEnquiryCount,
        totalLeadEnquiries:   funnel.enquiries,
        thisMonthLeads:       monthlyLeadsCount,
        dealsClosed,
        thisMonthDealsClosed: monthlyClosedCount,
        revenue:              totalRevenue,
        thisMonthRevenue:     rawMonthRev.revenue || 0,
        conversionRate,
        totalDocuments:       docCount,
        totalReps:            repCount,
        totalAdmins:          adminCount,
      },
      funnel,
      branchPerformance: branchPerf,
      recentActivity,
      todayFollowups,
      overdueCount,
      insight,
      projectStats,
      paymentHealth,
      approvalWatchlist:  approvalWatchlistData,
      followupQueue:      followupQueueData,
      paymentAlerts:      paymentAlertsData,
    },
  };

  setCache("dashboard", result);
  return result;
}

/* ─── Period helpers ─────────────────────────────────────── */
function getPeriodRange(period, from, to) {
  const now = new Date();
  switch (period) {
    case "today": {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return { start: s, end: e, label: "Today" };
    }
    case "week": {
      const day = now.getDay(); // 0=Sun
      const diff = (day === 0 ? -6 : 1 - day); // Monday
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      const e = new Date(s.getTime() + 7 * 86_400_000);
      return { start: s, end: e, label: "This Week" };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start: s, end: e, label: "This Month" };
    }
    case "year": {
      const s = new Date(now.getFullYear(), 0, 1);
      const e = new Date(now.getFullYear() + 1, 0, 1);
      return { start: s, end: e, label: "This Year" };
    }
    case "custom": {
      const s = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
      const e = to   ? new Date(new Date(to).getTime() + 86_400_000) : new Date();
      return { start: s, end: e, label: "Custom Range" };
    }
    case "all": {
      return { start: null, end: null, label: "All Time" };
    }
    default: {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start: s, end: e, label: "This Month" };
    }
  }
}

/* ─── Sales stats for a period ───────────────────────────── */
export async function getSalesStats(period = "month", from, to) {
  const { start, end, label } = getPeriodRange(period, from, to);

  const CLOSED_STAGES_RE = /closed|won/i;
  const isAllTime = start === null;

  const now = new Date();

  const [newLeads, closedLeads, enquiryCount, target] = await Promise.all([
    /* new leads created in period */
    isAllTime
      ? Lead.countDocuments({})
      : Lead.countDocuments({ createdAt: { $gte: start, $lt: end } }),

    /* leads in closed stage */
    isAllTime
      ? Lead.find({ $or: [{ stage: CLOSED_STAGES_RE }, { status: CLOSED_STAGES_RE }] })
          .select("value dealValue stage").lean()
      : Lead.find({
          createdAt: { $gte: start, $lt: end },
          $or: [{ stage: CLOSED_STAGES_RE }, { status: CLOSED_STAGES_RE }],
        }).select("value dealValue stage").lean(),

    /* enquiries created in period */
    isAllTime
      ? Enquiry.countDocuments({})
      : Enquiry.countDocuments({ createdAt: { $gte: start, $lt: end } }),

    /* current month target — fetch in parallel, not sequentially */
    MonthlyTarget.findOne({ year: now.getFullYear(), month: now.getMonth() + 1 }).lean(),
  ]);

  const closedDeals   = closedLeads.length;
  const revenue       = closedLeads.reduce((s, l) => s + Number(l.value || l.dealValue || 0), 0);

  return {
    success: true,
    data: {
      period: label,
      from:   start ? start.toISOString() : null,
      to:     end   ? end.toISOString()   : null,
      enquiries: enquiryCount,
      newLeads,
      closedDeals,
      revenue,
      target: target
        ? { targetDeals: target.targetDeals, targetRevenue: target.targetRevenue, notes: target.notes }
        : null,
    },
  };
}

/* ─── Monthly target CRUD ────────────────────────────────── */
export async function getMonthlyTarget(year, month) {
  const doc = await MonthlyTarget.findOne({ year, month }).lean();
  return { success: true, data: doc || null };
}

export async function setMonthlyTarget(year, month, targetDeals, targetRevenue, notes = "") {
  const doc = await MonthlyTarget.findOneAndUpdate(
    { year, month },
    { $set: { targetDeals, targetRevenue, notes } },
    { upsert: true, new: true }
  ).lean();
  // Clear dashboard cache so updated targets are reflected immediately
  clearDashboardCache();
  return { success: true, data: doc };
}

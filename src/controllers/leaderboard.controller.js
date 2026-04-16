import Lead from "../models/Lead.js";

const CLOSED_STAGES = ["closed", "won", "converted"];

const isClosedExpr = {
  $in: [{ $toLower: { $ifNull: ["$status", ""] } }, CLOSED_STAGES],
};

const hasContactExpr = {
  $or: [
    { $gt: [{ $size: { $ifNull: ["$commLogs",  []] } }, 0] },
    { $gt: [{ $size: { $ifNull: ["$followups", []] } }, 0] },
  ],
};

function getPeriodRange(period) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  switch (period) {
    case "this_month":
      return { $gte: new Date(year, month, 1), $lt: new Date(year, month + 1, 1) };
    case "last_month":
      return { $gte: new Date(year, month - 1, 1), $lt: new Date(year, month, 1) };
    case "this_quarter": {
      const q = Math.floor(month / 3);
      return { $gte: new Date(year, q * 3, 1), $lt: new Date(year, q * 3 + 3, 1) };
    }
    case "this_year":
      return { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) };
    default:
      return null; // all time
  }
}

const getLeaderboard = async (req, res) => {
  try {
    const { period = "all", branch = "" } = req.query;

    // Build match stage
    const matchStage = {};
    const dateRange = getPeriodRange(period);
    if (dateRange) matchStage.createdAt = dateRange;
    if (branch)    matchStage.branch    = branch;

    const [repAgg, recentLeads, branchAgg] = await Promise.all([

      // Rep performance
      Lead.aggregate([
        ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
        {
          $group: {
            _id: {
              rep:    { $ifNull: ["$repName", { $ifNull: ["$rep", "Unassigned"] }] },
              branch: { $ifNull: ["$branch", "Unknown"] },
            },
            leads:       { $sum: 1 },
            contacted:   { $sum: { $cond: [hasContactExpr, 1, 0] } },
            qualified: {
              $sum: {
                $cond: [{ $regexMatch: { input: { $toLower: { $ifNull: ["$stage",""] } }, regex: "qualified" } }, 1, 0],
              },
            },
            proposals: {
              $sum: {
                $cond: [{
                  $or: [
                    { $regexMatch: { input: { $toLower: { $ifNull: ["$stage",""] } }, regex: "proposal"  } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ["$stage",""] } }, regex: "quotation" } },
                  ],
                }, 1, 0],
              },
            },
            closed:       { $sum: { $cond: [isClosedExpr, 1, 0] } },
            revenue:      { $sum: { $cond: [isClosedExpr, { $ifNull: ["$dealValue", { $ifNull: ["$value", 0] }] }, 0] } },
            advanceTotal: { $sum: { $ifNull: ["$advanceReceived", 0] } },
            avgDeal:      { $avg: { $cond: [isClosedExpr, { $ifNull: ["$dealValue", { $ifNull: ["$value", 0] }] }, "$$REMOVE"] } },
            docsUploaded: { $sum: { $size: { $ifNull: ["$documents", []] } } },
          },
        },
        { $sort: { closed: -1, revenue: -1 } },
        { $limit: 50 },
      ]),

      // Recent activity
      Lead.find(Object.keys(matchStage).length ? matchStage : {})
        .sort({ updatedAt: -1 })
        .limit(20)
        .select("name repName rep branch status stage dealValue value history documents updatedAt createdAt")
        .lean(),

      // Branch comparison aggregation
      Lead.aggregate([
        ...(dateRange ? [{ $match: { createdAt: dateRange } }] : []),
        {
          $group: {
            _id:     { $ifNull: ["$branch", "Unknown"] },
            leads:   { $sum: 1 },
            closed:  { $sum: { $cond: [isClosedExpr, 1, 0] } },
            revenue: { $sum: { $cond: [isClosedExpr, { $ifNull: ["$dealValue", { $ifNull: ["$value", 0] }] }, 0] } },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
    ]);

    const leaderboard = repAgg.map(item => ({
      rep:          item._id.rep    || "Unassigned",
      branch:       item._id.branch || "Unknown",
      leads:        item.leads,
      contacted:    item.contacted,
      qualified:    item.qualified,
      proposals:    item.proposals,
      closed:       item.closed,
      revenue:      item.revenue,
      advanceTotal: item.advanceTotal || 0,
      avgDeal:      Math.round(item.avgDeal || 0),
      docsUploaded: item.docsUploaded,
      closeRate:    item.leads > 0 ? Number(((item.closed / item.leads) * 100).toFixed(0)) : 0,
    }));

    const topThree = leaderboard.slice(0, 3).map((item, i) => ({
      rank:    i + 1,
      name:    item.rep,
      branch:  item.branch,
      closed:  item.closed,
      revenue: item.revenue,
      closeRate: item.closeRate,
      leads:   item.leads,
      color:   i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : "#d97706",
      initials: String(item.rep || "U").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase(),
    }));

    // Summary KPIs
    const totalRevenue  = leaderboard.reduce((s, r) => s + r.revenue, 0);
    const totalClosed   = leaderboard.reduce((s, r) => s + r.closed,  0);
    const totalLeads    = leaderboard.reduce((s, r) => s + r.leads,   0);
    const activeReps    = leaderboard.filter(r => r.leads > 0).length;
    const avgCloseRate  = activeReps > 0 ? Math.round(leaderboard.reduce((s,r) => s + r.closeRate, 0) / activeReps) : 0;
    const topRep        = leaderboard[0]?.rep || "—";

    // Activity logs
    const activityLogs = [];
    for (const lead of recentLeads) {
      const repName  = (lead.repName || lead.rep || "Unassigned").trim();
      const isClosed = CLOSED_STAGES.includes(String(lead.status || "").toLowerCase());
      if (Array.isArray(lead.history)) {
        lead.history.slice(-2).forEach(item => {
          activityLogs.push({ rep: repName, text: item?.title || "Updated lead", meta: item?.meta || "", at: item?.at || lead.updatedAt, color: "#3b82f6" });
        });
      }
      if (Array.isArray(lead.documents) && lead.documents.length > 0) {
        const d = lead.documents[lead.documents.length - 1];
        activityLogs.push({ rep: repName, text: `uploaded ${d?.originalName || "document"}`, meta: "", at: d?.uploadedAt || lead.updatedAt, color: "#8b5cf6" });
      }
      if (isClosed) {
        const rev = Number(lead.dealValue || lead.value || 0);
        activityLogs.push({ rep: repName, text: `closed ${lead.name || "a deal"}`, meta: rev ? `₹${rev.toLocaleString("en-IN")}` : "", at: lead.updatedAt || lead.createdAt, color: "#10b981" });
      }
    }

    const recentActivity = activityLogs
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 10)
      .map(item => ({ ...item, timeAgo: formatTimeAgo(item.at) }));

    return res.status(200).json({
      success: true,
      data: {
        summary: { totalRevenue, totalClosed, totalLeads, activeReps, avgCloseRate, topRep },
        topThree,
        recentActivity,
        performanceBreakdown: leaderboard,
        branchComparison: branchAgg.map(b => ({ branch: b._id, leads: b.leads, closed: b.closed, revenue: b.revenue })),
        period,
        branch,
      },
    });
  } catch (error) {
    console.error("getLeaderboard error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leaderboard" });
  }
};

function formatTimeAgo(dateValue) {
  try {
    const diffMs = Date.now() - new Date(dateValue).getTime();
    const h = Math.floor(diffMs / 3_600_000);
    if (h < 1)  return "Just now";
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ""; }
}

export { getLeaderboard };

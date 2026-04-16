import Lead    from "../models/Lead.js";
import Expense from "../models/Expense.js";

/* ─── In-memory cache (2-minute TTL) ─────────────────────── */
const _cache   = new Map();
const CACHE_TTL = 120_000; // 2 minutes
function fromCache(key) {
  const hit = _cache.get(key);
  return hit && Date.now() - hit.ts < CACHE_TTL ? hit.data : null;
}
function setCache(key, data) { _cache.set(key, { ts: Date.now(), data }); }

const CLOSED_STAGES = ["closed","won","deal closed","closed won","job completed","completed","closed - won"];
const OPEN_STAGES   = ["lead capture","reachable","qualified","proposal"];

const isClosedExpr = { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, CLOSED_STAGES] };

const pct  = (n,d)  => d > 0 ? Number(((n/d)*100).toFixed(0)) : 0;
const safe = (n)    => Number(n) || 0;

const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const getBranchReports = async (req, res) => {
  try {
    const now   = new Date();
    const rawYear  = Number(req.query.year);
    const rawMonth = Number(req.query.month);
    const year  = Number.isFinite(rawYear)  ? rawYear  : null;
    const month = Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : null;

    const cacheKey = `branch-${year || "all"}-${month || "all"}`;
    const cached   = fromCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    // Date match for revenue (advances collected in period)
    const dateMatch = year && month
      ? { advanceReceivedDate: { $gte: new Date(year, month-1, 1), $lt: new Date(year, month, 1) }, advanceReceived: { $gt: 0 } }
      : year
      ? { advanceReceivedDate: { $gte: new Date(year, 0, 1), $lt: new Date(year+1, 0, 1) }, advanceReceived: { $gt: 0 } }
      : {};

    // Lead creation date match (for funnel counts)
    const leadDateMatch = year && month
      ? { createdAt: { $gte: new Date(year, month-1, 1), $lt: new Date(year, month, 1) } }
      : year
      ? { createdAt: { $gte: new Date(year, 0, 1), $lt: new Date(year+1, 0, 1) } }
      : {};

    // Last 6 months for trend
    const trendMonths = Array.from({length:6}, (_,i) => {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      return { y: d.getFullYear(), m: d.getMonth()+1 };
    }).reverse();
    const trendStart = new Date(trendMonths[0].y, trendMonths[0].m-1, 1);
    const trendEnd   = new Date(now.getFullYear(), now.getMonth()+1, 1);

    const [
      branchFunnel,      // 0 — funnel counts per branch (with date filter)
      branchRevAgg,      // 1 — revenue per branch (with date filter)
      priorityAgg,       // 2 — hot/warm/cold per branch
      sourceAgg,         // 3 — source per branch
      repAgg,            // 4 — rep performance per branch
      trendAgg,          // 5 — monthly revenue trend per branch
      stagePipelineAgg,  // 6 — stage distribution for pipeline view
      totalLeadsAll,     // 7 — total lead counts per branch (all time)
    ] = await Promise.all([

      // 0. Funnel counts per branch
      Lead.aggregate([
        ...(Object.keys(leadDateMatch).length ? [{ $match: leadDateMatch }] : []),
        { $group: {
          _id: { $ifNull: ["$branch", "Unknown"] },
          enquiries: { $sum: 1 },
          reachable: { $sum: { $cond: [
            { $or: [
              { $gt: [{ $size:{ $ifNull:["$commLogs",[]] } }, 0] },
              { $gt: [{ $size:{ $ifNull:["$followups",[]] } }, 0] },
            ]}, 1, 0
          ]}},
          qualified: { $sum: { $cond: [
            { $or: [
              { $regexMatch: { input:{ $toLower:{ $ifNull:["$stage",""] } }, regex:"qualified" } },
              { $gt: [{ $ifNull: ["$bantDetails.score", 0] }, 0] },
            ]}, 1, 0
          ]}},
          proposal: { $sum: { $cond: [
            { $or: [
              { $regexMatch: { input:{ $toLower:{ $ifNull:["$stage",""] } }, regex:"proposal"  } },
              { $regexMatch: { input:{ $toLower:{ $ifNull:["$stage",""] } }, regex:"quotation" } },
            ]}, 1, 0
          ]}},
          closed: { $sum: { $cond: [isClosedExpr, 1, 0] } },
        }},
        { $sort: { enquiries: -1 } },
      ]),

      // 1. Revenue per branch (from advances)
      Lead.aggregate([
        ...(Object.keys(dateMatch).length
          ? [{ $match: dateMatch }]
          : [{ $match: { advanceReceived: { $gt: 0 } } }]),
        { $group: {
          _id: { $ifNull: ["$branch","Unknown"] },
          revenue: { $sum: "$advanceReceived" },
          closedCount: { $sum: 1 },
        }},
      ]),

      // 2. Priority breakdown per branch
      Lead.aggregate([
        ...(Object.keys(leadDateMatch).length ? [{ $match: leadDateMatch }] : []),
        { $group: {
          _id: { branch: { $ifNull:["$branch","Unknown"] }, priority: { $ifNull:["$priority","Cold"] } },
          count: { $sum: 1 },
        }},
      ]),

      // 3. Source breakdown per branch
      Lead.aggregate([
        ...(Object.keys(leadDateMatch).length ? [{ $match: leadDateMatch }] : []),
        { $group: {
          _id: { branch: { $ifNull:["$branch","Unknown"] }, source: { $ifNull:["$source","Other"] } },
          count: { $sum: 1 },
        }},
      ]),

      // 4. Top rep per branch (by closed deals)
      Lead.aggregate([
        { $match: { $expr: isClosedExpr, rep: { $ne: null, $ne: "" } } },
        { $group: {
          _id: { branch: { $ifNull:["$branch","Unknown"] }, rep: "$rep" },
          closed: { $sum: 1 },
          revenue: { $sum: { $ifNull:["$advanceReceived",0] } },
        }},
        { $sort: { closed: -1 } },
        { $group: {
          _id: "$_id.branch",
          topRep:     { $first: "$_id.rep" },
          topRepDeals:{ $first: "$closed" },
          topRepRev:  { $first: "$revenue" },
          allReps:    { $push: { rep:"$_id.rep", closed:"$closed", revenue:"$revenue" } },
        }},
      ]),

      // 5. 6-month revenue trend per branch
      Lead.aggregate([
        { $match: { advanceReceivedDate: { $gte: trendStart, $lt: trendEnd }, advanceReceived: { $gt: 0 } } },
        { $group: {
          _id: {
            y: { $year:"$advanceReceivedDate" },
            m: { $month:"$advanceReceivedDate" },
            branch: { $ifNull:["$branch","Unknown"] },
          },
          revenue: { $sum: "$advanceReceived" },
          deals:   { $sum: 1 },
        }},
      ]),

      // 6. Full stage distribution per branch (pipeline view)
      Lead.aggregate([
        ...(Object.keys(leadDateMatch).length ? [{ $match: leadDateMatch }] : []),
        { $group: {
          _id: { branch: { $ifNull:["$branch","Unknown"] }, stage: { $ifNull:["$stage","Unknown"] } },
          count: { $sum: 1 },
          value: { $sum: { $ifNull:["$value",0] } },
        }},
      ]),

      // 7. Total lead count per branch (all time)
      Lead.aggregate([
        { $group: {
          _id: { $ifNull:["$branch","Unknown"] },
          total: { $sum: 1 },
        }},
      ]),
    ]);

    // ── Merge all aggregations into per-branch objects ─────────────────────
    const branchMap = {};

    // Funnel
    branchFunnel.forEach(b => {
      branchMap[b._id] = {
        name: b._id,
        enquiries: b.enquiries, reachable: b.reachable,
        qualified: b.qualified, proposal: b.proposal, closed: b.closed,
        revenue: 0, closedCount: 0,
        byPriority: {}, bySource: {},
        topRep: null, topRepDeals: 0, topRepRev: 0, allReps: [],
        stageMap: {},
      };
    });

    // Revenue
    branchRevAgg.forEach(b => {
      if (!branchMap[b._id]) branchMap[b._id] = { name:b._id, enquiries:0, reachable:0, qualified:0, proposal:0, closed:0, byPriority:{}, bySource:{}, topRep:null, topRepDeals:0, topRepRev:0, allReps:[], stageMap:{} };
      branchMap[b._id].revenue     = b.revenue;
      branchMap[b._id].closedCount = b.closedCount;
    });

    // Priority
    priorityAgg.forEach(({ _id, count }) => {
      const bm = branchMap[_id.branch];
      if (bm) bm.byPriority[_id.priority] = count;
    });

    // Source
    sourceAgg.forEach(({ _id, count }) => {
      const bm = branchMap[_id.branch];
      if (bm) bm.bySource[_id.source] = count;
    });

    // Reps
    repAgg.forEach(r => {
      const bm = branchMap[r._id];
      if (bm) { bm.topRep = r.topRep; bm.topRepDeals = r.topRepDeals; bm.topRepRev = r.topRepRev; bm.allReps = r.allReps; }
    });

    // Stage distribution
    stagePipelineAgg.forEach(({ _id, count, value }) => {
      const bm = branchMap[_id.branch];
      if (bm) bm.stageMap[_id.stage] = { count, value };
    });

    // All-time totals
    totalLeadsAll.forEach(b => {
      const bm = branchMap[b._id];
      if (bm) bm.allTimeLeads = b.total;
    });

    // ── Sort by revenue ────────────────────────────────────────────────────
    const allBranches = Object.values(branchMap).sort((a,b) => b.revenue - a.revenue);

    const best   = allBranches.reduce((a,b) => !a || pct(b.closed,b.enquiries) > pct(a.closed,a.enquiries) ? b : a, null)?.name;
    const lowest = allBranches.reduce((a,b) => !a || pct(b.closed,b.enquiries) < pct(a.closed,a.enquiries) ? b : a, null)?.name;

    const branches = allBranches.map(b => ({
      name:         b.name,
      enquiries:    b.enquiries,
      reachable:    b.reachable,
      qualified:    b.qualified,
      proposal:     b.proposal,
      closed:       b.closed,
      revenue:      b.revenue,
      allTimeLeads: b.allTimeLeads || 0,
      reachability: pct(b.reachable, b.enquiries),
      qualification:pct(b.qualified, b.enquiries),
      proposalConv: pct(b.proposal,  b.enquiries),
      closeRate:    pct(b.closed,    b.enquiries),
      revPerEnquiry:b.enquiries > 0 ? Math.round(b.revenue / b.enquiries) : 0,
      avgDealValue: b.closed    > 0 ? Math.round(b.revenue / b.closed)    : 0,
      winRate:      pct(b.closed, b.proposal || 1),
      byPriority:   b.byPriority,
      bySource:     b.bySource,
      topRep:       b.topRep,
      topRepDeals:  b.topRepDeals,
      topRepRev:    b.topRepRev,
      allReps:      (b.allReps || []).slice(0,5),
      stageMap:     b.stageMap,
      tag:  b.name === best   ? "Best"   : b.name === lowest ? "Needs Work" : "",
      note: b.name === best   ? "Best close rate across all branches."
          : b.name === lowest ? "Low conversion — focus on first contact reachability."
          :                     "Consistent performer — optimize proposal conversion.",
    }));

    // ── Summary ────────────────────────────────────────────────────────────
    const totals = branches.reduce((acc,b) => {
      acc.enquiries += b.enquiries; acc.reachable += b.reachable;
      acc.qualified += b.qualified; acc.proposal  += b.proposal;
      acc.closed    += b.closed;    acc.revenue   += b.revenue;
      return acc;
    }, { enquiries:0, reachable:0, qualified:0, proposal:0, closed:0, revenue:0 });

    const summary = {
      totalLeads:    totals.enquiries,
      totalClosed:   totals.closed,
      totalRevenue:  totals.revenue,
      reachability:  pct(totals.reachable, totals.enquiries),
      qualification: pct(totals.qualified, totals.enquiries),
      proposalConv:  pct(totals.proposal,  totals.enquiries),
      closeRate:     pct(totals.closed,    totals.enquiries),
      revPerEnquiry: totals.enquiries > 0 ? Math.round(totals.revenue / totals.enquiries) : 0,
      avgDealValue:  totals.closed    > 0 ? Math.round(totals.revenue / totals.closed)    : 0,
    };

    // ── Monthly trend series ───────────────────────────────────────────────
    const trendMap = {};  // "Y-M-branch" → { revenue, deals }
    trendAgg.forEach(({ _id, revenue, deals }) => {
      trendMap[`${_id.y}-${_id.m}-${_id.branch}`] = { revenue, deals };
    });

    const branchNames = branches.map(b => b.name);
    const monthlyTrend = trendMonths.map(({ y, m }) => {
      const row = { month: MN[m-1], year: y };
      branchNames.forEach(name => {
        const k = `${y}-${m}-${name}`;
        row[name]            = trendMap[k]?.revenue || 0;
        row[`${name}_deals`] = trendMap[k]?.deals   || 0;
      });
      return row;
    });

    const responseData = {
      success: true,
      data: {
        meta: { year, month, branchNames },
        summary,
        branches,
        monthlyTrend,
        revenueProjection: {
          currentRevenue:  totals.revenue,
          optimizedTarget: Math.round(totals.revenue * 1.5),
          potentialUplift: Math.round(totals.revenue * 0.5),
          currentDeals:    totals.closed,
          targetDeals:     Math.round(totals.closed * 2.05),
        },
      },
    };

    setCache(cacheKey, responseData);
    return res.status(200).json(responseData);
  } catch (error) {
    console.error("getBranchReports error:", error);
    return res.status(500).json({ success:false, message:"Failed to fetch branch reports" });
  }
};

export { getBranchReports };

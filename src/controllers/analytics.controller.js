import Lead   from "../models/Lead.js";
import Target from "../models/Target.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTH_NAMES  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES    = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const CLOSED_STAGES = ["closed","won","deal closed","closed won","job completed","completed","closed - won"];
const isClosedExpr  = { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, CLOSED_STAGES] };
const isLostExpr    = { $in: [{ $toLower: { $ifNull: ["$status",""] } }, ["lost","dead","cold","cancelled"]] };

// ─── Industry benchmarks for Indian creative/digital services agencies ────────
export const INDUSTRY_BENCHMARKS = {
  convRate:         { industry: 18, top: 32,  unit: "%",   label: "Lead Conversion Rate",       lowerIsBetter: false },
  salesCycleDays:   { industry: 28, top: 14,  unit: "days",label: "Avg Sales Cycle",            lowerIsBetter: true  },
  advanceRate:      { industry: 48, top: 72,  unit: "%",   label: "Advance Collection Rate",    lowerIsBetter: false },
  completionRate:   { industry: 74, top: 92,  unit: "%",   label: "Job Completion Rate",        lowerIsBetter: false },
  revenueGrowthMoM: { industry: 8,  top: 22,  unit: "%",   label: "Monthly Revenue Growth",     lowerIsBetter: false },
  avgDealSize:      { industry: 85000, top: 250000, unit: "₹", label: "Avg Deal Size",          lowerIsBetter: false },
  revPerLead:       { industry: 12000, top: 38000,  unit: "₹", label: "Revenue per Lead",       lowerIsBetter: false },
  staleRate:        { industry: 20, top: 8,   unit: "%",   label: "Stale Pipeline Rate",        lowerIsBetter: true  },
};

// ─── 10-minute cache + request coalescing for analytics ──────────────────────
const _analyticsCache = new Map();
const ANALYTICS_CACHE_TTL = 10 * 60_000; // 10 minutes
const _analyticsPending = new Map();

function analyticsCacheGet(key) {
  const entry = _analyticsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ANALYTICS_CACHE_TTL) { _analyticsCache.delete(key); return null; }
  return entry.data;
}
function analyticsCacheSet(key, data) {
  _analyticsCache.set(key, { ts: Date.now(), data });
}
export function clearAnalyticsCache() {
  _analyticsCache.clear();
  _analyticsPending.clear();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getLastNMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return {
      key:      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,
      month:    MONTH_NAMES[d.getMonth()],
      year:     d.getFullYear(),
      monthNum: d.getMonth()+1,
    };
  });
}
function getNextNMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`, month: MONTH_NAMES[d.getMonth()] + " " + d.getFullYear() };
  });
}
function linearRegression(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  const sumX = (n*(n-1))/2, sumX2 = ((n-1)*n*(2*n-1))/6;
  const sumY = values.reduce((a,v)=>a+v,0), sumXY = values.reduce((a,v,i)=>a+i*v,0);
  const denom = n*sumX2 - sumX*sumX;
  if (!denom) return { slope: 0, intercept: sumY/n };
  const slope = (n*sumXY - sumX*sumY)/denom;
  return { slope, intercept: (sumY - slope*sumX)/n };
}
function healthGrade(score) {
  if (score >= 80) return { label:"Excellent", color:"#10b981" };
  if (score >= 65) return { label:"Good",      color:"#3b82f6" };
  if (score >= 45) return { label:"Fair",      color:"#f59e0b" };
  return                   { label:"Needs Work",color:"#ef4444" };
}

// ─── 1. Legacy endpoint (with caching) ────────────────────────────────────────
export const getAnalytics = async (req, res) => {
  try {
    const cacheKey = "analytics-basic";
    const cached = analyticsCacheGet(cacheKey);
    if (cached) return res.status(200).json(cached);

    if (_analyticsPending.has(cacheKey)) {
      const result = await _analyticsPending.get(cacheKey);
      return res.status(200).json(result);
    }

    const fetchPromise = _fetchAnalytics();
    _analyticsPending.set(cacheKey, fetchPromise);
    fetchPromise.finally(() => _analyticsPending.delete(cacheKey));

    const result = await fetchPromise;
    analyticsCacheSet(cacheKey, result);
    return res.status(200).json(result);
  } catch(error){
    console.error("getAnalytics error:",error);
    return res.status(500).json({success:false,message:"Failed to fetch analytics",error:error?.message});
  }
};

async function _fetchAnalytics() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth()-6);
    sixMonthsAgo.setDate(1); sixMonthsAgo.setHours(0,0,0,0);

    const [totalsAgg, monthlyAgg, branchAgg, sourceAgg, stageTimingAgg, repAgg, trendAgg] = await Promise.all([
      Lead.aggregate([{$group:{_id:null,total:{$sum:1},revenue:{$sum:{$ifNull:["$value",0]}},closed:{$sum:{$cond:[isClosedExpr,1,0]}}}}]),
      Lead.aggregate([{$match:{createdAt:{$gte:sixMonthsAgo}}},{$group:{_id:{year:{$year:"$createdAt"},month:{$month:"$createdAt"}},enquiries:{$sum:1},closed:{$sum:{$cond:[isClosedExpr,1,0]}}}},{$sort:{"_id.year":1,"_id.month":1}}]),
      Lead.aggregate([{$match:{value:{$gt:0}}},{$group:{_id:{$ifNull:["$branch","Unknown"]},value:{$sum:"$value"}}},{$sort:{value:-1}},{$limit:10}]),
      Lead.aggregate([{$group:{_id:{$ifNull:["$source","Unknown"]},total:{$sum:1},converted:{$sum:{$cond:[isClosedExpr,1,0]}}}},{$sort:{total:-1}},{$limit:20}]),
      Lead.aggregate([{$group:{_id:null,avgNew:{$avg:{$ifNull:["$stageTimings.new",0]}},avgQualified:{$avg:{$ifNull:["$stageTimings.qualified",0]}},avgProposal:{$avg:{$ifNull:["$stageTimings.proposal",0]}},avgNegotiation:{$avg:{$ifNull:["$stageTimings.negotiation",0]}},avgClosed:{$avg:{$ifNull:["$stageTimings.closed",0]}}}}]),
      Lead.aggregate([{$group:{_id:{rep:{$ifNull:["$repName",{$ifNull:["$rep","Unassigned"]}]},branch:{$ifNull:["$branch","Unknown"]}},totalLeads:{$sum:1},revenue:{$sum:{$ifNull:["$value",0]}},closedDeals:{$sum:{$cond:[isClosedExpr,1,0]}}}},{$sort:{revenue:-1}},{$limit:10}]),
      Lead.aggregate([{$match:{createdAt:{$gte:sixMonthsAgo}}},{$group:{_id:{branch:{$ifNull:["$branch","Unknown"]},year:{$year:"$createdAt"},month:{$month:"$createdAt"}},total:{$sum:1},closed:{$sum:{$cond:[isClosedExpr,1,0]}}}}]),
    ]);

    const monthTemplate = getLastNMonths(6);
    const raw = totalsAgg[0]||{total:0,revenue:0,closed:0};
    const monthlyMap={};
    monthlyAgg.forEach(({_id,enquiries,closed})=>{monthlyMap[`${_id.year}-${String(_id.month).padStart(2,"0")}`]={enquiries,closed};});
    const monthlyEnquiriesVsClosed = monthTemplate.map(({key,month})=>({month,enquiries:monthlyMap[key]?.enquiries||0,closed:monthlyMap[key]?.closed||0}));
    const revenueByBranch = branchAgg.map(({_id,value})=>({name:_id||"Unknown",value}));
    const leadSourceConversion = sourceAgg.map(({_id,total,converted})=>({source:_id||"Unknown",total,converted,rate:total>0?Number(((converted/total)*100).toFixed(1)):0})).sort((a,b)=>b.rate-a.rate);
    const t = stageTimingAgg[0]||{};
    const avgDaysPerStage = [{stage:"Lead Capture",days:Number((t.avgNew||0).toFixed(1))},{stage:"Qualified",days:Number((t.avgQualified||0).toFixed(1))},{stage:"Proposal",days:Number((t.avgProposal||0).toFixed(1))},{stage:"Negotiation",days:Number((t.avgNegotiation||0).toFixed(1))},{stage:"Closed",days:Number((t.avgClosed||0).toFixed(1))}];
    const topReps = repAgg.slice(0,6).map(({_id,totalLeads,revenue,closedDeals})=>({name:_id.rep||"Unassigned",branch:_id.branch||"Unknown",totalLeads,closedDeals,revenue,conversion:totalLeads>0?Number(((closedDeals/totalLeads)*100).toFixed(1)):0}));
    const branchesInTrend=[...new Set(trendAgg.map(d=>d._id.branch).filter(Boolean))].slice(0,5);
    const trendMap={};
    trendAgg.forEach(({_id,total,closed})=>{const key=`${_id.year}-${String(_id.month).padStart(2,"0")}`;if(!trendMap[key])trendMap[key]={};trendMap[key][_id.branch]={total,closed};});
    const conversionRateTrend=monthTemplate.map(({key,month})=>{const row={month};branchesInTrend.forEach(branch=>{const s=trendMap[key]?.[branch]||{total:0,closed:0};row[branch]=s.total>0?Number(((s.closed/s.total)*100).toFixed(1)):0;});return row;});

    return {success:true,message:"Analytics fetched successfully",data:{totals:{totalLeads:raw.total,totalClosed:raw.closed,totalRevenue:raw.revenue,avgConversion:raw.total>0?Number(((raw.closed/raw.total)*100).toFixed(1)):0},monthlyEnquiriesVsClosed,revenueByBranch,conversionRateTrend,leadSourceConversion,avgDaysPerStage,topReps}};
}

// ─── 2. Advanced intelligence endpoint ────────────────────────────────────────
export const getAdvancedAnalytics = async (req, res) => {
  try {
    const { branch, months = "12" } = req.query;
    const cacheKey = `analytics-advanced-${branch || "all"}-${months}`;
    const cached = analyticsCacheGet(cacheKey);
    if (cached) return res.json(cached);

    if (_analyticsPending.has(cacheKey)) {
      const result = await _analyticsPending.get(cacheKey);
      return res.json(result);
    }

    const fetchPromise = _fetchAdvancedAnalytics(branch, months);
    _analyticsPending.set(cacheKey, fetchPromise);
    fetchPromise.finally(() => _analyticsPending.delete(cacheKey));

    const result = await fetchPromise;
    analyticsCacheSet(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error("getAdvancedAnalytics error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

async function _fetchAdvancedAnalytics(branch, months = "12") {
    const nMonths       = Math.min(Math.max(Number(months)||12, 3), 24);
    const matchBase     = branch ? { branch } : {};
    const now           = new Date();
    const staleThresh   = new Date(now - 30 * 86400000);
    const freshThresh   = new Date(now - 14 * 86400000);
    const startDate     = new Date(now.getFullYear(), now.getMonth() - (nMonths-1), 1);
    const prevMonthStart= new Date(now.getFullYear(), now.getMonth()-1, 1);
    const thisMonthStart= new Date(now.getFullYear(), now.getMonth(),   1);

    const [
      totalsAgg,
      monthlyAgg,
      closedDealsAgg,
      sourceMatrixAgg,
      repMatrixAgg,
      dealBucketsAgg,
      staleAgg,
      freshnessAgg,
      weekdayAgg,
      lostStageAgg,
      pipelineFlowAgg,
    ] = await Promise.all([

      // Global totals + this/prev month
      Lead.aggregate([
        { $match: matchBase },
        { $group: {
          _id: null,
          totalLeads:     { $sum: 1 },
          totalRevenue:   { $sum: { $ifNull: ["$value", 0] } },
          totalClosed:    { $sum: { $cond: [isClosedExpr, 1, 0] } },
          totalAdvances:  { $sum: { $ifNull: ["$advanceReceived", 0] } },
          advanceCount:   { $sum: { $cond: [{ $gt: [{ $ifNull:["$advanceReceived",0] }, 0] }, 1, 0] } },
          completedCount: { $sum: { $cond: [{ $eq: ["$projectCompleted", true] }, 1, 0] } },
          thisMonthLeads: { $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, 1, 0] } },
          thisMonthRev:   { $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, { $ifNull:["$value",0] }, 0] } },
          thisMonthClosed:{ $sum: { $cond: [{ $and: [{ $gte:["$createdAt",thisMonthStart] }, isClosedExpr] }, 1, 0] } },
          prevMonthLeads: { $sum: { $cond: [{ $and:[{$gte:["$createdAt",prevMonthStart]},{$lt:["$createdAt",thisMonthStart]}] }, 1, 0] } },
          prevMonthRev:   { $sum: { $cond: [{ $and:[{$gte:["$createdAt",prevMonthStart]},{$lt:["$createdAt",thisMonthStart]}] }, { $ifNull:["$value",0] }, 0] } },
          prevMonthClosed:{ $sum: { $cond: [{ $and:[{$gte:["$createdAt",prevMonthStart]},{$lt:["$createdAt",thisMonthStart]},isClosedExpr] }, 1, 0] } },
        }},
      ]),

      // Monthly series (last N months) with targets
      Lead.aggregate([
        { $match: { ...matchBase, createdAt: { $gte: startDate } } },
        { $group: {
          _id:      { year:{ $year:"$createdAt" }, month:{ $month:"$createdAt" } },
          leads:    { $sum: 1 },
          closed:   { $sum: { $cond: [isClosedExpr, 1, 0] } },
          lost:     { $sum: { $cond: [isLostExpr,   1, 0] } },
          revenue:  { $sum: { $ifNull: ["$value", 0] } },
          advances: { $sum: { $ifNull: ["$advanceReceived", 0] } },
        }},
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),

      // Closed deals: avg size, avg cycle time, velocity components
      Lead.aggregate([
        { $match: { ...matchBase, $expr: isClosedExpr } },
        { $group: {
          _id:          null,
          count:        { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$value", 0] } },
          avgDealSize:  { $avg: { $ifNull: ["$value", 0] } },
          avgCycleDays: { $avg: {
            $add: [
              { $ifNull: ["$stageTimings.new",         0] },
              { $ifNull: ["$stageTimings.qualified",   0] },
              { $ifNull: ["$stageTimings.proposal",    0] },
              { $ifNull: ["$stageTimings.negotiation", 0] },
              { $ifNull: ["$stageTimings.closed",      0] },
            ],
          }},
        }},
      ]),

      // Source matrix: volume × conversion × revenue (for quadrant + Pareto)
      Lead.aggregate([
        { $match: matchBase },
        { $group: {
          _id:       { $ifNull: ["$source", "Unknown"] },
          total:     { $sum: 1 },
          closed:    { $sum: { $cond: [isClosedExpr, 1, 0] } },
          lost:      { $sum: { $cond: [isLostExpr,   1, 0] } },
          revenue:   { $sum: { $ifNull: ["$value", 0] } },
          advances:  { $sum: { $ifNull: ["$advanceReceived", 0] } },
        }},
        { $sort: { revenue: -1 } },
        { $limit: 20 },
      ]),

      // Rep performance matrix
      Lead.aggregate([
        { $match: matchBase },
        { $group: {
          _id:       { $ifNull: ["$repName", { $ifNull: ["$rep", "Unassigned"] }] },
          total:     { $sum: 1 },
          closed:    { $sum: { $cond: [isClosedExpr, 1, 0] } },
          revenue:   { $sum: { $ifNull: ["$value", 0] } },
          advances:  { $sum: { $ifNull: ["$advanceReceived", 0] } },
          staleCount:{ $sum: {
            $cond: [{ $and:[
              { $lt: ["$updatedAt", staleThresh] },
              { $not: { $in: [{ $toLower:{$ifNull:["$stage",""]} }, CLOSED_STAGES] } },
            ]}, 1, 0],
          }},
          avgDealSize:{ $avg: { $cond: [isClosedExpr, { $ifNull:["$value",0] }, null] } },
        }},
        { $sort: { revenue: -1 } },
      ]),

      // Deal size distribution buckets
      Lead.aggregate([
        { $match: { ...matchBase, value: { $gt: 0 } } },
        { $bucket: {
          groupBy:    "$value",
          boundaries: [1, 25000, 75000, 200000, 500000, 1500000],
          default:    "15L+",
          output: {
            count:    { $sum: 1 },
            revenue:  { $sum: "$value" },
            closed:   { $sum: { $cond: [isClosedExpr, 1, 0] } },
          },
        }},
      ]),

      // Stale leads (>30 days no update, not closed)
      Lead.aggregate([
        { $match: {
          ...matchBase,
          updatedAt: { $lt: staleThresh },
          $expr: { $not: { $in: [{ $toLower:{$ifNull:["$stage",""]} }, CLOSED_STAGES] } },
        }},
        { $group: {
          _id:          "$stage",
          count:        { $sum: 1 },
          value:        { $sum: { $ifNull: ["$value", 0] } },
          avgStaleDays: { $avg: { $divide: [{ $subtract:[now,"$updatedAt"] }, 86400000] } },
        }},
        { $sort: { value: -1 } },
      ]),

      // Pipeline freshness (updated in last 14 days, not closed)
      Lead.aggregate([
        { $match: {
          ...matchBase,
          $expr: { $not: { $in: [{ $toLower:{$ifNull:["$stage",""]} }, CLOSED_STAGES] } },
        }},
        { $group: {
          _id:   null,
          total: { $sum: 1 },
          fresh: { $sum: { $cond:[{ $gte:["$updatedAt", freshThresh] }, 1, 0] } },
          stale: { $sum: { $cond:[{ $lt: ["$updatedAt", staleThresh]  }, 1, 0] } },
          staleValue: { $sum: { $cond:[{ $lt:["$updatedAt",staleThresh] }, { $ifNull:["$value",0] }, 0] } },
        }},
      ]),

      // Lead creation by weekday
      Lead.aggregate([
        { $match: { ...matchBase, createdAt: { $gte: startDate } } },
        { $group: {
          _id:     { $dayOfWeek: "$createdAt" }, // 1=Sun..7=Sat
          leads:   { $sum: 1 },
          closed:  { $sum: { $cond: [isClosedExpr, 1, 0] } },
          revenue: { $sum: { $ifNull: ["$value", 0] } },
        }},
        { $sort: { "_id": 1 } },
      ]),

      // Where leads are getting lost (by stage)
      Lead.aggregate([
        { $match: { ...matchBase, $expr: isLostExpr } },
        { $group: {
          _id:   "$stage",
          count: { $sum: 1 },
          value: { $sum: { $ifNull: ["$value", 0] } },
        }},
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Pipeline flow: advance → started → completed
      Lead.aggregate([
        { $match: matchBase },
        { $group: {
          _id:              null,
          totalLeads:       { $sum: 1 },
          advanceCount:     { $sum: { $cond:[{ $gt:[{$ifNull:["$advanceReceived",0]},0] }, 1, 0] } },
          advanceAmount:    { $sum: { $ifNull: ["$advanceReceived", 0] } },
          startedCount:     { $sum: { $cond:[{ $and:[{$ne:["$projectStartDate",null]},{$ne:["$projectStartDate",""]}] }, 1, 0] } },
          completedCount:   { $sum: { $cond:[{ $eq:["$projectCompleted",true] }, 1, 0] } },
          completedRevenue: { $sum: { $cond:[{ $eq:["$projectCompleted",true] }, {$ifNull:["$value",0]}, 0] } },
          pendingBalance:   { $sum: {
            $cond: [
              { $and: [{ $gt:[{$ifNull:["$advanceReceived",0]},0] }, {$ne:["$projectCompleted",true]}] },
              { $subtract: [{$ifNull:["$value",0]},{$ifNull:["$advanceReceived",0]}] },
              0,
            ],
          }},
        }},
      ]),
    ]);

    // ── Fetch targets ─────────────────────────────────────────
    const monthTemplate = getLastNMonths(nMonths);
    const targetDocs    = await Target.find({
      $or: monthTemplate.map(m => ({ month: m.monthNum, year: m.year, branch: branch||"" })),
    }).lean();
    const targetMap = {};
    targetDocs.forEach(t => { targetMap[`${t.year}-${String(t.month).padStart(2,"0")}`] = t; });

    // ── Monthly series ────────────────────────────────────────
    const seriesMap = {};
    monthlyAgg.forEach(({_id, leads, closed, lost, revenue, advances}) => {
      seriesMap[`${_id.year}-${String(_id.month).padStart(2,"0")}`] = {leads,closed,lost,revenue,advances};
    });
    const monthlySeries = monthTemplate.map(({key, month}) => {
      const d = seriesMap[key] || {leads:0,closed:0,lost:0,revenue:0,advances:0};
      const t = targetMap[key]  || {};
      return {
        month, key,
        leads: d.leads, closed: d.closed, lost: d.lost,
        revenue: d.revenue, advances: d.advances,
        revenueTarget:      t.revenueTarget      || 0,
        leadsTarget:        t.leadsTarget        || 0,
        closedDealsTarget:  t.closedDealsTarget  || 0,
        advanceTarget:      t.advanceTarget      || 0,
      };
    });

    // ── Core metrics ──────────────────────────────────────────
    const G       = totalsAgg[0] || {};
    const CD      = closedDealsAgg[0] || {};
    const FR      = freshnessAgg[0]   || { total:0, fresh:0, stale:0, staleValue:0 };
    const PF      = pipelineFlowAgg[0]|| {};

    const convRate      = G.totalLeads > 0 ? (G.totalClosed / G.totalLeads * 100) : 0;
    const advanceRate   = G.totalLeads > 0 ? (G.advanceCount / G.totalLeads * 100) : 0;
    const completionRate= G.advanceCount> 0 ? (G.completedCount / G.advanceCount * 100) : 0;
    const avgDealSize   = CD.avgDealSize   || 0;
    const avgCycleDays  = CD.avgCycleDays  || 0;
    const revPerLead    = G.totalLeads > 0 ? G.totalRevenue / G.totalLeads : 0;
    const staleRatePct  = FR.total > 0     ? (FR.stale / FR.total * 100) : 0;
    const freshnessPct  = FR.total > 0     ? (FR.fresh / FR.total * 100) : 0;

    // Month-over-month
    const momLeads  = G.prevMonthLeads  > 0 ? ((G.thisMonthLeads  - G.prevMonthLeads ) / G.prevMonthLeads  * 100) : 0;
    const momRev    = G.prevMonthRev    > 0 ? ((G.thisMonthRev    - G.prevMonthRev   ) / G.prevMonthRev    * 100) : 0;
    const momClosed = G.prevMonthClosed > 0 ? ((G.thisMonthClosed - G.prevMonthClosed) / G.prevMonthClosed * 100) : 0;

    // Pipeline velocity = (closed deals/month × avgDealSize × convRate%) / avgCycleDays
    // Expressed as ₹ per day flowing through pipeline
    const avgClosedPerMonth = monthlySeries.reduce((s,d)=>s+d.closed,0) / (nMonths||1);
    const velocity = avgCycleDays > 0
      ? Math.round((avgClosedPerMonth * avgDealSize) / avgCycleDays)
      : 0;

    // ── Health Score (0-100) ──────────────────────────────────
    const BM = INDUSTRY_BENCHMARKS;
    const scoreConv       = Math.min(30, (convRate    / BM.convRate.top)         * 30);
    const scoreGrowth     = momRev >= 0 ? Math.min(20, (momRev    / BM.revenueGrowthMoM.top) * 20) : Math.max(0, 10 + (momRev/BM.revenueGrowthMoM.top)*10);
    const scoreFreshness  = Math.min(25, (freshnessPct / 80) * 25);
    const scoreAdvance    = Math.min(15, (advanceRate  / BM.advanceRate.top)     * 15);
    const scoreCompletion = Math.min(10, (completionRate/ BM.completionRate.top) * 10);
    const healthScore     = Math.round(scoreConv + scoreGrowth + scoreFreshness + scoreAdvance + scoreCompletion);
    const { label: healthLabel, color: healthColor } = healthGrade(healthScore);

    // ── Benchmark comparison ─────────────────────────────────
    const yourMetrics = {
      convRate:         Number(convRate.toFixed(1)),
      salesCycleDays:   Number(avgCycleDays.toFixed(1)),
      advanceRate:      Number(advanceRate.toFixed(1)),
      completionRate:   Number(completionRate.toFixed(1)),
      revenueGrowthMoM: Number(momRev.toFixed(1)),
      avgDealSize:      Math.round(avgDealSize),
      revPerLead:       Math.round(revPerLead),
      staleRate:        Number(staleRatePct.toFixed(1)),
    };

    // Radar data (normalize to 0-100 scale vs top performers)
    const radarData = Object.entries(BM).map(([key, bm]) => {
      const yours = yourMetrics[key] || 0;
      const scaleMax = bm.lowerIsBetter ? bm.industry * 2 : bm.top * 1.2;
      const normalize = (v) => bm.lowerIsBetter
        ? Math.max(0, Math.min(100, 100 - (v / scaleMax) * 100))
        : Math.max(0, Math.min(100, (v / scaleMax) * 100));
      return {
        metric:    bm.label,
        You:       Math.round(normalize(yours)),
        Industry:  Math.round(normalize(bm.industry)),
        TopPlayer: 100,
        rawYou:    yours,
        rawIndustry: bm.industry,
        rawTop:    bm.top,
        unit:      bm.unit,
        lowerIsBetter: bm.lowerIsBetter,
      };
    });

    // ── Source matrix (quadrant + Pareto) ────────────────────
    let cumulativeRev = 0;
    const totalSourceRev = sourceMatrixAgg.reduce((s,r)=>s+r.revenue,0)||1;
    const sourceMatrix = sourceMatrixAgg.map(({_id, total, closed, lost, revenue, advances}) => {
      cumulativeRev += revenue;
      return {
        source:      _id||"Unknown",
        total,   closed,   lost,
        revenue: Math.round(revenue),
        advances: Math.round(advances),
        convRate:  total>0 ? Number((closed/total*100).toFixed(1)):0,
        lossRate:  total>0 ? Number((lost/total*100).toFixed(1)):0,
        revPerLead:total>0 ? Math.round(revenue/total):0,
        cumRevPct: Number((cumulativeRev/totalSourceRev*100).toFixed(1)),
      };
    });

    // Scaling opportunity: sources with conv > industry avg but below median volume
    const medianVolume = sourceMatrix.length > 0
      ? sourceMatrix.slice().sort((a,b)=>a.total-b.total)[Math.floor(sourceMatrix.length/2)]?.total || 1
      : 1;
    const scalingOpps = sourceMatrix
      .filter(s => s.convRate > BM.convRate.industry && s.total < medianVolume && s.total > 0)
      .sort((a,b) => b.revPerLead - a.revPerLead)
      .slice(0, 5)
      .map(s => ({
        ...s,
        upside: Math.round(s.revPerLead * medianVolume), // estimated revenue if volume doubled to median
        gapLeads: medianVolume - s.total,
      }));

    // ── Rep matrix ────────────────────────────────────────────
    const avgLeadsPerRep = repMatrixAgg.length > 0
      ? repMatrixAgg.reduce((s,r)=>s+r.total,0) / repMatrixAgg.length
      : 0;
    const repMatrix = repMatrixAgg.map(({_id, total, closed, revenue, advances, staleCount, avgDealSize:rds}) => ({
      rep:        _id||"Unassigned",
      total,      closed,
      revenue:    Math.round(revenue),
      advances:   Math.round(advances),
      staleCount,
      avgDealSize: Math.round(rds||0),
      convRate:   total>0 ? Number((closed/total*100).toFixed(1)):0,
      capacity:   total < avgLeadsPerRep * 0.7 ? "Under" : total > avgLeadsPerRep * 1.3 ? "Over" : "Optimal",
    }));

    // ── Deal buckets ──────────────────────────────────────────
    const BUCKET_LABELS = ["<₹25K","₹25K-75K","₹75K-2L","₹2L-5L","₹5L-15L","₹15L+"];
    const dealBuckets = dealBucketsAgg.map((b, i) => ({
      range:    BUCKET_LABELS[i] || "15L+",
      count:    b.count,
      revenue:  Math.round(b.revenue),
      closed:   b.closed,
      convRate: b.count>0 ? Number((b.closed/b.count*100).toFixed(1)):0,
    }));

    // ── Weekday pattern ───────────────────────────────────────
    const weekdays = Array.from({length:7},(_,i)=>({day:DAY_NAMES[i],leads:0,closed:0,revenue:0}));
    weekdayAgg.forEach(({_id,leads,closed,revenue})=>{
      const idx=(_id-1+7)%7;
      weekdays[idx]={day:DAY_NAMES[idx],leads,closed,revenue:Math.round(revenue)};
    });

    // ── Prediction ────────────────────────────────────────────
    const revenueVals = monthlySeries.map(d=>d.revenue);
    const { slope, intercept } = linearRegression(revenueVals);
    const n = revenueVals.length;
    const forecastMonths = getNextNMonths(3);
    const forecast = forecastMonths.map(({month},i)=>({
      month, predicted: Math.max(0,Math.round(intercept+slope*(n+i))), isForecast:true,
    }));

    // ── Stale / lost ──────────────────────────────────────────
    const staleLeads = staleAgg.map(({_id,count,value,avgStaleDays})=>({
      stage: _id||"Unknown", count,
      value: Math.round(value||0),
      avgStaleDays: Math.round(avgStaleDays||0),
      severity: avgStaleDays>90?"high":avgStaleDays>45?"medium":"low",
    }));
    const lostAtStage = lostStageAgg.map(({_id,count,value})=>({
      stage:_id||"Unknown",count,value:Math.round(value||0),
    }));

    return {
      success: true,
      data: {
        vitals: {
          healthScore, healthLabel, healthColor,
          velocity,
          staleValue: FR.staleValue || 0,
          totalLeads:     G.totalLeads||0,
          totalRevenue:   G.totalRevenue||0,
          totalClosed:    G.totalClosed||0,
          totalAdvances:  G.totalAdvances||0,
          thisMonth: { leads:G.thisMonthLeads||0, revenue:G.thisMonthRev||0, closed:G.thisMonthClosed||0 },
          momTrend:  { leads:Number(momLeads.toFixed(1)), revenue:Number(momRev.toFixed(1)), closed:Number(momClosed.toFixed(1)) },
        },
        yourMetrics,
        benchmarks: BM,
        radarData,
        monthlySeries,
        forecast,
        slope: Math.round(slope),
        sourceMatrix,
        scalingOpps,
        repMatrix,
        avgLeadsPerRep: Math.round(avgLeadsPerRep),
        dealBuckets,
        avgDealSize:   Math.round(avgDealSize),
        avgCycleDays:  Math.round(avgCycleDays),
        pipelineFlow: {
          totalLeads:       PF.totalLeads||0,
          advanceCount:     PF.advanceCount||0,
          advanceAmount:    Math.round(PF.advanceAmount||0),
          startedCount:     PF.startedCount||0,
          completedCount:   PF.completedCount||0,
          completedRevenue: Math.round(PF.completedRevenue||0),
          pendingBalance:   Math.round(PF.pendingBalance||0),
        },
        staleLeads, lostAtStage,
        freshnessPct: Math.round(freshnessPct),
        staleRatePct: Math.round(staleRatePct),
        weekdayPattern: weekdays,
      },
    };
}

// ─── 3. Targets CRUD ──────────────────────────────────────────────────────────
export const getTargets = async (req, res) => {
  try {
    const { year, branch = "" } = req.query;
    const filter = { branch };
    if (year) filter.year = Number(year);
    const targets = await Target.find(filter).sort({ year:1, month:1 }).lean();
    return res.json({ success:true, data:targets });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

export const setTarget = async (req, res) => {
  try {
    const { month, year, branch="", revenueTarget=0, leadsTarget=0, closedDealsTarget=0, advanceTarget=0, setBy="" } = req.body;
    if (!month||!year) return res.status(400).json({ success:false, message:"month and year required" });
    const numMonth = Number(month), numYear = Number(year);
    if (!Number.isInteger(numMonth) || numMonth < 1 || numMonth > 12)
      return res.status(400).json({ success:false, message:"month must be 1-12" });
    if (!Number.isInteger(numYear) || numYear < 2000 || numYear > 2100)
      return res.status(400).json({ success:false, message:"year must be 2000-2100" });
    if (Number(revenueTarget) < 0 || Number(leadsTarget) < 0 || Number(closedDealsTarget) < 0 || Number(advanceTarget) < 0)
      return res.status(400).json({ success:false, message:"target values must be non-negative" });
    const doc = await Target.findOneAndUpdate(
      { month:Number(month), year:Number(year), branch },
      { revenueTarget, leadsTarget, closedDealsTarget, advanceTarget, setBy },
      { upsert:true, new:true }
    );
    // Clear analytics cache so updated targets are reflected immediately
    clearAnalyticsCache();
    return res.json({ success:true, data:doc });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

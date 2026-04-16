/**
 * Business Intelligence Controller
 * Real P&L (COGS → Gross Profit → EBITDA → Net Profit)
 * Unit Economics, Break-even, Reserve Fund Management, Scenario Planning
 */
import Lead             from "../models/Lead.js";
import Expense          from "../models/Expense.js";
import MonthlyTarget    from "../models/MonthlyTarget.js";
import FinancialConfig  from "../models/FinancialConfig.js";
import SalaryRecord     from "../models/SalaryRecord.js";
import FundTransaction  from "../models/FundTransaction.js";

const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Closed-deal stage matcher
const CLOSED_STAGES = ["closed","won","deal closed","closed won","job completed","completed","closed - won"];
const closedExpr = { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, CLOSED_STAGES] };

function r(n){ return Math.round(n || 0); }
function pct(a,b){ return b > 0 ? Math.round(a/b*100) : 0; }

// Linear regression → slope + intercept
function linReg(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };
  const sumX = n*(n-1)/2, sumX2 = (n-1)*n*(2*n-1)/6;
  const sumY = values.reduce((a,v)=>a+v,0), sumXY = values.reduce((a,v,i)=>a+i*v,0);
  const d = n*sumX2 - sumX*sumX;
  if (!d) return { slope:0, intercept: sumY/n };
  const slope = (n*sumXY - sumX*sumY)/d;
  return { slope, intercept: (sumY - slope*sumX)/n };
}

// ─── GET /api/bi/config ───────────────────────────────────────────────────────
export const getConfig = async (req, res) => {
  try {
    const { branch = "" } = req.query;
    let cfg = await FinancialConfig.findOne({ branch }).lean();
    if (!cfg) {
      // Seed with NNC's configured defaults
      cfg = await FinancialConfig.create({
        branch,
        cogsPercent:      30,
        taxRatePercent:   30,
        bufferMonths:      5,
        emergencyPct:     15,
        growthFundPct:    15,
        bufferBalance:     0,
        emergencyBalance:  0,
        taxReserveBalance: 0,
        growthBalance:     0,
      });
      cfg = cfg.toObject();
    }
    return res.json({ success: true, data: cfg });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ─── POST /api/bi/config ──────────────────────────────────────────────────────
export const setConfig = async (req, res) => {
  try {
    const { branch = "", ...fields } = req.body;

    // Validate numeric config fields — must be non-negative numbers
    const numericKeys = ["cogsPercent","taxRatePercent","bufferMonths","emergencyPct","growthFundPct"];
    for (const key of numericKeys) {
      if (key in fields) {
        const v = Number(fields[key]);
        if (isNaN(v) || v < 0) {
          return res.status(400).json({ success:false, message:`${key} must be a non-negative number` });
        }
        if (key.endsWith("Percent") || key.endsWith("Pct")) {
          if (v > 100) return res.status(400).json({ success:false, message:`${key} cannot exceed 100` });
        }
        fields[key] = v;
      }
    }

    // Prevent clients from overwriting computed balance fields directly
    const protectedKeys = ["bufferBalance","emergencyBalance","taxReserveBalance","growthBalance"];
    for (const key of protectedKeys) {
      delete fields[key];
    }

    const cfg = await FinancialConfig.findOneAndUpdate(
      { branch },
      { ...fields, branch },
      { upsert:true, new:true }
    );
    return res.json({ success:true, data:cfg });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ─── GET /api/bi/dashboard?year=&month= ──────────────────────────────────────
export const getBIDashboard = async (req, res) => {
  try {
    const now   = new Date();
    const year  = Number(req.query.year  || now.getFullYear());
    const month = Number(req.query.month || now.getMonth()+1);
    const branch = req.query.branch || "";

    // Validate month/year
    if (!Number.isInteger(month) || month < 1 || month > 12)
      return res.status(400).json({ success:false, message:"month must be 1-12" });
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      return res.status(400).json({ success:false, message:"year must be 2000-2100" });

    const monthStart = new Date(year, month-1, 1);
    const monthEnd   = new Date(year, month,   1);
    const yearStart  = new Date(year, 0, 1);
    const yearEnd    = new Date(year+1, 0, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()+1;
    const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;

    // Previous 12 months for trend
    const trend12 = Array.from({length:12},(_,i)=>{
      const d = new Date(year, month-1-i, 1);
      return { y:d.getFullYear(), m:d.getMonth()+1 };
    }).reverse();
    const trendStart = new Date(trend12[0].y, trend12[0].m-1, 1);

    // Config
    const cfg = await FinancialConfig.findOne({ branch }).lean()
             || { cogsPercent:30, taxRatePercent:30, bufferMonths:5, emergencyPct:15,
                  growthFundPct:15, bufferBalance:0, emergencyBalance:0,
                  taxReserveBalance:0, growthBalance:0, overheadMethod:"equal" };

    const branchMatch = branch ? { branch } : {};

    const [
      monthRevAgg,      // 0
      monthExpAgg,      // 1
      monthExpCatAgg,   // 2
      ytdRevAgg,        // 3
      ytdExpAgg,        // 4
      trendRevAgg,      // 5
      trendExpAgg,      // 6
      closedDealsMonth, // 7
      closedDealsYTD,   // 8
      dealSizeAgg,      // 9
      targetDoc,        // 10
      prevMonthRevAgg,  // 11
      prevMonthExpAgg,  // 12
      salaryYTD,        // 13
      pipelineAgg,      // 14
    ] = await Promise.all([
      // 0. This-month revenue (advances)
      Lead.aggregate([
        { $match: { ...branchMatch, advanceReceivedDate:{ $gte:monthStart,$lt:monthEnd }, advanceReceived:{ $gt:0 } } },
        { $group: { _id:null, total:{ $sum:"$advanceReceived" }, count:{ $sum:1 } } },
      ]),
      // 1. This-month expenses (all categories)
      Expense.aggregate([
        { $match: { ...branchMatch, year, month } },
        { $group: { _id:null, total:{ $sum:"$amount" } } },
      ]),
      // 2. This-month expenses by category
      Expense.aggregate([
        { $match: { ...branchMatch, year, month } },
        { $group: { _id:"$category", total:{ $sum:"$amount" } } },
      ]),
      // 3. YTD revenue
      Lead.aggregate([
        { $match: { ...branchMatch, advanceReceivedDate:{ $gte:yearStart,$lt:yearEnd }, advanceReceived:{ $gt:0 } } },
        { $group: { _id:null, total:{ $sum:"$advanceReceived" }, count:{ $sum:1 } } },
      ]),
      // 4. YTD expenses
      Expense.aggregate([
        { $match: { ...branchMatch, year } },
        { $group: { _id:null, total:{ $sum:"$amount" } } },
      ]),
      // 5. 12-month revenue trend
      Lead.aggregate([
        { $match: { ...branchMatch, advanceReceivedDate:{ $gte:trendStart,$lt:monthEnd }, advanceReceived:{ $gt:0 } } },
        { $group: { _id:{ y:{ $year:"$advanceReceivedDate" }, m:{ $month:"$advanceReceivedDate" } }, rev:{ $sum:"$advanceReceived" } } },
      ]),
      // 6. 12-month expense trend
      Expense.aggregate([
        { $match: { ...branchMatch, $or: trend12.map(t=>({ year:t.y, month:t.m })) } },
        { $group: { _id:{ y:"$year", m:"$month" }, exp:{ $sum:"$amount" } } },
      ]),
      // 7. Closed deals this month
      Lead.aggregate([
        { $match: { ...branchMatch, $expr: closedExpr,
            $or:[
              { advanceReceivedDate:{ $gte:monthStart,$lt:monthEnd } },
              { updatedAt:{ $gte:monthStart,$lt:monthEnd } },
            ] } },
        { $group: { _id:null, count:{ $sum:1 }, totalValue:{ $sum:"$value" }, totalAdv:{ $sum:"$advanceReceived" } } },
      ]),
      // 8. Closed deals YTD
      Lead.aggregate([
        { $match: { ...branchMatch, $expr: closedExpr,
            $or:[
              { advanceReceivedDate:{ $gte:yearStart,$lt:yearEnd } },
              { updatedAt:{ $gte:yearStart,$lt:yearEnd } },
            ] } },
        { $group: { _id:null, count:{ $sum:1 }, totalValue:{ $sum:"$value" }, totalAdv:{ $sum:"$advanceReceived" } } },
      ]),
      // 9. Deal size distribution (closed, all time last 12m)
      Lead.aggregate([
        { $match: { ...branchMatch, $expr: closedExpr, value:{ $gt:0 }, advanceReceivedDate:{ $gte:trendStart,$lt:monthEnd } } },
        { $bucket: {
            groupBy: "$value",
            boundaries: [0,25000,50000,100000,200000,500000,1000000,99999999],
            default: "1Cr+",
            output: { count:{ $sum:1 }, total:{ $sum:"$value" } },
          }
        },
      ]),
      // 10. Monthly target
      MonthlyTarget.findOne({ year, month }).lean(),
      // 11. Prev month revenue
      Lead.aggregate([
        { $match: { ...branchMatch,
            advanceReceivedDate:{ $gte:new Date(year,month-2,1), $lt:monthStart },
            advanceReceived:{ $gt:0 } } },
        { $group: { _id:null, total:{ $sum:"$advanceReceived" } } },
      ]),
      // 12. Prev month expenses
      Expense.aggregate([
        { $match: { ...branchMatch,
            year: month===1 ? year-1 : year,
            month: month===1 ? 12 : month-1 } },
        { $group: { _id:null, total:{ $sum:"$amount" } } },
      ]),
      // 13. YTD salary (from SalaryRecord)
      SalaryRecord.aggregate([
        { $match: { ...branchMatch, year } },
        { $group: { _id:null, total:{ $sum:"$netSalary" } } },
      ]),
      // 14. Open pipeline
      Lead.aggregate([
        { $match: { ...branchMatch, $expr:{ $not: closedExpr }, value:{ $gt:0 } } },
        { $group: { _id:null, total:{ $sum:"$value" }, count:{ $sum:1 } } },
      ]),
    ]);

    // ── Core figures ──────────────────────────────────────────────────────────
    const revenue  = monthRevAgg[0]?.total  || 0;
    const opex     = monthExpAgg[0]?.total  || 0;
    const ytdRev   = ytdRevAgg[0]?.total    || 0;
    const ytdOpex  = ytdExpAgg[0]?.total    || 0;
    const prevRev  = prevMonthRevAgg[0]?.total  || 0;
    const prevOpex = prevMonthExpAgg[0]?.total  || 0;

    // ── Income Statement (Service Company — no COGS, all costs from expense tracker) ──
    const cogs          = 0;           // service company — cost tracked via expense tracker
    const grossProfit   = revenue;     // 100% service margin before operating costs
    const grossMarginPct= 100;
    const ebitda        = r(revenue - opex);   // revenue minus all tracked operating costs
    const taxProvision  = ebitda > 0 ? r(ebitda * cfg.taxRatePercent / 100) : 0;
    const netProfit     = r(ebitda - taxProvision);
    const netMarginPct  = pct(netProfit, revenue);

    // ── YTD Income Statement ─────────────────────────────────────────────────
    const ytdCogs        = 0;
    const ytdGrossProfit = ytdRev;
    const ytdEbitda      = r(ytdRev - ytdOpex);
    const ytdTax         = ytdEbitda > 0 ? r(ytdEbitda * cfg.taxRatePercent / 100) : 0;
    const ytdNetProfit   = r(ytdEbitda - ytdTax);

    // ── Expense breakdown ─────────────────────────────────────────────────────
    const cats = ["salary","rent","electricity","internet","maintenance","other"];
    const expByCat = {};
    cats.forEach(c => { expByCat[c] = 0; });
    monthExpCatAgg.forEach(({ _id, total }) => { expByCat[_id] = total; });

    // ── MoM ──────────────────────────────────────────────────────────────────
    const momRevPct  = prevRev  > 0 ? r((revenue  - prevRev)  / prevRev  * 100) : null;
    const momOpexPct = prevOpex > 0 ? r((opex - prevOpex) / prevOpex * 100) : null;

    // ── Target & pace ─────────────────────────────────────────────────────────
    const monthlyTarget = targetDoc?.targetRevenue || 0;
    const targetAchieved= pct(revenue, monthlyTarget);
    const dailyRate     = daysElapsed > 0 ? revenue / daysElapsed : 0;
    const projectedRev  = r(dailyRate * daysInMonth);
    const paceStatus    = monthlyTarget === 0 ? "no_target"
      : projectedRev >= monthlyTarget ? "on_track" : "behind";

    // ── 12-month trend series ─────────────────────────────────────────────────
    const revMap = {}, expMap = {};
    trendRevAgg.forEach(({ _id, rev }) => { revMap[`${_id.y}-${_id.m}`] = rev; });
    trendExpAgg.forEach(({ _id, exp }) => { expMap[`${_id.y}-${_id.m}`] = exp; });
    const trendSeries = trend12.map(({ y, m }) => {
      const key = `${y}-${m}`;
      const rev = revMap[key] || 0;
      const exp = expMap[key] || 0;
      const cg  = 0;           // service company — no COGS
      const gp  = rev;         // gross = revenue for service
      const eb  = r(gp - exp);
      const np  = eb > 0 ? r(eb - eb * cfg.taxRatePercent / 100) : eb;
      return { label: MN[m-1], month:m, year:y, revenue:rev, opex:exp, cogs:cg, grossProfit:gp, ebitda:eb, netProfit:np };
    });

    // ── Unit economics (Service Company) ──────────────────────────────────────
    const closedCountMonth = closedDealsMonth[0]?.count || 0;
    const closedCountYTD   = closedDealsYTD[0]?.count   || 0;
    const closedValYTD     = closedDealsYTD[0]?.totalValue || 0;
    const avgDealRev       = closedCountYTD > 0 ? r(ytdRev / closedCountYTD) : 0;
    const directCostPerDeal= 0;   // service company — no product COGS
    const avgMonthlyOpex   = trendSeries.length > 0
      ? r(trendSeries.reduce((s,t)=>s+t.opex,0) / (trendSeries.filter(t=>t.opex>0).length || 1)) : opex;
    // Full operating cost allocation per project (salaries + rent + all opex / projects)
    const fixedCostPerDeal = closedCountYTD > 0
      ? r((avgMonthlyOpex * 12) / Math.max(closedCountYTD, 1)) : avgMonthlyOpex;
    const profitPerDeal    = r(avgDealRev - fixedCostPerDeal);
    // For service company: contribution margin = 100% (no product cost deducted)
    const contributionMargin = 100;
    // Break-even = opex ÷ avg project revenue
    const breakEvenDeals   = avgDealRev > 0 ? Math.ceil(avgMonthlyOpex / avgDealRev) : 0;
    const breakEvenRevenue = r(avgMonthlyOpex);
    const minProfitableDeals = breakEvenDeals;

    // Deal size buckets
    const bucketLabels = ["<25K","25-50K","50-100K","100-200K","200-500K","500K-1Cr","1Cr+"];
    const dealBuckets = dealSizeAgg.map((b, i) => ({
      range: bucketLabels[i] || "1Cr+",
      count: b.count,
      total: b.total,
    }));

    // ── Reserve funds ──────────────────────────────────────────────────────────
    const bufferTarget    = r(avgMonthlyOpex * cfg.bufferMonths);
    const emergencyTarget = month > 0 ? r(ytdRev * (cfg.emergencyPct / 100) / (month / 12)) : 0;  // annualized
    const taxReserveTarget= ytdEbitda > 0 ? r(ytdEbitda * cfg.taxRatePercent / 100) : 0;
    const growthTarget    = ytdNetProfit > 0 ? r(ytdNetProfit * cfg.growthFundPct / 100) : 0;

    const funds = [
      {
        id: "buffer",
        name: "Operating Buffer",
        description: `${cfg.bufferMonths} months of operating expenses`,
        icon: "shield",
        target: bufferTarget,
        balance: cfg.bufferBalance,
        fundedPct: pct(cfg.bufferBalance, bufferTarget),
        monthlyContrib: bufferTarget > cfg.bufferBalance
          ? r((bufferTarget - cfg.bufferBalance) / Math.max(6, 1)) : 0,
        status: cfg.bufferBalance >= bufferTarget ? "funded"
          : cfg.bufferBalance >= bufferTarget * 0.5 ? "partial" : "critical",
        purpose: "Cover 3 months of rent, salaries, utilities if revenue stops",
      },
      {
        id: "emergency",
        name: "Emergency / Accident Fund",
        description: `${cfg.emergencyPct}% of annual revenue`,
        icon: "alert",
        target: emergencyTarget,
        balance: cfg.emergencyBalance,
        fundedPct: pct(cfg.emergencyBalance, emergencyTarget),
        monthlyContrib: emergencyTarget > cfg.emergencyBalance
          ? r((emergencyTarget - cfg.emergencyBalance) / 12) : 0,
        status: cfg.emergencyBalance >= emergencyTarget ? "funded"
          : cfg.emergencyBalance >= emergencyTarget * 0.5 ? "partial" : "critical",
        purpose: "Equipment failure, legal disputes, medical emergencies",
      },
      {
        id: "tax",
        name: "Tax Reserve",
        description: `${cfg.taxRatePercent}% of EBITDA set aside`,
        icon: "receipt",
        target: taxReserveTarget,
        balance: cfg.taxReserveBalance,
        fundedPct: pct(cfg.taxReserveBalance, taxReserveTarget),
        monthlyContrib: taxReserveTarget > cfg.taxReserveBalance
          ? r(taxProvision) : 0,
        status: cfg.taxReserveBalance >= taxReserveTarget ? "funded"
          : cfg.taxReserveBalance >= taxReserveTarget * 0.7 ? "partial" : "critical",
        purpose: "Advance tax, GST compliance, ITR payments",
      },
      {
        id: "growth",
        name: "Growth / Investment Fund",
        description: `${cfg.growthFundPct}% of net profit`,
        icon: "trending",
        target: growthTarget,
        balance: cfg.growthBalance,
        fundedPct: pct(cfg.growthBalance, growthTarget),
        monthlyContrib: netProfit > 0 ? r(netProfit * cfg.growthFundPct / 100) : 0,
        status: cfg.growthBalance >= growthTarget ? "funded"
          : cfg.growthBalance >= growthTarget * 0.5 ? "partial" : "underfunded",
        purpose: "Team expansion, equipment, marketing, new services",
      },
    ];

    // Monthly allocation from this month's net profit
    const totalReserveContrib = r(funds.reduce((s,f)=>s+f.monthlyContrib, 0));
    const ownerTakeHome = r(Math.max(0, netProfit - totalReserveContrib));

    // ── Per-order profit breakdown ────────────────────────────────────────────
    const orderBreakdown = {
      avgDealRevenue: avgDealRev,
      directCost: directCostPerDeal,
      fixedCostAllocation: fixedCostPerDeal,
      grossProfitPerDeal: r(avgDealRev - directCostPerDeal),
      netProfitPerDeal: profitPerDeal,
      bufferAlloc:    r(avgDealRev * (bufferTarget  / Math.max(ytdRev,1)) * 0.25),
      emergencyAlloc: r(avgDealRev * (cfg.emergencyPct/100) * 0.10),
      taxAlloc:       r(avgDealRev * cfg.taxRatePercent / 100 * (contributionMargin/100)),
      growthAlloc:    r(profitPerDeal > 0 ? profitPerDeal * cfg.growthFundPct/100 : 0),
    };

    // ── Scenario planning (3-month forward) ──────────────────────────────────
    const { slope } = linReg(trendSeries.map(t=>t.revenue));
    const avgMonthlyRev = trendSeries.length
      ? trendSeries.reduce((s,t)=>s+t.revenue,0) / trendSeries.length : revenue;
    const scenarios = ["conservative","base","optimistic"].map((name,i) => {
      const growthFactor = [0.8, 1.0, 1.25][i];
      const months = Array.from({length:3},(_,j)=>{
        const d = new Date(year, month+j, 1);
        const projRev = r(Math.max(0, avgMonthlyRev * growthFactor + slope*(j+1)));
        const projOpex = r(avgMonthlyOpex * (name==="optimistic"?1.1:1.0)); // scale opex if growing
        const projCogs = 0;           // service company — no COGS
        const projGP   = projRev;     // gross = revenue for service
        const projEB   = r(projGP - projOpex);
        const projNP   = projEB > 0 ? r(projEB * (1 - cfg.taxRatePercent/100)) : projEB;
        return {
          label: MN[d.getMonth()] + " " + d.getFullYear(),
          revenue: projRev, opex: projOpex, cogs: projCogs,
          grossProfit: projGP, ebitda: projEB, netProfit: projNP,
        };
      });
      return { name, growthFactor, months,
        totalRev:  months.reduce((s,m)=>s+m.revenue, 0),
        totalProfit: months.reduce((s,m)=>s+m.netProfit, 0),
      };
    });

    // ── Pipeline ──────────────────────────────────────────────────────────────
    const pipelineValue = pipelineAgg[0]?.total || 0;
    const pipelineCount = pipelineAgg[0]?.count || 0;

    return res.json({
      success: true,
      data: {
        meta: { year, month, daysElapsed, daysInMonth, isCurrentMonth },
        config: cfg,
        // ── Income statement ─────────────
        incomeStatement: {
          revenue, cogs, grossProfit, grossMarginPct,
          opex, expByCat, ebitda, taxProvision, netProfit, netMarginPct,
        },
        ytd: {
          revenue: ytdRev, cogs: ytdCogs, grossProfit: ytdGrossProfit,
          opex: ytdOpex, ebitda: ytdEbitda, taxProvision: ytdTax, netProfit: ytdNetProfit,
          closedDeals: closedCountYTD, closedValue: r(closedValYTD),
        },
        mom: { revPct: momRevPct, opexPct: momOpexPct },
        target: { monthlyTarget, targetAchieved, projectedRev, paceStatus, dailyRate: r(dailyRate) },
        // ── Unit economics ───────────────
        unitEconomics: {
          avgDealRev, directCostPerDeal, fixedCostPerDeal,
          profitPerDeal, contributionMargin,
          breakEvenDeals, breakEvenRevenue, minProfitableDeals,
          closedCountMonth, closedCountYTD,
          avgMonthlyOpex,
        },
        orderBreakdown,
        dealBuckets,
        // ── Reserve funds ────────────────
        funds,
        fundSummary: {
          totalTarget:  r(funds.reduce((s,f)=>s+f.target, 0)),
          totalBalance: r(funds.reduce((s,f)=>s+f.balance, 0)),
          totalMonthlyContrib: totalReserveContrib,
          ownerTakeHome,
        },
        // ── Trend & scenarios ────────────
        trendSeries,
        scenarios,
        // ── Pipeline ─────────────────────
        pipelineValue, pipelineCount,
      },
    });
  } catch (err) {
    console.error("getBIDashboard error:", err);
    return res.status(500).json({ success:false, message:err.message });
  }
};

// ─── Fund metadata ─────────────────────────────────────────────────────────────
const FUND_META = {
  buffer:    { name:"Operating Buffer",        balanceKey:"bufferBalance"     },
  emergency: { name:"Emergency / Accident Fund", balanceKey:"emergencyBalance" },
  tax:       { name:"Tax Reserve",             balanceKey:"taxReserveBalance" },
  growth:    { name:"Growth / Investment Fund",balanceKey:"growthBalance"     },
};

// ─── GET /api/bi/funds?branch= ─────────────────────────────────────────────────
// Returns all 4 funds with balance, target, transactions, and monthly chart data
export const getFunds = async (req, res) => {
  try {
    const { branch = "" } = req.query;

    const [cfg, allTx] = await Promise.all([
      FinancialConfig.findOne({ branch }).lean(),
      FundTransaction.find({ branch }).sort({ date: -1 }).lean(),
    ]);

    const config = cfg || {
      cogsPercent:30, taxRatePercent:30, bufferMonths:5, emergencyPct:15,
      growthFundPct:15, bufferBalance:0, emergencyBalance:0,
      taxReserveBalance:0, growthBalance:0,
    };

    // Compute running balance per fund from all transactions (oldest first)
    const txByFund = { buffer:[], emergency:[], tax:[], growth:[] };
    allTx.forEach(t => { if (txByFund[t.fundId]) txByFund[t.fundId].push(t); });

    // Verify stored balances match sum of transactions (source of truth = transactions)
    const computedBalance = {};
    Object.keys(txByFund).forEach(fid => {
      const sorted = [...txByFund[fid]].sort((a,b) => new Date(a.date)-new Date(b.date));
      let bal = 0;
      sorted.forEach(t => {
        bal += t.type === "deposit" ? t.amount : -t.amount;
      });
      computedBalance[fid] = Math.max(0, bal);
    });

    // Build monthly balance history (last 12 months) per fund
    const now = new Date();
    const months12 = Array.from({length:12},(_,i)=>{
      const d = new Date(now.getFullYear(), now.getMonth()-11+i, 1);
      return { y:d.getFullYear(), m:d.getMonth()+1, label: MN[d.getMonth()] + " " + d.getFullYear() };
    });

    function monthlyHistory(txList) {
      const sorted = [...txList].sort((a,b) => new Date(a.date)-new Date(b.date));
      let running = 0;
      const monthMap = {};
      sorted.forEach(t => {
        const key = `${new Date(t.date).getFullYear()}-${new Date(t.date).getMonth()+1}`;
        running += t.type === "deposit" ? t.amount : -t.amount;
        monthMap[key] = Math.max(0, running);
      });
      // Forward-fill: carry last balance forward
      let last = 0;
      return months12.map(({ y, m, label }) => {
        const key = `${y}-${m}`;
        if (monthMap[key] !== undefined) last = monthMap[key];
        return { label, balance: last };
      });
    }

    const funds = Object.entries(FUND_META).map(([fid, meta]) => {
      const balance = computedBalance[fid] || 0;
      const txList  = txByFund[fid] || [];
      const recent  = [...txList].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,50);
      return {
        id: fid,
        name: meta.name,
        balance,
        transactions: recent,
        history: monthlyHistory(txList),
        txCount: txList.length,
      };
    });

    return res.json({ success:true, data:{ funds, config } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ─── POST /api/bi/funds/transaction ───────────────────────────────────────────
export const addFundTransaction = async (req, res) => {
  try {
    const { fundId, type, amount, date, note="", addedBy="", branch="" } = req.body;
    if (!fundId || !FUND_META[fundId])
      return res.status(400).json({ success:false, message:"Invalid fundId" });
    if (!["deposit","withdrawal"].includes(type))
      return res.status(400).json({ success:false, message:"type must be deposit or withdrawal" });

    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0 || !isFinite(numAmount))
      return res.status(400).json({ success:false, message:"amount must be a positive number" });

    // For withdrawals, check current balance first to prevent negative balance
    if (type === "withdrawal") {
      const existingTx = await FundTransaction.find({ fundId, branch }).lean();
      const currentBalance = existingTx.reduce((s,t) => s + (t.type==="deposit" ? t.amount : -t.amount), 0);
      if (numAmount > currentBalance) {
        return res.status(400).json({
          success:false,
          message:`Insufficient balance. Current balance: ₹${Math.max(0, currentBalance).toLocaleString("en-IN")}. Cannot withdraw ₹${numAmount.toLocaleString("en-IN")}.`,
        });
      }
    }

    const txDate = date ? new Date(date) : new Date();
    if (isNaN(txDate.getTime()))
      return res.status(400).json({ success:false, message:"Invalid date" });

    const tx = await FundTransaction.create({
      fundId, fundName: FUND_META[fundId].name, branch,
      type, amount: numAmount,
      date: txDate, month: txDate.getMonth()+1, year: txDate.getFullYear(),
      note, addedBy,
    });

    // Recompute balance from all transactions and persist to FinancialConfig
    const allTx = await FundTransaction.find({ fundId, branch }).lean();
    const newBalance = Math.max(0, allTx.reduce((s,t) => s + (t.type==="deposit" ? t.amount : -t.amount), 0));
    await FinancialConfig.findOneAndUpdate(
      { branch },
      { [FUND_META[fundId].balanceKey]: newBalance },
      { upsert: true }
    );

    return res.json({ success:true, data:{ transaction: tx, newBalance } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

// ─── DELETE /api/bi/funds/transaction/:id ─────────────────────────────────────
export const deleteFundTransaction = async (req, res) => {
  try {
    const tx = await FundTransaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success:false, message:"Transaction not found" });

    const { fundId, branch } = tx;
    await tx.deleteOne();

    // Recompute balance
    const allTx = await FundTransaction.find({ fundId, branch }).lean();
    const newBalance = Math.max(0, allTx.reduce((s,t) => s + (t.type==="deposit" ? t.amount : -t.amount), 0));
    await FinancialConfig.findOneAndUpdate(
      { branch },
      { [FUND_META[fundId].balanceKey]: newBalance },
      { upsert: true }
    );

    return res.json({ success:true, data:{ newBalance } });
  } catch(err) { return res.status(500).json({ success:false, message:err.message }); }
};

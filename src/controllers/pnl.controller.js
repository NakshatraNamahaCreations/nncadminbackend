import Lead          from "../models/Lead.js";
import Expense       from "../models/Expense.js";
import MonthlyTarget from "../models/MonthlyTarget.js";

const EXPENSE_CATS = ["rent","salary","electricity","internet","maintenance","other"];

/* ─── helpers ─────────────────────────────────────────────── */
function safeNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function parseYearMonth(query) {
  const now = new Date();
  const year = safeNumber(query.year, now.getFullYear());
  const month = safeNumber(query.month, now.getMonth() + 1);
  if (month < 1 || month > 12) return null;
  if (year < 1970 || year > 2100) return null;
  return { year, month };
}

function margin(rev, exp) {
  if (rev <= 0 && exp <= 0) return 0;
  if (rev <= 0) return -100;
  return Math.round(((rev - exp) / rev) * 100);
}

function buildBreakdown(revMap, expMap, catMaps, periods) {
  return periods.map(({ key, label }) => {
    const revenue  = revMap[key]  || 0;
    const expenses = expMap[key]  || 0;
    const pnl      = revenue - expenses;
    const expByCat = {};
    EXPENSE_CATS.forEach(cat => { expByCat[cat] = catMaps[cat]?.[key] || 0; });
    return { key, label, revenue, expenses, pnl, margin: margin(revenue, expenses), expByCat };
  });
}

/* ─── GET /api/pnl?view=daily|monthly|yearly&year=&month= ─── */
export async function getPnL(req, res) {
  try {
    const now   = new Date();
    const view  = req.query.view  || "monthly";
    const ym = parseYearMonth(req.query);
    if (!ym) return res.status(400).json({ success: false, message: "Invalid year or month" });
    const { year, month } = ym;

    /* ── DAILY: day-by-day for one month ── */
    if (view === "daily") {
      const start = new Date(year, month - 1, 1);
      const end   = new Date(year, month, 1);
      const daysInMonth = new Date(year, month, 0).getDate();

      const [revAgg, expAgg, expCatAgg] = await Promise.all([
        Lead.aggregate([
          { $match: { advanceReceivedDate: { $gte: start, $lt: end }, advanceReceived: { $gt: 0 } } },
          { $group: { _id: { $dayOfMonth: "$advanceReceivedDate" }, revenue: { $sum: "$advanceReceived" } } },
        ]),
        Expense.aggregate([
          { $match: { year, month } },
          { $group: { _id: { $dayOfMonth: "$date" }, expenses: { $sum: "$amount" } } },
        ]),
        Expense.aggregate([
          { $match: { year, month } },
          { $group: { _id: { cat: "$category", day: { $dayOfMonth: "$date" } }, amount: { $sum: "$amount" } } },
        ]),
      ]);

      const revMap = {};  revAgg.forEach(r => { revMap[r._id] = r.revenue; });
      const expMap = {};  expAgg.forEach(e => { expMap[e._id] = e.expenses; });
      const catMaps = {};
      expCatAgg.forEach(({ _id, amount }) => {
        if (!catMaps[_id.cat]) catMaps[_id.cat] = {};
        catMaps[_id.cat][_id.day] = amount;
      });

      const periods = Array.from({ length: daysInMonth }, (_, i) => ({
        key: i + 1, label: String(i + 1).padStart(2, "0"),
      }));
      const breakdown = buildBreakdown(revMap, expMap, catMaps, periods);
      const totals = summarise(breakdown);

      return res.json({ success: true, data: { view: "daily", year, month, totals, breakdown } });
    }

    /* ── MONTHLY: month-by-month for one year ── */
    if (view === "monthly") {
      const start = new Date(year, 0, 1);
      const end   = new Date(year + 1, 0, 1);

      const [revAgg, expAgg, expCatAgg] = await Promise.all([
        Lead.aggregate([
          { $match: { advanceReceivedDate: { $gte: start, $lt: end }, advanceReceived: { $gt: 0 } } },
          { $group: { _id: { $month: "$advanceReceivedDate" }, revenue: { $sum: "$advanceReceived" } } },
        ]),
        Expense.aggregate([
          { $match: { year } },
          { $group: { _id: "$month", expenses: { $sum: "$amount" } } },
        ]),
        Expense.aggregate([
          { $match: { year } },
          { $group: { _id: { cat: "$category", month: "$month" }, amount: { $sum: "$amount" } } },
        ]),
      ]);

      const revMap = {};  revAgg.forEach(r => { revMap[r._id] = r.revenue; });
      const expMap = {};  expAgg.forEach(e => { expMap[e._id] = e.expenses; });
      const catMaps = {};
      expCatAgg.forEach(({ _id, amount }) => {
        if (!catMaps[_id.cat]) catMaps[_id.cat] = {};
        catMaps[_id.cat][_id.month] = amount;
      });

      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const periods = MONTHS.map((label, i) => ({ key: i + 1, label }));
      const breakdown = buildBreakdown(revMap, expMap, catMaps, periods);
      const totals = summarise(breakdown);

      return res.json({ success: true, data: { view: "monthly", year, totals, breakdown } });
    }

    /* ── YEARLY: last 6 years ── */
    if (view === "yearly") {
      const currentYear = now.getFullYear();
      const startYear   = currentYear - 5;
      const start = new Date(startYear, 0, 1);
      const end   = new Date(currentYear + 1, 0, 1);

      const [revAgg, expAgg, expCatAgg] = await Promise.all([
        Lead.aggregate([
          { $match: { advanceReceivedDate: { $gte: start, $lt: end }, advanceReceived: { $gt: 0 } } },
          { $group: { _id: { $year: "$advanceReceivedDate" }, revenue: { $sum: "$advanceReceived" } } },
        ]),
        Expense.aggregate([
          { $match: { year: { $gte: startYear, $lte: currentYear } } },
          { $group: { _id: "$year", expenses: { $sum: "$amount" } } },
        ]),
        Expense.aggregate([
          { $match: { year: { $gte: startYear, $lte: currentYear } } },
          { $group: { _id: { cat: "$category", year: "$year" }, amount: { $sum: "$amount" } } },
        ]),
      ]);

      const revMap = {};  revAgg.forEach(r => { revMap[r._id] = r.revenue; });
      const expMap = {};  expAgg.forEach(e => { expMap[e._id] = e.expenses; });
      const catMaps = {};
      expCatAgg.forEach(({ _id, amount }) => {
        if (!catMaps[_id.cat]) catMaps[_id.cat] = {};
        catMaps[_id.cat][_id.year] = amount;
      });

      const periods = [];
      for (let y = startYear; y <= currentYear; y++) periods.push({ key: y, label: String(y) });
      const breakdown = buildBreakdown(revMap, expMap, catMaps, periods);
      const totals = summarise(breakdown);

      return res.json({ success: true, data: { view: "yearly", totals, breakdown } });
    }

    return res.status(400).json({ success: false, message: "Invalid view" });
  } catch (err) {
    console.error("getPnL error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

function summarise(breakdown) {
  const revenue  = breakdown.reduce((s, b) => s + b.revenue,  0);
  const expenses = breakdown.reduce((s, b) => s + b.expenses, 0);
  const pnl      = revenue - expenses;
  const expByCat = {};
  EXPENSE_CATS.forEach(cat => {
    expByCat[cat] = breakdown.reduce((s, b) => s + (b.expByCat[cat] || 0), 0);
  });
  return { revenue, expenses, pnl, margin: margin(revenue, expenses), expByCat };
}

/* ─── GET /api/pnl/dashboard?year=&month= ─────────────────── */
export async function getPnLDashboard(req, res) {
  try {
    const now   = new Date();
    const ym = parseYearMonth(req.query);
    if (!ym) return res.status(400).json({ success: false, message: "Invalid year or month" });
    const { year, month } = ym;

    const monthStart  = new Date(year, month - 1, 1);
    const monthEnd    = new Date(year, month, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;
    const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

    /* ── 6-month trend (including current month) ── */
    const trendMonths = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      trendMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    const trendStart = new Date(trendMonths[0].year, trendMonths[0].month - 1, 1);
    const trendEnd   = monthEnd;

    /* ── last 3 months for burn rate (excluding current) ── */
    const burn3Start = new Date(year, month - 4, 1);
    const burn3End   = monthStart;

    const CLOSED = /closed|won/i;

    const [
      monthRevAgg,
      monthExpAgg,
      monthExpCatAgg,
      topClientsRaw,
      pipelineAgg,
      trendRevAgg,
      trendExpAgg,
      burn3Agg,
      targetDoc,
      prevMonthRevAgg,
      prevMonthExpAgg,
      dailyRevAgg,
    ] = await Promise.all([
      /* 1. This month revenue */
      Lead.aggregate([
        { $match: { advanceReceivedDate: { $gte: monthStart, $lt: monthEnd }, advanceReceived: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$advanceReceived" }, count: { $sum: 1 } } },
      ]),
      /* 2. This month expenses */
      Expense.aggregate([
        { $match: { year, month } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      /* 3. Expense by category this month */
      Expense.aggregate([
        { $match: { year, month } },
        { $group: { _id: "$category", total: { $sum: "$amount" } } },
      ]),
      /* 4. Top 8 revenue clients this month */
      Lead.find({ advanceReceivedDate: { $gte: monthStart, $lt: monthEnd }, advanceReceived: { $gt: 0 } })
        .sort({ advanceReceived: -1 }).limit(8)
        .select("name business company advanceReceived stage branch repName")
        .lean(),
      /* 5. Pipeline value (open non-closed leads with deal value) */
      Lead.aggregate([
        { $match: { $or: [{ stage: { $not: CLOSED } }, { stage: null }], value: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$value" }, count: { $sum: 1 } } },
      ]),
      /* 6. 6-month trend — revenue */
      Lead.aggregate([
        { $match: { advanceReceivedDate: { $gte: trendStart, $lt: trendEnd }, advanceReceived: { $gt: 0 } } },
        { $group: {
          _id: { year: { $year: "$advanceReceivedDate" }, month: { $month: "$advanceReceivedDate" } },
          revenue: { $sum: "$advanceReceived" },
        }},
      ]),
      /* 7. 6-month trend — expenses */
      Expense.aggregate([
        { $match: { $or: trendMonths.map(m => ({ year: m.year, month: m.month })) } },
        { $group: { _id: { year: "$year", month: "$month" }, expenses: { $sum: "$amount" } } },
      ]),
      /* 8. Burn rate — last 3 months expenses */
      Expense.aggregate([
        { $match: { $expr: {
          $or: [
            { $and: [{ $eq: ["$year", burn3Start.getFullYear()] }, { $gte: ["$month", burn3Start.getMonth() + 1] }] },
            { $and: [{ $gt: ["$year", burn3Start.getFullYear()] }, { $lt: ["$year", year] }] },
            { $and: [{ $eq: ["$year", year] }, { $lt: ["$month", month] }] },
          ],
        }}},
        { $group: { _id: { year: "$year", month: "$month" }, total: { $sum: "$amount" } } },
      ]),
      /* 9. Monthly target */
      MonthlyTarget.findOne({ year, month }).lean(),
      /* 10. Previous month revenue */
      Lead.aggregate([
        { $match: { advanceReceivedDate: { $gte: new Date(year, month - 2, 1), $lt: monthStart }, advanceReceived: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$advanceReceived" } } },
      ]),
      /* 11. Previous month expenses */
      Expense.aggregate([
        { $match: { year: month === 1 ? year - 1 : year, month: month === 1 ? 12 : month - 1 } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      /* 12. Daily revenue this month (for pace chart) */
      Lead.aggregate([
        { $match: { advanceReceivedDate: { $gte: monthStart, $lt: monthEnd }, advanceReceived: { $gt: 0 } } },
        { $group: { _id: { $dayOfMonth: "$advanceReceivedDate" }, revenue: { $sum: "$advanceReceived" } } },
      ]),
    ]);

    /* ── assemble ── */
    const revenue  = monthRevAgg[0]?.total  || 0;
    const expenses = monthExpAgg[0]?.total  || 0;
    const pnl      = revenue - expenses;
    const profitMargin = margin(revenue, expenses);

    const expByCat = {};
    EXPENSE_CATS.forEach(cat => { expByCat[cat] = 0; });
    monthExpCatAgg.forEach(({ _id, total }) => { expByCat[_id] = total; });

    /* Target */
    const monthlyTarget  = targetDoc?.targetRevenue || 0;
    const targetProgress = monthlyTarget > 0 ? Math.min(100, Math.round((revenue / monthlyTarget) * 100)) : 0;
    const dailyRunRate   = daysElapsed > 0 ? revenue / daysElapsed : 0;
    const requiredDailyRate = (daysRemaining > 0 && monthlyTarget > revenue)
      ? (monthlyTarget - revenue) / daysRemaining : 0;
    const projectedRevenue = dailyRunRate * daysInMonth;
    const onTrack = monthlyTarget > 0
      ? projectedRevenue >= monthlyTarget * 0.9  : null;

    /* Pace: expected vs actual */
    const expectedByNow = monthlyTarget > 0 ? (monthlyTarget / daysInMonth) * daysElapsed : 0;
    const paceGap = revenue - expectedByNow;
    const paceStatus = monthlyTarget === 0 ? "no_target"
      : paceGap >= 0             ? "ahead"
      : paceGap >= -expectedByNow * 0.1 ? "on_track"
      : "behind";

    /* Burn rate (avg last 3 months) */
    const burnMonths = burn3Agg.length;
    const burnTotal  = burn3Agg.reduce((s, b) => s + b.total, 0);
    const burnRate   = burnMonths > 0 ? Math.round(burnTotal / burnMonths) : expenses;
    const runway     = burnRate > 0 ? (revenue / burnRate).toFixed(1) : "∞";

    /* MoM */
    const prevRevenue  = prevMonthRevAgg[0]?.total  || 0;
    const prevExpenses = prevMonthExpAgg[0]?.total  || 0;
    const momRevGrowth = prevRevenue  > 0 ? Math.round(((revenue  - prevRevenue)  / prevRevenue)  * 100) : null;
    const momExpChange = prevExpenses > 0 ? Math.round(((expenses - prevExpenses) / prevExpenses) * 100) : null;

    /* 6-month trend */
    const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const trendRevMap = {};
    trendRevAgg.forEach(({ _id, revenue }) => { trendRevMap[`${_id.year}-${_id.month}`] = revenue; });
    const trendExpMap = {};
    trendExpAgg.forEach(({ _id, expenses }) => { trendExpMap[`${_id.year}-${_id.month}`] = expenses; });

    const trend = trendMonths.map(({ year: ty, month: tm }) => {
      const key = `${ty}-${tm}`;
      const rev = trendRevMap[key] || 0;
      const exp = trendExpMap[key] || 0;
      return { year: ty, month: tm, label: MONTHS_SHORT[tm - 1], revenue: rev, expenses: exp, pnl: rev - exp };
    });

    /* Daily pace chart (cumulative) */
    const dailyRevMap = {};
    dailyRevAgg.forEach(({ _id, revenue }) => { dailyRevMap[_id] = revenue; });
    let cumRev = 0;
    const dailyPace = Array.from({ length: daysElapsed }, (_, i) => {
      const day = i + 1;
      cumRev += dailyRevMap[day] || 0;
      const targetLine = monthlyTarget > 0 ? Math.round((monthlyTarget / daysInMonth) * day) : 0;
      return { day, revenue: dailyRevMap[day] || 0, cumRevenue: cumRev, targetLine };
    });

    /* Top clients */
    const topClients = topClientsRaw.map(l => ({
      name:    l.name || l.business || "—",
      business: l.business || l.company || "",
      amount:  l.advanceReceived,
      stage:   l.stage || "",
      branch:  l.branch || "",
      repName: l.repName || "",
    }));

    /* Pipeline */
    const pipelineValue = pipelineAgg[0]?.total || 0;
    const pipelineCount = pipelineAgg[0]?.count || 0;

    return res.json({
      success: true,
      data: {
        /* Period */
        year, month, daysInMonth, daysElapsed, daysRemaining,
        /* Core */
        revenue, expenses, pnl, profitMargin,
        /* Target */
        monthlyTarget, targetProgress, dailyRunRate: Math.round(dailyRunRate),
        requiredDailyRate: Math.round(requiredDailyRate),
        projectedRevenue: Math.round(projectedRevenue),
        onTrack, paceStatus, paceGap: Math.round(paceGap), expectedByNow: Math.round(expectedByNow),
        /* Health */
        burnRate, runway,
        /* MoM */
        prevRevenue, prevExpenses, momRevGrowth, momExpChange,
        /* Breakdown */
        expByCat,
        /* Charts */
        trend, dailyPace,
        /* Tables */
        topClients, pipelineValue, pipelineCount,
      },
    });
  } catch (err) {
    console.error("getPnLDashboard error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

import {
  getDashboardSummary,
  getSalesStats,
  getMonthlyTarget,
  setMonthlyTarget,
} from "../services/dashboard.service.js";

export async function fetchDashboardSummary(req, res) {
  try {
    const result = await getDashboardSummary();
    return res.status(200).json(result);
  } catch (error) {
    console.error("fetchDashboardSummary controller error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch dashboard summary", error: error.message });
  }
}

export async function fetchSalesStats(req, res) {
  try {
    const { period = "month", from, to } = req.query;
    const result = await getSalesStats(period, from, to);
    return res.status(200).json(result);
  } catch (error) {
    console.error("fetchSalesStats controller error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch sales stats", error: error.message });
  }
}

export async function fetchMonthlyTarget(req, res) {
  try {
    const now = new Date();
    const year  = Number(req.query.year  || now.getFullYear());
    const month = Number(req.query.month || now.getMonth() + 1);
    if (!Number.isInteger(month) || month < 1 || month > 12)
      return res.status(400).json({ success: false, message: "month must be 1-12" });
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      return res.status(400).json({ success: false, message: "year must be 2000-2100" });
    const result = await getMonthlyTarget(year, month);
    return res.status(200).json(result);
  } catch (error) {
    console.error("fetchMonthlyTarget error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch target", error: error.message });
  }
}

export async function saveMonthlyTarget(req, res) {
  try {
    const now = new Date();
    const {
      year  = now.getFullYear(),
      month = now.getMonth() + 1,
      targetDeals   = 0,
      targetRevenue = 0,
      notes = "",
    } = req.body;
    const numYear  = Number(year);
    const numMonth = Number(month);
    const numDeals = Number(targetDeals);
    const numRev   = Number(targetRevenue);
    if (!Number.isInteger(numMonth) || numMonth < 1 || numMonth > 12)
      return res.status(400).json({ success: false, message: "month must be 1-12" });
    if (!Number.isInteger(numYear) || numYear < 2000 || numYear > 2100)
      return res.status(400).json({ success: false, message: "year must be 2000-2100" });
    if (isNaN(numDeals) || numDeals < 0)
      return res.status(400).json({ success: false, message: "targetDeals must be a non-negative number" });
    if (isNaN(numRev) || numRev < 0)
      return res.status(400).json({ success: false, message: "targetRevenue must be a non-negative number" });
    const result = await setMonthlyTarget(numYear, numMonth, numDeals, numRev, notes);
    return res.status(200).json(result);
  } catch (error) {
    console.error("saveMonthlyTarget error:", error);
    return res.status(500).json({ success: false, message: "Failed to save target", error: error.message });
  }
}

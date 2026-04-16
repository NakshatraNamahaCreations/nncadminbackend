/**
 * Intelligence Controller
 * Pulls from Leads, Invoices, Quotations, Enquiries in one shot
 * Returns raw data the frontend algorithm uses to generate insights
 */
import Lead     from "../models/Lead.js";
import Invoice  from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import Enquiry  from "../models/Enquiry.js";

const now        = () => new Date();
const day        = 86400000;
const CLOSED      = ["closed","won","deal closed","closed won","job completed","completed","closed - won"];
const LOST        = ["lost","not interested","rejected"];
const closedExpr  = { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, CLOSED] };
const lostExpr    = { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, LOST] };
// not-closed and not-lost for aggregation (no $or inside $not in agg)
const notDoneExpr = { $and: [
  { $not: { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, CLOSED] } },
  { $not: { $in: [{ $toLower: { $ifNull: ["$stage",""] } }, LOST]   } },
] };

function daysAgo(d) { return Math.floor((Date.now() - new Date(d).getTime()) / day); }
function r(n)       { return Math.round(Number(n) || 0); }

export const getIntelligence = async (req, res) => {
  try {
    const n           = now();
    const day30       = new Date(n - 30  * day);
    const day7        = new Date(n - 7   * day);
    const day3        = new Date(n - 3   * day);
    const thisMonthStart = new Date(n.getFullYear(), n.getMonth(), 1);
    const lastMonthStart = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    const day90       = new Date(n - 90  * day);

    const [
      // Leads
      allLeads,
      recentLeads,
      closedLeads,
      staleLeads,
      repPerf,
      stageDistrib,
      sourcePerf,
      lostLeads,

      // Invoices
      unpaidInvoices,
      recentInvoices,
      invoiceSummary,

      // Quotations
      quotStats,
      recentQuots,
      pendingQuots,

      // Enquiries
      recentEnquiries,
      unconvertedEnquiries,
      enquiryByService,
      enquiryStats,
    ] = await Promise.all([

      // ── Lead: overall stats ──────────────────────────────────
      Lead.aggregate([
        { $group: {
          _id: null,
          total:          { $sum: 1 },
          closed:         { $sum: { $cond: [closedExpr, 1, 0] } },
          lost:           { $sum: { $cond: [lostExpr, 1, 0] } },
          totalValue:     { $sum: { $ifNull: ["$value", 0] } },
          totalCollected: { $sum: { $ifNull: ["$advanceReceived", 0] } },
          thisMonth:      { $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, 1, 0] } },
          thisMonthVal:   { $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, { $ifNull: ["$value", 0] }, 0] } },
          lastMonth:      { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", lastMonthStart] }, { $lt: ["$createdAt", thisMonthStart] }] }, 1, 0] } },
          lastMonthVal:   { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", lastMonthStart] }, { $lt: ["$createdAt", thisMonthStart] }] }, { $ifNull: ["$value", 0] }, 0] } },
        }},
      ]),

      // ── Lead: recent 20 leads ────────────────────────────────
      Lead.find({})
        .select("name business phone stage priority value advanceReceived source repName createdAt updatedAt followups")
        .sort({ createdAt: -1 }).limit(20).lean(),

      // ── Lead: recently closed ────────────────────────────────
      Lead.find({ $expr: closedExpr })
        .select("name business phone value advanceReceived updatedAt repName stage")
        .sort({ updatedAt: -1 }).limit(10).lean(),

      // ── Lead: stale (30+ days no update, not closed/lost) ───
      Lead.find({
        updatedAt: { $lt: day30 },
        $expr: notDoneExpr,
      }).select("name business phone stage value updatedAt repName priority").sort({ value: -1 }).limit(15).lean(),

      // ── Rep performance ──────────────────────────────────────
      Lead.aggregate([
        { $group: {
          _id:      { $ifNull: ["$repName", { $ifNull: ["$rep", "Unassigned"] }] },
          total:    { $sum: 1 },
          closed:   { $sum: { $cond: [closedExpr, 1, 0] } },
          lost:     { $sum: { $cond: [lostExpr, 1, 0] } },
          revenue:  { $sum: { $ifNull: ["$value", 0] } },
          collected:{ $sum: { $ifNull: ["$advanceReceived", 0] } },
          stale:    { $sum: { $cond: [{ $and: [{ $lt: ["$updatedAt", day30] }, notDoneExpr] }, 1, 0] } },
          thisMonth:{ $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, 1, 0] } },
          thisMonthClosed: { $sum: { $cond: [{ $and: [closedExpr, { $gte: ["$updatedAt", thisMonthStart] }] }, 1, 0] } },
        }},
        { $sort: { revenue: -1 } },
      ]),

      // ── Stage distribution ───────────────────────────────────
      Lead.aggregate([
        { $group: {
          _id:   "$stage",
          count: { $sum: 1 },
          value: { $sum: { $ifNull: ["$value", 0] } },
        }},
        { $sort: { count: -1 } },
      ]),

      // ── Source performance ───────────────────────────────────
      Lead.aggregate([
        { $group: {
          _id:      { $ifNull: ["$source", "Unknown"] },
          total:    { $sum: 1 },
          closed:   { $sum: { $cond: [closedExpr, 1, 0] } },
          revenue:  { $sum: { $ifNull: ["$value", 0] } },
          collected:{ $sum: { $ifNull: ["$advanceReceived", 0] } },
          thisMonth:{ $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, 1, 0] } },
        }},
        { $sort: { revenue: -1 } },
        { $limit: 12 },
      ]),

      // ── Lost leads (last 90 days) ────────────────────────────
      Lead.find({ $expr: lostExpr, updatedAt: { $gte: day90 } })
        .select("name business value stage source repName updatedAt")
        .sort({ value: -1 }).limit(10).lean(),

      // ── Invoices: unpaid / overdue ───────────────────────────
      Invoice.find({ type: "tax", status: { $nin: ["paid", "cancelled"] } })
        .select("invoiceNumber clientName clientBusiness totalAmount dueDate invoiceDate status officeLocation")
        .sort({ dueDate: 1 }).limit(20).lean(),

      // ── Invoices: recent ─────────────────────────────────────
      Invoice.find({})
        .select("invoiceNumber clientName clientBusiness totalAmount finalizedAmount status type invoiceDate officeLocation")
        .sort({ invoiceDate: -1 }).limit(15).lean(),

      // ── Invoices: summary ────────────────────────────────────
      Invoice.aggregate([
        { $group: {
          _id: null,
          total:       { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ["$totalAmount", 0] } },
          paid:        { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          paidAmount:  { $sum: { $cond: [{ $eq: ["$status", "paid"] }, { $ifNull: ["$totalAmount", 0] }, 0] } },
          unpaidAmount:{ $sum: { $cond: [{ $not: { $in: ["$status", ["paid","cancelled"]] } }, { $ifNull: ["$totalAmount", 0] }, 0] } },
          overdueCount:{ $sum: { $cond: [{ $and: [{ $lt: ["$dueDate", n] }, { $not: { $in: ["$status", ["paid","cancelled"]] } }, { $ne: ["$dueDate", null] }] }, 1, 0] } },
          thisMonth:   { $sum: { $cond: [{ $gte: ["$invoiceDate", thisMonthStart] }, 1, 0] } },
          thisMonthAmt:{ $sum: { $cond: [{ $gte: ["$invoiceDate", thisMonthStart] }, { $ifNull: ["$totalAmount", 0] }, 0] } },
        }},
      ]),

      // ── Quotations: stats ────────────────────────────────────
      Quotation.aggregate([
        { $group: {
          _id: null,
          total:    { $sum: 1 },
          draft:    { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
          sent:     { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $in: ["$status", ["approved","final","converted"]] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          negotiating: { $sum: { $cond: [{ $eq: ["$status", "under_negotiation"] }, 1, 0] } },
          totalValue:  { $sum: { $ifNull: ["$total", 0] } },
          approvedVal: { $sum: { $cond: [{ $in: ["$status", ["approved","final","converted"]] }, { $ifNull: ["$total", 0] }, 0] } },
          thisMonth:   { $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, 1, 0] } },
        }},
      ]),

      // ── Quotations: recent ───────────────────────────────────
      Quotation.find({})
        .select("clientName clientCompany total status createdAt branch services")
        .sort({ createdAt: -1 }).limit(10).lean(),

      // ── Quotations: sent but no response 7+ days ─────────────
      Quotation.find({ status: "sent", updatedAt: { $lt: day7 } })
        .select("clientName clientCompany total createdAt updatedAt branch")
        .sort({ total: -1 }).limit(10).lean(),

      // ── Enquiries: recent ─────────────────────────────────────
      Enquiry.find({})
        .select("name phone company services source branch status followUpDate convertedToLead createdAt")
        .sort({ createdAt: -1 }).limit(20).lean(),

      // ── Enquiries: not converted, 7+ days old ─────────────────
      Enquiry.find({ convertedToLead: false, status: { $nin: ["won","lost"] }, createdAt: { $lt: day7 } })
        .select("name phone company services source branch status createdAt followUpDate")
        .sort({ createdAt: 1 }).limit(15).lean(),

      // ── Enquiries: by service demand ──────────────────────────
      Enquiry.aggregate([
        { $unwind: { path: "$services", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$services", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),

      // ── Enquiries: stats ──────────────────────────────────────
      Enquiry.aggregate([
        { $group: {
          _id: null,
          total:       { $sum: 1 },
          won:         { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
          lost:        { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
          newCount:    { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
          converted:   { $sum: { $cond: [{ $eq: ["$convertedToLead", true] }, 1, 0] } },
          thisMonth:   { $sum: { $cond: [{ $gte: ["$createdAt", thisMonthStart] }, 1, 0] } },
          uncontacted: { $sum: { $cond: [{ $eq: ["$status", "new"] }, 1, 0] } },
        }},
      ]),
    ]);

    const AL  = allLeads[0]   || {};
    const IS  = invoiceSummary[0] || {};
    const QS  = quotStats[0]  || {};
    const ES  = enquiryStats[0]  || {};

    return res.json({
      success: true,
      data: {
        // ── Lead vitals ───────────────────────────────────────
        leads: {
          total:          AL.total         || 0,
          closed:         AL.closed        || 0,
          lost:           AL.lost          || 0,
          totalValue:     r(AL.totalValue),
          totalCollected: r(AL.totalCollected),
          pendingBalance: r((AL.totalValue || 0) - (AL.totalCollected || 0)),
          convRate:       AL.total > 0 ? +((AL.closed / AL.total) * 100).toFixed(1) : 0,
          thisMonth:      AL.thisMonth     || 0,
          thisMonthVal:   r(AL.thisMonthVal),
          lastMonth:      AL.lastMonth     || 0,
          lastMonthVal:   r(AL.lastMonthVal),
          momGrowth:      AL.lastMonthVal > 0 ? +(((AL.thisMonthVal - AL.lastMonthVal) / AL.lastMonthVal) * 100).toFixed(1) : 0,
          collectionPct:  AL.totalValue > 0 ? +((AL.totalCollected / AL.totalValue) * 100).toFixed(1) : 0,
        },

        // ── Individual records ────────────────────────────────
        recentLeads:   recentLeads.map(l => ({ ...l, daysOld: daysAgo(l.createdAt), daysSilent: daysAgo(l.updatedAt) })),
        closedLeads:   closedLeads.map(l => ({ ...l, balance: r((l.value || 0) - (l.advanceReceived || 0)) })),
        staleLeads:    staleLeads.map(l => ({ ...l, daysSilent: daysAgo(l.updatedAt) })),
        lostLeads:     lostLeads.map(l => ({ ...l, daysAgo: daysAgo(l.updatedAt) })),

        // ── Rep performance ───────────────────────────────────
        repPerf: repPerf.map(r => ({
          rep:       r._id || "Unassigned",
          total:     r.total,
          closed:    r.closed,
          lost:      r.lost,
          revenue:   Math.round(r.revenue || 0),
          collected: Math.round(r.collected || 0),
          stale:     r.stale,
          convRate:  r.total > 0 ? +((r.closed / r.total) * 100).toFixed(1) : 0,
          thisMonth: r.thisMonth,
          thisMonthClosed: r.thisMonthClosed,
        })),

        // ── Stage & source ────────────────────────────────────
        stageDistrib: stageDistrib.map(s => ({ stage: s._id || "Unknown", count: s.count, value: r(s.value) })),
        sourcePerf:   sourcePerf.map(s => ({
          source:   s._id || "Unknown",
          total:    s.total,
          closed:   s.closed,
          revenue:  r(s.revenue),
          convRate: s.total > 0 ? +((s.closed / s.total) * 100).toFixed(1) : 0,
          thisMonth: s.thisMonth,
        })),

        // ── Invoices ──────────────────────────────────────────
        invoices: {
          total:        IS.total        || 0,
          totalAmount:  r(IS.totalAmount),
          paid:         IS.paid         || 0,
          paidAmount:   r(IS.paidAmount),
          unpaidAmount: r(IS.unpaidAmount),
          overdueCount: IS.overdueCount || 0,
          thisMonth:    IS.thisMonth    || 0,
          thisMonthAmt: r(IS.thisMonthAmt),
        },
        unpaidInvoices: unpaidInvoices.map(inv => ({
          ...inv,
          isOverdue: inv.dueDate ? new Date(inv.dueDate) < n : false,
          daysOverdue: inv.dueDate ? Math.max(0, daysAgo(inv.dueDate)) : null,
        })),
        recentInvoices,

        // ── Quotations ────────────────────────────────────────
        quotations: {
          total:       QS.total       || 0,
          draft:       QS.draft       || 0,
          sent:        QS.sent        || 0,
          approved:    QS.approved    || 0,
          rejected:    QS.rejected    || 0,
          negotiating: QS.negotiating || 0,
          totalValue:  r(QS.totalValue),
          approvedVal: r(QS.approvedVal),
          convRate:    QS.total > 0 ? +((QS.approved / QS.total) * 100).toFixed(1) : 0,
          thisMonth:   QS.thisMonth   || 0,
        },
        recentQuots,
        pendingQuots: pendingQuots.map(q => ({ ...q, daysSinceUpdate: daysAgo(q.updatedAt) })),

        // ── Enquiries ─────────────────────────────────────────
        enquiries: {
          total:       ES.total       || 0,
          won:         ES.won         || 0,
          lost:        ES.lost        || 0,
          newCount:    ES.newCount    || 0,
          converted:   ES.converted   || 0,
          thisMonth:   ES.thisMonth   || 0,
          convRate:    ES.total > 0 ? +((ES.converted / ES.total) * 100).toFixed(1) : 0,
          uncontacted: ES.uncontacted || 0,
        },
        recentEnquiries,
        unconvertedEnquiries: unconvertedEnquiries.map(e => ({ ...e, daysWaiting: daysAgo(e.createdAt) })),
        enquiryByService,
      },
    });
  } catch (err) {
    console.error("getIntelligence error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

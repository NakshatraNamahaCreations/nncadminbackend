import Lead from "../models/Lead.js";

/**
 * GET /api/gst-report?month=2026-04
 * Returns GST summary and itemised leads for a given month,
 * based on advanceReceivedDate falling within the month.
 */
export const getGstReport = async (req, res) => {
  try {
    const { month } = req.query; // "YYYY-MM"
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "month param required (YYYY-MM)" });
    }

    const [year, mon] = month.split("-").map(Number);
    // Use ISO strings so comparison works regardless of stored type
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end   = new Date(Date.UTC(year, mon, 1));

    // All leads where a payment was received in this month:
    // 1. advanceReceivedDate falls in this month, OR
    // 2. no date set but lead was updated/created this month with a payment
    const leads = await Lead.find({
      advanceReceived: { $gt: 0 },
      $or: [
        { advanceReceivedDate: { $gte: start, $lt: end } },
        {
          advanceReceivedDate: { $in: [null, undefined] },
          updatedAt: { $gte: start, $lt: end },
        },
        {
          advanceReceivedDate: { $in: [null, undefined] },
          createdAt: { $gte: start, $lt: end },
        },
      ],
    })
      .select("name business company phone branch gstApplicable gstRate value advanceReceived advanceReceivedDate createdAt updatedAt")
      .lean();

    const gstLeads    = [];
    const nonGstLeads = [];

    let totalGstPayable   = 0;
    let totalGstTaxable   = 0;
    let totalGstInvoiced  = 0;
    let totalNonGstAmount = 0;

    for (const lead of leads) {
      const payment = lead.advanceReceived || 0;
      if (payment <= 0) continue;

      const rate       = lead.gstRate || 18;
      const company    = lead.company || lead.business || "";
      const paymentDate = lead.advanceReceivedDate || lead.updatedAt || lead.createdAt;

      if (lead.gstApplicable) {
        // GST is extra on top of payment received
        const gstAmount  = +(payment * rate / 100).toFixed(2);
        const totalBill  = +(payment + gstAmount).toFixed(2);
        totalGstPayable  += gstAmount;
        totalGstTaxable  += payment;
        totalGstInvoiced += totalBill;
        gstLeads.push({
          _id:             lead._id,
          name:            lead.name,
          company,
          phone:           lead.phone,
          branch:          lead.branch,
          gstRate:         rate,
          paymentReceived: payment,
          taxableAmount:   payment,
          gstAmount,
          totalBill,
          paymentDate,
        });
      } else {
        totalNonGstAmount += payment;
        nonGstLeads.push({
          _id:             lead._id,
          name:            lead.name,
          company,
          phone:           lead.phone,
          branch:          lead.branch,
          paymentReceived: payment,
          paymentDate,
        });
      }
    }

    return res.json({
      success: true,
      month,
      summary: {
        totalGstPayable:   +totalGstPayable.toFixed(2),
        totalGstTaxable:   +totalGstTaxable.toFixed(2),
        totalGstInvoiced:  +totalGstInvoiced.toFixed(2),
        totalNonGstAmount: +totalNonGstAmount.toFixed(2),
        gstLeadCount:      gstLeads.length,
        nonGstLeadCount:   nonGstLeads.length,
      },
      gstLeads,
      nonGstLeads,
    });
  } catch (err) {
    console.error("getGstReport error:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to generate GST report" });
  }
};

import Lead from "../models/Lead.js";
import Enquiry from "../models/Enquiry.js";
import Quotation from "../models/Quotation.js";
import Invoice from "../models/Invoice.js";
import PaymentRecord from "../models/PaymentRecord.js";
import PaymentClient from "../models/PaymentClient.js";
import RecurringService from "../models/RecurringService.js";
import Expense from "../models/Expense.js";
import SalaryRecord from "../models/SalaryRecord.js";
import RentConfig from "../models/RentConfig.js";
import MonthlyTarget from "../models/MonthlyTarget.js";
import Employee from "../models/Employee.js";

// GET /api/dashboard/owner-view
// One read of the real records for the Dashboard: what came in, what is owed, salaries,
// projects and branches. Nothing is written. The page works out its views from these lists.

const TEAM = ["Harish", "Nithin"];
const owner = (raw) => {
  const w = String(raw || "").trim().split(/\s+/)[0] || "";
  const n = w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
  return TEAM.includes(n) ? n : "Unassigned";
};
const gstTotal = (v, on, rate) => { const b = Number(v) || 0; return on ? b + Math.round((b * (Number(rate) || 0)) / 100) : b; };
const ym = (d) => (d ? new Date(d).toISOString().slice(0, 7) : "");
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export async function ownerView(req, res) {
  try {
    const now = new Date();
    const thisYm = ym(now);
    const lastD = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastYm = ym(lastD);
    const since = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    const [leads, records, clients, services, expenses, salaries, rents, target, enquiries, quotes, invoices, staff] = await Promise.all([
      Lead.find({}).select("name business company phone branch stage status value gstApplicable gstRate advanceReceived advanceReceivedDate onboardedDate finalPaymentDate projectStage projectCompleted projectCompletionDate projectStartDate repName rep source createdAt updatedAt").lean(),
      PaymentRecord.find({ date: { $gte: since } }).select("date client amount mode tds tdsAmt tdsStatus invoiceId invoice clientId").lean(),
      PaymentClient.find({}).select("client contact totalValue received status deadline lastFollowUp priority project").lean(),
      RecurringService.find({}).select("lead name type amount gstApplicable gstRate billingDay startDate endDate payments").populate("lead", "name business phone branch repName").lean(),
      Expense.find({ date: { $gte: since } }).select("category branch amount date month year status").lean(),
      SalaryRecord.find({}).select("month year netSalary grossSalary branch paidDate").lean(),
      RentConfig.find({}).select("branch amount dueDay").lean(),
      MonthlyTarget.findOne({ year: now.getFullYear(), month: now.getMonth() + 1 }).lean(),
      Enquiry.find({ status: { $in: ["new", "contacted", "follow-up", "quoted"] } }).select("status createdAt updatedAt followUpDate assignedTo").lean(),
      Quotation.find({}).select("clientName clientPhone status total createdAt updatedAt branch").lean(),
      Invoice.find({}).select("type status totalAmount invoiceDate dueDate clientName officeLocation leadId createdAt").lean(),
      Employee.countDocuments({ isActive: true }),
    ]);

    /* projects: every closed deal, with what is owed on it */
    const projects = leads.filter(l => /closed/i.test(`${l.stage} ${l.status}`) && !/lost/i.test(`${l.stage} ${l.status}`)).map(l => {
      const total = gstTotal(l.value, l.gstApplicable, l.gstRate), received = Number(l.advanceReceived) || 0;
      return {
        id: String(l._id), name: l.name, company: l.business || l.company || "", phone: l.phone || "", branch: l.branch || "",
        owner: owner(l.repName || l.rep), stage: l.projectStage || "", completed: !!l.projectCompleted || l.projectStage === "Project Completed",
        total, received, balance: Math.max(0, total - received), gst: !!l.gstApplicable,
        advanceDate: iso(l.advanceReceivedDate), onboarded: iso(l.onboardedDate), finalDue: iso(l.finalPaymentDate),
        endDate: iso(l.projectCompletionDate), startDate: iso(l.projectStartDate), created: iso(l.createdAt), updated: iso(l.updatedAt),
      };
    });

    /* money that came in, by month: project advances, Payment Tracker entries, monthly service payments */
    const inflow = {};
    const add = (m, k, v, br) => {
      if (!m) return;
      const x = inflow[m] || (inflow[m] = { adv: 0, rec: 0, svc: 0, byBranch: {} });
      x[k] += v;
      if (br) x.byBranch[br] = (x.byBranch[br] || 0) + v;
    };
    leads.forEach(l => { if (l.advanceReceivedDate && l.advanceReceived) add(ym(l.advanceReceivedDate), "adv", Number(l.advanceReceived), l.branch); });
    records.forEach(r => add(ym(r.date), "rec", Number(r.amount) || 0, ""));
    services.forEach(s => (s.payments || []).forEach(p => { if (!p.waived && p.date) add(ym(p.date), "svc", Number(p.amount) || 0, s.lead?.branch || ""); }));

    /* monthly services: is this month paid? */
    const svc = services.filter(s => !s.endDate || new Date(s.endDate) >= now).map(s => {
      const fee = gstTotal(s.amount, s.gstApplicable, s.gstRate);
      const paidThis = (s.payments || []).some(p => p.period === thisYm);
      const started = !s.startDate || ym(s.startDate) <= thisYm;
      const day = Math.min(28, Math.max(1, Number(s.billingDay) || 1));
      return {
        id: String(s._id), name: s.lead?.business || s.lead?.name || s.name, service: s.type || s.name, fee, billingDay: day,
        dueDate: `${thisYm}-${String(day).padStart(2, "0")}`, paidThis, started, branch: s.lead?.branch || "", owner: owner(s.lead?.repName),
        phone: s.lead?.phone || "", months: (s.payments || []).length,
      };
    });

    /* Payment Tracker clients with a balance */
    const tracker = clients.map(c => ({
      id: String(c._id), name: c.client, contact: c.contact || "", project: c.project || "", total: Number(c.totalValue) || 0, received: Number(c.received) || 0,
      balance: Math.max(0, (Number(c.totalValue) || 0) - (Number(c.received) || 0)), status: c.status, deadline: iso(c.deadline), lastFollowUp: iso(c.lastFollowUp),
    })).filter(c => c.balance > 0);

    /* costs: expenses by month and branch, salary bill, rent */
    const cost = {};
    expenses.forEach(e => {
      const m = e.year && e.month ? `${e.year}-${String(e.month).padStart(2, "0")}` : ym(e.date);
      const x = cost[m] || (cost[m] = { total: 0, salary: 0, byBranch: {}, byCat: {} });
      const a = Number(e.amount) || 0;
      x.total += a; x.byBranch[e.branch || "General"] = (x.byBranch[e.branch || "General"] || 0) + a;
      x.byCat[e.category || "other"] = (x.byCat[e.category || "other"] || 0) + a;
      if (e.category === "salary") x.salary += a;
    });
    const runs = {};
    salaries.forEach(s => { const k = `${s.year}-${String(s.month).padStart(2, "0")}`; const x = runs[k] || (runs[k] = { net: 0, n: 0, unpaid: 0 }); x.net += Number(s.netSalary) || 0; x.n++; if (!s.paidDate) x.unpaid++; });
    const lastRun = Object.keys(runs).sort().pop();

    /* follow-up numbers for "only you" and "can you trust these numbers" */
    const day = 864e5;
    const openEnq = enquiries.length;
    const idleEnq = enquiries.filter(e => now - new Date(e.updatedAt) > 30 * day).length;
    const newEnq = enquiries.filter(e => e.status === "new" && now - new Date(e.createdAt) <= 14 * day).length;
    const quoteWait = quotes.filter(q => ["sent", "under_negotiation"].includes(q.status) && now - new Date(q.updatedAt || q.createdAt) > 3 * day);
    const invDraft = invoices.filter(i => i.status === "draft" && now - new Date(i.createdAt) > 7 * day).length;
    const invSent = invoices.filter(i => i.status === "sent");

    return res.json({
      success: true,
      data: {
        today: iso(now), thisYm, lastYm, staff,
        projects, tracker, services: svc,
        inflow, cost, salaryRuns: runs, lastRun, rents: rents.map(r => ({ branch: r.branch, amount: r.amount, dueDay: r.dueDay })),
        target: target ? { revenue: target.targetRevenue || 0, deals: target.targetDeals || 0 } : null,
        tds: records.filter(r => r.tds || r.tdsAmt).map(r => ({ client: r.client, date: iso(r.date), amount: r.amount, tds: r.tdsAmt || 0, status: r.tdsStatus })),
        leadsDesk: { openEnq, idleEnq, newEnq, quoteWait: quoteWait.length, quoteWaitVal: quoteWait.reduce((a, q) => a + (Number(q.total) || 0), 0) },
        invoices: { draftOld: invDraft, sent: invSent.length, sentVal: invSent.reduce((a, i) => a + (Number(i.totalAmount) || 0), 0) },
        checks: {
          idleEnq,
          pastEnd: projects.filter(p => !p.completed && p.endDate && p.endDate < iso(now)).length,
          noStage: projects.filter(p => !p.stage && !p.completed).length,
          unlinkedPay: records.filter(r => !r.invoiceId && !r.invoice).length,
          salaryUnpaid: lastRun ? runs[lastRun].unpaid : 0,
          noAdvanceDate: projects.filter(p => p.received > 0 && !p.advanceDate).length,
        },
      },
    });
  } catch (err) {
    console.error("ownerView error:", err);
    return res.status(500).json({ success: false, message: "Could not load the dashboard" });
  }
}

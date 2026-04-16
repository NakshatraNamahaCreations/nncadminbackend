import Lead from "../models/Lead.js";
import OwnerNote from "../models/OwnerNote.js";
import mongoose from "mongoose";

// ─── helpers ────────────────────────────────────────────────
const daysDiff = (date) => {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
};

const todayStart = () => {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
};
const todayEnd = () => {
  const d = new Date(); d.setHours(23, 59, 59, 999); return d;
};

// ─── GET /api/owner-desk ────────────────────────────────────
export const getOwnerDesk = async (req, res) => {
  try {
    const now     = new Date();
    const tStart  = todayStart();
    const tEnd    = todayEnd();
    const day30   = new Date(now - 30 * 86400000);
    const day7    = new Date(now - 7  * 86400000);
    const day5    = new Date(now - 5  * 86400000);
    const day2    = new Date(now - 2  * 86400000);

    const SEL = "name business company phone stage priority value advanceReceived advanceReceivedDate updatedAt createdAt";

    // Run all 6 targeted queries in parallel — much faster than full scan
    const [
      paymentChaseLeads,   // closed, balance pending
      followupDueLeads,    // followups due today or overdue
      hotColdLeads,        // hot priority, no activity 5+ days, not closed
      approvalLeads,       // awaiting approval 2+ days
      overdueProjects,     // project past deadline, not completed
      idleEnquiries,       // stuck in Enquiry/Lead Capture 2+ days
      // stats queries
      allLeadsStats,
    ] = await Promise.all([
      // 1. Payment chase — closed with balance
      Lead.find({ stage: { $in: ["Closed","closed","Won","won"] }, advanceReceived: { $exists: true } })
          .select(SEL).lean(),

      // 2. Follow-ups due today or overdue
      Lead.find({
        "followups": { $elemMatch: { done: false, dueDate: { $lte: tEnd } } },
      }).select(`${SEL} followups`).lean(),

      // 3. Hot leads gone cold (no activity in 5+ days, not closed)
      Lead.find({
        priority: { $regex: /hot/i },
        stage: { $not: /closed|won/i },
        updatedAt: { $lt: day5 },
      }).select(SEL).lean(),

      // 4. Awaiting approval 2+ days
      Lead.find({
        approvalStatus: "pending",
        stage: "Awaiting Approval",
        updatedAt: { $lt: day2 },
      }).select(SEL).lean(),

      // 5. Overdue project delivery
      Lead.find({
        projectCompletionDate: { $lt: now },
        projectCompleted: { $ne: true },
      }).select(`${SEL} projectCompletionDate`).lean(),

      // 6. Idle enquiries (2+ days in Enquiry/Lead Capture stage)
      Lead.find({
        stage: { $in: ["Enquiry","Lead Capture"] },
        createdAt: { $lt: day2 },
      }).select(SEL).lean(),

      // Stats aggregation — single pass for financials + counts
      Lead.aggregate([
        { $group: {
          _id: null,
          totalLeads:     { $sum: 1 },
          closedLeads:    { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ["$stage",""] }, regex: /closed|won/i } }, 1, 0] } },
          totalVal:       { $sum: { $ifNull: ["$value", 0] } },
          totalCollected: { $sum: { $ifNull: ["$advanceReceived", 0] } },
          pipelineVal:    { $sum: { $cond: [{ $not: { $regexMatch: { input: { $ifNull: ["$stage",""] }, regex: /closed|won/i } } }, { $ifNull: ["$value",0] }, 0] } },
          fusDone:        { $sum: { $size: { $filter: { input: { $ifNull: ["$followups",[]] }, cond: "$$this.done" } } } },
          fusDue:         { $sum: { $size: { $filter: { input: { $ifNull: ["$followups",[]] }, cond: {
            $and: [{ $not: "$$this.done" }, { $lte: ["$$this.dueDate", tEnd] }]
          } } } } },
        }},
      ]),
    ]);

    const assignments = [];

    // ── 1. Payment Chase ────────────────────────────────────
    for (const lead of paymentChaseLeads) {
      const balance = (lead.value||0) - (lead.advanceReceived||0);
      if (balance <= 0) continue;
      const id = String(lead._id), biz = lead.business||lead.company||"";
      const daysPending = daysDiff(lead.advanceReceivedDate || lead.updatedAt);
      const urgency = daysPending > 30 ? "critical" : daysPending > 7 ? "high" : "medium";
      assignments.push({
        id:`pay-${id}`, type:"payment", priority:urgency,
        score:urgency==="critical"?100:urgency==="high"?80:55,
        title:`Collect payment from ${lead.name||"Unknown"}`,
        subtitle:`${biz?biz+" · ":""}₹${(balance/1000).toFixed(1)}K pending · ${daysPending}d overdue`,
        phone:lead.phone||"", leadId:id,
      });
    }

    // ── 2. Follow-ups Due ────────────────────────────────────
    for (const lead of followupDueLeads) {
      const id = String(lead._id), biz = lead.business||lead.company||"";
      for (const fu of (lead.followups||[])) {
        if (fu.done || !fu.dueDate) continue;
        if (new Date(fu.dueDate) > tEnd) continue;
        const isOverdue = new Date(fu.dueDate) < tStart;
        assignments.push({
          id:`fu-${id}-${fu.dayIndex||fu._id}`, type:"followup", priority:"high",
          score:isOverdue?78:72,
          title:`Follow up with ${lead.name||"Unknown"}`,
          subtitle:`${fu.title||"Follow-up"} · ${biz}${isOverdue?` · ${daysDiff(fu.dueDate)}d overdue`:" · Due today"}`,
          phone:lead.phone||"", leadId:id,
        });
      }
    }

    // ── 3. Hot Leads Gone Cold ───────────────────────────────
    for (const lead of hotColdLeads) {
      const id = String(lead._id), biz = lead.business||lead.company||"";
      const lastActivity = daysDiff(lead.updatedAt);
      assignments.push({
        id:`cold-${id}`, type:"hot_cold",
        priority:lastActivity>=10?"high":"medium", score:lastActivity>=10?70:50,
        title:`Hot lead going cold — ${lead.name||"Unknown"}`,
        subtitle:`${biz?biz+" · ":""}${lead.stage} · No activity in ${lastActivity} days`,
        phone:lead.phone||"", leadId:id,
      });
    }

    // ── 4. Approval Pending ──────────────────────────────────
    for (const lead of approvalLeads) {
      const id = String(lead._id), biz = lead.business||lead.company||"";
      const waiting = daysDiff(lead.updatedAt);
      assignments.push({
        id:`appr-${id}`, type:"approval",
        priority:waiting>=7?"high":"medium", score:waiting>=7?65:45,
        title:`Nudge approval for ${lead.name||"Unknown"}`,
        subtitle:`${biz?biz+" · ":""}Waiting ${waiting} days for approval`,
        phone:lead.phone||"", leadId:id,
      });
    }

    // ── 5. Overdue Projects ──────────────────────────────────
    for (const lead of overdueProjects) {
      const id = String(lead._id), biz = lead.business||lead.company||"";
      const daysLate = daysDiff(lead.projectCompletionDate);
      assignments.push({
        id:`proj-${id}`, type:"project",
        priority:daysLate>=14?"critical":daysLate>=7?"high":"medium",
        score:daysLate>=14?90:daysLate>=7?68:48,
        title:`Overdue delivery — ${lead.name||"Unknown"}`,
        subtitle:`${biz?biz+" · ":""}Project ${daysLate}d past deadline`,
        phone:lead.phone||"", leadId:id,
      });
    }

    // ── 6. Idle Enquiries ────────────────────────────────────
    for (const lead of idleEnquiries) {
      const id = String(lead._id), biz = lead.business||lead.company||"";
      assignments.push({
        id:`enq-${id}`, type:"enquiry", priority:"medium", score:40,
        title:`Convert enquiry — ${lead.name||"Unknown"}`,
        subtitle:`${biz?biz+" · ":""}Sitting in ${lead.stage} for ${daysDiff(lead.createdAt)} days`,
        phone:lead.phone||"", leadId:id,
      });
    }

    // Dedup + sort
    const seen = new Set();
    const unique = assignments
      .filter(a => { if(seen.has(a.id)) return false; seen.add(a.id); return true; })
      .sort((a,b) => b.score - a.score);

    // ── Business Score from aggregation ────────────────────
    const s = allLeadsStats[0] || {};
    const totalLeads     = s.totalLeads     || 0;
    const closedLeads    = s.closedLeads    || 0;
    const totalVal       = s.totalVal       || 0;
    const totalCollected = s.totalCollected || 0;
    const fusDone        = s.fusDone        || 0;
    const fusDue         = s.fusDue         || 0;
    const pipelineValue  = s.pipelineVal    || 0;
    const totalPending   = totalVal - totalCollected;

    const paymentScore = totalVal>0 ? Math.round((totalCollected/totalVal)*30) : 15;
    const convScore    = totalLeads>0 ? Math.round((closedLeads/totalLeads)*20) : 0;
    const fuScore      = fusDone>0 ? Math.round((fusDone/(fusDone+fusDue))*25) : 20;
    const urgencyScore = Math.max(0, 25 - unique.filter(a=>a.priority==="critical").length*5);
    const businessScore = Math.min(100, paymentScore+convScore+fuScore+urgencyScore);

    const criticalCount = unique.filter(a=>a.priority==="critical").length;
    const highCount     = unique.filter(a=>a.priority==="high").length;

    return res.json({
      success: true,
      assignments: unique.slice(0, 30),
      businessScore,
      quickStats: {
        totalAssignments:  unique.length,
        criticalCount,
        highCount,
        totalPending,
        totalLeads,
        closedLeads,
        followupsDueToday: followupDueLeads.length,
      },
      financials: {
        totalPipelineValue: pipelineValue,
        totalDealValue:     totalVal,
        totalCollected,
        totalPending,
        collectionPct:      totalVal > 0 ? Math.round((totalCollected / totalVal) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("ownerDesk error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/owner-desk/notes ──────────────────────────────
export const getNotes = async (req, res) => {
  try {
    const { date, type } = req.query;
    const filter = {};
    if (date) filter.date = date;
    if (type) filter.type = type;
    else filter.type = "note"; // default: diary notes only
    const notes = await OwnerNote.find(filter).sort({ pinned: -1, createdAt: -1 }).limit(200);
    return res.json({ success: true, notes });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/owner-desk/payment-expected ───────────────────
export const getPaymentExpected = async (req, res) => {
  try {
    // Show uncollected payment expectations, upcoming (next 7 days + overdue)
    const since = new Date(); since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0,10);
    const entries = await OwnerNote.find({
      type: "payment_expected",
      collected: false,
      expectedDate: { $gte: sinceStr },
    }).sort({ expectedDate: 1 }).limit(50);
    return res.json({ success: true, entries });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/owner-desk/notes ─────────────────────────────
export const addNote = async (req, res) => {
  try {
    const { text, date, pinned, type, amount, expectedDate, leadId, leadName } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: "Text required" });
    const note = await OwnerNote.create({
      text: text.trim(),
      date: date || new Date().toISOString().slice(0,10),
      pinned: !!pinned,
      type:   type || "note",
      amount: amount ? Number(amount) : null,
      expectedDate: expectedDate || null,
      leadId:   leadId   || null,
      leadName: leadName || null,
    });
    return res.status(201).json({ success: true, note });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/owner-desk/notes/:id ───────────────────────
export const deleteNote = async (req, res) => {
  try {
    await OwnerNote.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/owner-desk/notes/:id/collect ────────────────
export const markCollected = async (req, res) => {
  try {
    const note = await OwnerNote.findById(req.params.id);
    if (!note) return res.status(404).json({ success: false, message: "Not found" });

    const wasCollected = note.collected;
    note.collected    = !wasCollected;
    note.collectedAt  = note.collected ? new Date() : null;
    await note.save();

    let leadUpdated = false;
    // If linked to a lead and we're marking as collected — add to lead's advanceReceived
    if (note.collected && !wasCollected && note.leadId && note.amount > 0) {
      const lead = await Lead.findById(note.leadId);
      if (lead) {
        lead.advanceReceived = (lead.advanceReceived || 0) + note.amount;
        lead.advanceReceivedDate = new Date();
        await lead.save();
        leadUpdated = true;
      }
    }

    return res.json({ success: true, note, leadUpdated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/owner-desk/lead-search?q= ─────────────────────
export const leadSearch = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, leads: [] });
    const regex = new RegExp(q, "i");
    const leads = await Lead.find({
      $or: [{ name: regex }, { business: regex }, { company: regex }, { phone: regex }],
    }).select("name business company phone advanceReceived value").limit(8).lean();
    return res.json({ success: true, leads });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PATCH /api/owner-desk/notes/:id/pin ────────────────────
export const pinNote = async (req, res) => {
  try {
    const note = await OwnerNote.findById(req.params.id);
    if (!note) return res.status(404).json({ success: false, message: "Not found" });
    note.pinned = !note.pinned;
    await note.save();
    return res.json({ success: true, note });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

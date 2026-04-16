import mongoose from "mongoose";

const StageTimestampSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    done: { type: Boolean, default: false },
    at: { type: Date, default: null },
  },
  { _id: false }
);

const BantDetailsSchema = new mongoose.Schema(
  {
    budgetMin: { type: Number, default: 0 },
    budgetMax: { type: Number, default: 0 },
    authorityName: { type: String, default: "" },
    authorityRole: { type: String, default: "" },
    need: { type: String, default: "" },
    timeline: { type: String, default: "" },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const FollowupSchema = new mongoose.Schema(
  {
    dayIndex: { type: Number, default: 0 },
    title: { type: String, default: "" },
    channel: { type: String, default: "" },
    status: { type: String, default: "Pending" },
    done: { type: Boolean, default: false },
    dueDate: { type: Date, default: null },
    by: { type: String, default: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CommLogSchema = new mongoose.Schema(
  {
    type: { type: String, default: "Communication" },
    summary: { type: String, default: "" },
    durationMin: { type: Number, default: 0 },
    by: { type: String, default: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const HistorySchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    meta: { type: String, default: "" },
    by: { type: String, default: "System" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const MOMSchema = new mongoose.Schema(
  {
    title:     { type: String, default: "" },
    summary:   { type: String, default: "" },
    attendees: { type: String, default: "" },
    date:      { type: Date,   default: null },
    by:        { type: String, default: "User" },
    at:        { type: Date,   default: Date.now },
  },
  { _id: false }
);

const EmailLogSchema = new mongoose.Schema(
  {
    type:        { type: String, default: "" },
    sentTo:      { type: String, default: "" },
    subject:     { type: String, default: "" },
    body:        { type: String, default: "" },   // brief summary of what was sent
    sentAt:      { type: Date,   default: Date.now },
    response:    { type: String, default: "" },   // client's reply / notes
    respondedAt: { type: Date,   default: null },
  }
  // _id enabled intentionally — needed for response patch route
);

const NoteSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    by: { type: String, default: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DocumentSchema = new mongoose.Schema(
  {
    tag: { type: String, default: "Invoice" },
    originalName: { type: String, default: "" },
    name: { type: String, default: "" },
    notes: { type: String, default: "" },
    url: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
    documentDate: { type: String, default: "" },
    by: { type: String, default: "User" },
  },
  { _id: false }
);

const LeadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    mobile: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    business: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true },
    industry: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    requirements: { type: String, default: "", trim: true },
    branch: { type: String, default: "Bangalore", trim: true },
    source: { type: String, default: "WhatsApp", trim: true },
    stage: { type: String, default: "Lead Capture", trim: true },
    status: { type: String, default: "new", trim: true },
    priority: { type: String, default: "Hot", trim: true },
    value: { type: Number, default: 0, min: 0 },
    dealValue: { type: Number, default: 0, min: 0 },
    advanceReceived: { type: Number, default: 0, min: 0 },
    advanceReceivedDate: { type: Date, default: null },
    agreedTimeline: { type: Number, default: 0 },
    finalPaymentDate: { type: Date, default: null },
    onboardedDate: { type: Date, default: null },
    projectCompleted: { type: Boolean, default: false },
    projectCompletionDate: { type: Date, default: null },
    days: { type: String, default: "0d", trim: true },
    rep: { type: String, default: "", trim: true },
    repId: { type: mongoose.Schema.Types.ObjectId, ref: "Rep", default: null },
    repName: { type: String, default: "", trim: true },
    bant: { type: String, default: "0/4", trim: true },
    bantDetails: { type: BantDetailsSchema, default: () => ({}) },
    stageTimings: {
      new: { type: Number, default: 0 },
      qualified: { type: Number, default: 0 },
      proposal: { type: Number, default: 0 },
      negotiation: { type: Number, default: 0 },
      closed: { type: Number, default: 0 },
    },
    stageTimestamps: { type: [StageTimestampSchema], default: [] },
    followups: { type: [FollowupSchema], default: [] },
    commLogs: { type: [CommLogSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
    notes: { type: [NoteSchema], default: [] },
    documents: { type: [DocumentSchema], default: [] },
    projectStartDate: { type: Date, default: null },
    approvalStatus: { type: String, default: "pending", trim: true },
    gstApplicable:  { type: Boolean, default: false },
    gstRate:        { type: Number,  default: 18 },
    momLogs: { type: [MOMSchema], default: [] },
    emailLogs: { type: [EmailLogSchema], default: [] },
  },
  { timestamps: true }
);

/* ─── Single-field indexes (keep existing) ─── */
LeadSchema.index({ phone: 1 });
LeadSchema.index({ rep: 1 });
LeadSchema.index({ repId: 1 });
LeadSchema.index({ repName: 1 });
LeadSchema.index({ branch: 1 });
LeadSchema.index({ stage: 1 });
LeadSchema.index({ status: 1 });
LeadSchema.index({ createdAt: -1 });

/* ─── Compound indexes for analytics & aggregations ─── */
LeadSchema.index({ branch: 1, stage: 1 });                    // branch performance queries
LeadSchema.index({ stage: 1, createdAt: -1 });                // funnel + pipeline filtered by stage
LeadSchema.index({ source: 1, stage: 1 });                    // source conversion analytics
LeadSchema.index({ repName: 1, stage: 1 });                   // rep leaderboard
LeadSchema.index({ value: -1, advanceReceived: 1 });          // payment alerts (outstanding balance)
LeadSchema.index({ onboardedDate: 1, projectCompleted: 1 });  // project tracking
LeadSchema.index({ projectCompleted: 1, approvalStatus: 1 }); // approval watchlist
LeadSchema.index({ advanceReceivedDate: -1 });                 // monthly payment health
LeadSchema.index({ updatedAt: -1 });                           // recent activity feed
LeadSchema.index({ "followups.dueDate": 1, "followups.done": 1 }); // today plan followup query
LeadSchema.index({ gstApplicable: 1, advanceReceivedDate: -1 }); // GST report monthly filter
LeadSchema.index({ priority: 1, updatedAt: -1 });                // owner desk hot-lead-gone-cold
LeadSchema.index({ approvalStatus: 1, stage: 1, updatedAt: -1 });// owner desk approval watchlist
LeadSchema.index({ projectCompletionDate: 1, projectCompleted: 1 }); // overdue project delivery

/* ─── Text index for search ─── */
LeadSchema.index(
  { name: "text", email: "text", phone: "text", business: "text", company: "text" },
  { weights: { name: 10, phone: 8, email: 6, business: 4, company: 4 }, name: "lead_text_search" }
);

const Lead = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);

export default Lead;

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
    email: { type: String, default: "", trim: true },
    business: { type: String, default: "", trim: true },
    industry: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    requirements: { type: String, default: "", trim: true },

    branch: { type: String, default: "Bangalore", trim: true },
    source: { type: String, default: "WhatsApp", trim: true },
    stage: { type: String, default: "Lead Capture", trim: true },
    priority: { type: String, default: "Hot", trim: true },
    value: { type: Number, default: 0 },
    days: { type: String, default: "0d", trim: true },
    rep: { type: String, default: "", trim: true },

    bant: { type: String, default: "0/4" },
    bantDetails: { type: BantDetailsSchema, default: () => ({}) },

    stageTimestamps: { type: [StageTimestampSchema], default: [] },
    followups: { type: [FollowupSchema], default: [] },
    commLogs: { type: [CommLogSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
    notes: { type: [NoteSchema], default: [] },
    documents: { type: [DocumentSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("Lead", LeadSchema);
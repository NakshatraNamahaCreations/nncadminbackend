import mongoose from "mongoose";

// Extra (one-time) work on a project after the original deal, e.g. new pages,
// changes, redesign. Kept separate from the lead's dealValue so original deal
// numbers in analytics/leaderboard stay correct.

export const EXTRA_STATUSES = ["quoted", "approved", "in_progress", "done", "cancelled"];
export const PAYMENT_MODES  = ["UPI", "NEFT", "RTGS", "IMPS", "Cash", "Cheque", "Card", "Other"];

export const BillingPaymentSchema = new mongoose.Schema(
  {
    amount:    { type: Number, required: true, min: 0 },
    date:      { type: Date, default: Date.now },
    mode:      { type: String, enum: PAYMENT_MODES, default: "UPI" },
    reference: { type: String, default: "", trim: true }, // UTR / cheque no.
    note:      { type: String, default: "", trim: true },
    by:        { type: String, default: "" },
  },
  { _id: true, timestamps: false }
);

const ProjectExtraSchema = new mongoose.Schema(
  {
    lead:          { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    title:         { type: String, required: true, trim: true },
    description:   { type: String, default: "", trim: true },
    amount:        { type: Number, default: 0, min: 0 },   // before GST
    gstApplicable: { type: Boolean, default: false },
    gstRate:       { type: Number, default: 18 },
    status:        { type: String, enum: EXTRA_STATUSES, default: "quoted" },
    requestedDate: { type: Date, default: Date.now },
    payments:      { type: [BillingPaymentSchema], default: [] },
    addedBy:       { type: String, default: "" },
    updatedBy:     { type: String, default: "" },
  },
  { timestamps: true, collection: "project_extras" }
);

ProjectExtraSchema.index({ lead: 1, createdAt: -1 });
ProjectExtraSchema.index({ status: 1 });

const ProjectExtra = mongoose.models.ProjectExtra || mongoose.model("ProjectExtra", ProjectExtraSchema);
export default ProjectExtra;

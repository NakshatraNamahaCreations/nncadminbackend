import mongoose from "mongoose";
import { PAYMENT_MODES } from "./ProjectExtra.js";

// A monthly service billed to a project's client, e.g. Google Ads management,
// SEO, AMC. Monthly dues are not stored — they are worked out from startDate,
// endDate and billingDay; each payment is tagged with the month ("YYYY-MM") it covers.

export const SERVICE_TYPES = [
  "Google Ads", "Meta Ads", "SEO", "Social Media", "AMC / Maintenance",
  "Hosting", "Content / Blogs", "Other",
];

const ServicePaymentSchema = new mongoose.Schema(
  {
    period:    { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // month covered
    amount:    { type: Number, default: 0, min: 0 },
    waived:    { type: Boolean, default: false }, // month skipped / not billed
    date:      { type: Date, default: Date.now },
    mode:      { type: String, enum: PAYMENT_MODES, default: "UPI" },
    reference: { type: String, default: "", trim: true },
    note:      { type: String, default: "", trim: true },
    by:        { type: String, default: "" },
  },
  { _id: true }
);

const RecurringServiceSchema = new mongoose.Schema(
  {
    lead:          { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    name:          { type: String, required: true, trim: true },
    type:          { type: String, enum: SERVICE_TYPES, default: "Other" },
    amount:        { type: Number, default: 0, min: 0 },   // per month, before GST
    gstApplicable: { type: Boolean, default: false },
    gstRate:       { type: Number, default: 18 },
    billingDay:    { type: Number, default: 5, min: 1, max: 28 },
    startDate:     { type: Date, required: true },
    endDate:       { type: Date, default: null },          // set when the service is stopped
    notes:         { type: String, default: "", trim: true },
    payments:      { type: [ServicePaymentSchema], default: [] },
    addedBy:       { type: String, default: "" },
    updatedBy:     { type: String, default: "" },
  },
  { timestamps: true, collection: "recurring_services" }
);

RecurringServiceSchema.index({ lead: 1, createdAt: -1 });
RecurringServiceSchema.index({ endDate: 1 });

const RecurringService = mongoose.models.RecurringService || mongoose.model("RecurringService", RecurringServiceSchema);
export default RecurringService;

import mongoose from "mongoose";

// A third-party service used by a client project (lead), e.g. Razorpay, MSG91, Hostinger.

export const INTEGRATION_CATEGORIES = [
  "Payment", "SMS / OTP", "WhatsApp", "Email", "Maps", "Login / Auth",
  "Hosting / Server", "Domain", "Database", "Analytics / Ads", "Shipping",
  "App Store", "Other",
];
export const INTEGRATION_STATUSES = ["pending", "in_progress", "live", "issue", "inactive"];

const SecretSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true }, // e.g. "Key ID", "Key Secret", "Password"
    value: { type: String, default: "" },                // encrypted (utils/secretBox.js) — never sent in lists
  },
  { _id: true }
);

const RevealLogSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    by:    { type: String, default: "" },
    at:    { type: Date, default: Date.now },
  },
  { _id: false }
);

const IntegrationSchema = new mongoose.Schema(
  {
    lead:         { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    service:      { type: String, required: true, trim: true },
    category:     { type: String, enum: INTEGRATION_CATEGORIES, default: "Other" },
    accountOwner: { type: String, enum: ["nnc", "client"], default: "client" },
    mode:         { type: String, enum: ["test", "live"], default: "live" },
    status:       { type: String, enum: INTEGRATION_STATUSES, default: "pending" },

    loginUrl: { type: String, default: "", trim: true },
    username: { type: String, default: "", trim: true }, // login id / email (not secret)
    secrets:  { type: [SecretSchema], default: [] },

    cost:         { type: Number, default: 0, min: 0 },
    billingCycle: { type: String, enum: ["", "one_time", "monthly", "yearly"], default: "" },
    renewalDate:  { type: Date, default: null },

    notes:     { type: String, default: "", trim: true },
    addedBy:   { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    revealLog: { type: [RevealLogSchema], default: [] }, // who viewed which secret (last 50)
  },
  { timestamps: true, collection: "integrations" }
);

IntegrationSchema.index({ lead: 1, createdAt: -1 });
IntegrationSchema.index({ renewalDate: 1 });
IntegrationSchema.index({ category: 1, status: 1 });

const Integration = mongoose.models.Integration || mongoose.model("Integration", IntegrationSchema);
export default Integration;

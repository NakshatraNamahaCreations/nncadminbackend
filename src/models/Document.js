import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["invoice", "quotation", "mom", "client_input", "other"],
      required: true,
      trim: true,
    },
    linkedLead: {
      type: String,
      required: true,
      trim: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },
    date: {
      type: Date,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    originalFileName: {
      type: String,
      default: "",
      trim: true,
    },
    storedFileName: {
      type: String,
      default: "",
      trim: true,
    },
    fileUrl: {
      type: String,
      default: "",
      trim: true,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    mimeType: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

/* Indexes for fast lookups */
documentSchema.index({ type: 1 });
documentSchema.index({ linkedLead: 1 });
documentSchema.index({ createdAt: -1 });
documentSchema.index({ date: -1 });
documentSchema.index({ name: "text", linkedLead: "text", notes: "text", originalFileName: "text" });

const Document = mongoose.models.Document || mongoose.model("Document", documentSchema);

export default Document;
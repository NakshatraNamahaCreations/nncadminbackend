import mongoose from "mongoose";

const LineItemSchema = new mongoose.Schema(
  {
    description: { type: String, default: "", trim: true },
    qty:         { type: Number, default: 1, min: 0 },
    rate:        { type: Number, default: 0, min: 0 },
    amount:      { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const NegotiationEntrySchema = new mongoose.Schema(
  {
    note: { type: String, default: "", trim: true },
    by:   { type: String, default: "Admin", trim: true },
    type: { type: String, enum: ["admin", "system"], default: "admin" },
    at:   { type: Date, default: Date.now },
  },
  { _id: false }
);

const QuotationSchema = new mongoose.Schema(
  {
    quoteNumber:    { type: String, unique: true, trim: true },
    revisionNumber: { type: Number, default: 1 },
    parentQuoteId:  { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", default: null },
    isRevision:     { type: Boolean, default: false },

    // Client info
    clientName:    { type: String, required: true, trim: true },
    clientPhone:   { type: String, default: "", trim: true },
    clientEmail:   { type: String, default: "", lowercase: true, trim: true },
    clientCompany: { type: String, default: "", trim: true },
    clientAddress: { type: String, default: "", trim: true },
    clientGstin:   { type: String, default: "", trim: true },

    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "Enquiry", default: null },

    branch: {
      type: String,
      enum: ["Bangalore", "Mysore", "Mumbai"],
      required: true,
    },

    services:  { type: [String], default: [] },
    lineItems: { type: [LineItemSchema], default: [] },

    subtotal: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax:      { type: Number, default: 0, min: 0 },
    total:    { type: Number, default: 0, min: 0 },

    validUntil: { type: Date, default: null },

    status: {
      type: String,
      enum: ["draft", "sent", "under_negotiation", "approved", "rejected", "final", "converted", "expired"],
      default: "draft",
    },

    serviceCategory: { type: String, default: "", trim: true },
    notes:  { type: String, default: "", trim: true },
    terms:  { type: String, default: "", trim: true },

    negotiationHistory: { type: [NegotiationEntrySchema], default: [] },

    proformaId: { type: mongoose.Schema.Types.ObjectId, ref: "ProformaInvoice", default: null },

    senderEmail: { type: String, default: "", trim: true },   // reply-to email shown to client
    createdBy:   { type: String, default: "Admin", trim: true },
    sentAt:      { type: Date, default: null },
    approvedAt:  { type: Date, default: null },
    rejectedAt:  { type: Date, default: null },
    convertedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "quotations" }
);

// Auto-generate quote number before save
QuotationSchema.pre("save", async function () {
  if (!this.quoteNumber) {
    const count = await mongoose.model("Quotation").countDocuments();
    const pad   = String(count + 1).padStart(4, "0");
    const rev   = this.revisionNumber > 1 ? `-R${this.revisionNumber}` : "";
    this.quoteNumber = `QT-${new Date().getFullYear()}-${pad}${rev}`;
  }
});

QuotationSchema.index({ status: 1 });
QuotationSchema.index({ branch: 1 });
QuotationSchema.index({ enquiryId: 1 });
QuotationSchema.index({ parentQuoteId: 1 });
QuotationSchema.index({ createdAt: -1 });
QuotationSchema.index({ clientName: "text", clientPhone: "text", clientCompany: "text" });

const Quotation = mongoose.models.Quotation || mongoose.model("Quotation", QuotationSchema);
export default Quotation;

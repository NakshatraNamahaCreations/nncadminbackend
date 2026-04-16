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

const ProformaInvoiceSchema = new mongoose.Schema(
  {
    proformaNumber: { type: String, unique: true, trim: true },
    quotationId:    { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", required: true },
    quoteNumber:    { type: String, default: "", trim: true },

    // Client info (copied from quotation)
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

    lineItems: { type: [LineItemSchema], default: [] },
    subtotal:  { type: Number, default: 0, min: 0 },
    discount:  { type: Number, default: 0, min: 0 },
    tax:       { type: Number, default: 0, min: 0 },
    total:     { type: Number, default: 0, min: 0 },

    deliveryDate:  { type: Date, default: null },
    notes:         { type: String, default: "", trim: true },
    terms:         { type: String, default: "", trim: true },
    paymentTerms:  { type: String, default: "", trim: true },

    status: {
      type: String,
      enum: ["draft", "sent", "paid", "cancelled"],
      default: "draft",
    },

    createdBy: { type: String, default: "Admin", trim: true },
    sentAt:    { type: Date, default: null },
    paidAt:    { type: Date, default: null },
  },
  { timestamps: true, collection: "proforma_invoices" }
);

ProformaInvoiceSchema.pre("save", async function () {
  if (!this.proformaNumber) {
    const count = await mongoose.model("ProformaInvoice").countDocuments();
    const pad   = String(count + 1).padStart(4, "0");
    this.proformaNumber = `PI-${new Date().getFullYear()}-${pad}`;
  }
});

ProformaInvoiceSchema.index({ quotationId: 1 });
ProformaInvoiceSchema.index({ status: 1 });
ProformaInvoiceSchema.index({ branch: 1 });
ProformaInvoiceSchema.index({ createdAt: -1 });

const ProformaInvoice = mongoose.models.ProformaInvoice || mongoose.model("ProformaInvoice", ProformaInvoiceSchema);
export default ProformaInvoice;

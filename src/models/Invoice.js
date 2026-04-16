import mongoose from "mongoose";

const ItemSchema = new mongoose.Schema({
  description: { type: String, default: "" },
  hsn:         { type: String, default: "" },
  quantity:    { type: Number, default: 1 },
  rate:        { type: Number, default: 0 },
  amount:      { type: Number, default: 0 },
}, { _id: false });

const BankSchema = new mongoose.Schema({
  accountName:   { type: String, default: "" },
  accountNumber: { type: String, default: "" },
  bankName:      { type: String, default: "" },
  ifscCode:      { type: String, default: "" },
  branchName:    { type: String, default: "" },
  upiId:         { type: String, default: "" },
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
  invoiceNumber:  { type: String, unique: true, required: true },
  type:           { type: String, enum: ["proforma","tax"], required: true },
  status:         {
    type: String,
    enum: ["draft","sent","approved","converted","paid","cancelled"],
    default: "draft",
  },
  officeLocation: { type: String, enum: ["Mysore","Bangalore","Mumbai"], required: true },

  /* Client */
  clientName:     { type: String, required: true },
  clientBusiness: { type: String, default: "" },
  clientAddress:  { type: String, default: "" },
  clientCity:     { type: String, default: "" },
  clientState:    { type: String, default: "" },
  clientPincode:  { type: String, default: "" },
  clientPhone:    { type: String, default: "" },
  clientEmail:    { type: String, default: "" },
  clientGST:      { type: String, default: "" },
  clientPAN:      { type: String, default: "" },

  leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },

  invoiceDate: { type: Date, default: Date.now },
  validUntil:  { type: Date, default: null },   // proforma validity
  dueDate:     { type: Date, default: null },   // tax invoice due date

  items:         { type: [ItemSchema], default: [] },
  subtotal:      { type: Number, default: 0 },
  discountPct:   { type: Number, default: 0 },
  discountAmt:   { type: Number, default: 0 },
  taxableAmount: { type: Number, default: 0 },
  cgstPct:       { type: Number, default: 9  },
  cgstAmt:       { type: Number, default: 0  },
  sgstPct:       { type: Number, default: 9  },
  sgstAmt:       { type: Number, default: 0  },
  igstPct:       { type: Number, default: 0  },
  igstAmt:       { type: Number, default: 0  },
  totalAmount:   { type: Number, default: 0  },
  amountInWords: { type: String, default: "" },

  /* Quoted (from proforma) vs Finalized (actual tax invoice) */
  quotedAmount:    { type: Number, default: 0 },
  finalizedAmount: { type: Number, default: 0 },

  bankDetails: { type: BankSchema, default: () => ({}) },

  /* Reference from proforma */
  proformaId:     { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
  proformaNumber: { type: String, default: "" },

  termsAndConditions: { type: String, default: "" },
  notes:              { type: String, default: "" },
  createdBy:          { type: String, default: "" },
}, { timestamps: true });

InvoiceSchema.index({ type: 1, status: 1 });
InvoiceSchema.index({ officeLocation: 1 });
InvoiceSchema.index({ invoiceDate: -1 });
InvoiceSchema.index({ clientName: 1 });
InvoiceSchema.index({ proformaId: 1 });

export default mongoose.model("Invoice", InvoiceSchema);

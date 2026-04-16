import mongoose from "mongoose";

const invoiceConfigSchema = new mongoose.Schema(
  {
    proformaPrefix:    { type: String, default: "NNC/PRF", trim: true },
    taxPrefix:         { type: String, default: "NNC/TAX", trim: true },
    paddingLength:     { type: Number, default: 4, min: 1, max: 8 },
    includeFiscalYear: { type: Boolean, default: true },
  },
  { collection: "invoice_config", timestamps: true }
);

const InvoiceConfig = mongoose.models.InvoiceConfig
  || mongoose.model("InvoiceConfig", invoiceConfigSchema);

export default InvoiceConfig;

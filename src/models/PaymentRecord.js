import mongoose from "mongoose";

const PaymentRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentClient",
      required: true,
    },
    client: { type: String, required: true },
    project: { type: String, default: "" },
    invoice: { type: String, default: "" },
    amount: { type: Number, required: true, default: 0 },
    mode: {
      type: String,
      enum: ["NEFT", "RTGS", "UPI", "Cheque", "Cash", "IMPS", "Wire"],
      default: "NEFT",
    },
    tds: { type: Boolean, default: false },
    tdsAmt: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    tdsStatus: { type: String, default: "N/A" },
    remarks: { type: String, default: "" },
    transactionId:      { type: String, default: "" },
    paymentProof:       { type: String, default: "" }, // screenshot path
    invoiceId:          { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
    uploadedInvoicePath:{ type: String, default: "" }, // manually uploaded invoice
    account:            { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", default: null },
  },
  {
    timestamps: true,
    collection: "payment_records",
  }
);

const PaymentRecord = mongoose.model("PaymentRecord", PaymentRecordSchema);

export default PaymentRecord;
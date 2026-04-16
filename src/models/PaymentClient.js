import mongoose from "mongoose";

const PaymentClientSchema = new mongoose.Schema(
  {
    client: { type: String, required: true, trim: true },
    contact: { type: String, default: "" },
    city: { type: String, default: "" },
    category: { type: String, default: "" },
    project: { type: String, default: "" },
    proposalDate: { type: Date, default: null },
    totalValue: { type: Number, required: true, default: 0 },
    received: { type: Number, default: 0 },
    deadline: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Pending", "Partial", "Paid", "Followed Up", "Not Finalised", "Declined"],
      default: "Pending",
    },
    priority: {
      type: String,
      enum: ["HOT", "WARM", "WATCH", "DONE"],
      default: "HOT",
    },
    lastFollowUp: { type: Date, default: null },
    nextAction: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  {
    timestamps: true,
    collection: "payment_clients",
  }
);

const PaymentClient = mongoose.model("PaymentClient", PaymentClientSchema);

export default PaymentClient;
import mongoose from "mongoose";

const ExpenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ["rent", "salary", "electricity", "internet", "maintenance", "other"],
      required: true,
    },
    subcategory: { type: String, default: "" }, // e.g. employee name for salary
    branch: {
      type: String,
      enum: ["Mysore", "Bangalore", "Mumbai", "General"],
      default: "General",
    },
    amount:        { type: Number, required: true, min: 0 },
    date:          { type: Date,   required: true },
    month:         { type: Number, required: true, min: 1, max: 12 },
    year:          { type: Number, required: true },
    description:   { type: String, default: "" },
    paidBy:        { type: String, default: "" },
    paymentMethod: {
      type: String,
      enum: ["cash", "bank_transfer", "upi", "cheque", "auto_debit", "other"],
      default: "bank_transfer",
    },
    status:        { type: String, enum: ["paid", "pending"], default: "pending" },
    isRecurring:   { type: Boolean, default: false },
    notes:         { type: String, default: "" },
  },
  { timestamps: true }
);

ExpenseSchema.index({ year: 1, month: 1 });
ExpenseSchema.index({ category: 1, year: 1, month: 1 });
ExpenseSchema.index({ branch: 1, year: 1, month: 1 });

export default mongoose.model("Expense", ExpenseSchema);

import mongoose from "mongoose";

const BankAccountSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true }, // e.g. "NNC Main Account"
    bankName:      { type: String, default: "", trim: true },    // e.g. "HDFC Bank"
    accountNumber: { type: String, default: "", trim: true },
    ifsc:          { type: String, default: "", trim: true },
    branch:        { type: String, default: "", trim: true },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

const BankAccount = mongoose.models.BankAccount || mongoose.model("BankAccount", BankAccountSchema);
export default BankAccount;

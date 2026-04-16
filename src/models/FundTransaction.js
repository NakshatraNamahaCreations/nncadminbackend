import mongoose from "mongoose";

const FundTransactionSchema = new mongoose.Schema(
  {
    fundId:   { type: String, required: true, enum: ["buffer","emergency","tax","growth"] },
    fundName: { type: String, default: "" },
    branch:   { type: String, default: "" },
    type:     { type: String, required: true, enum: ["deposit","withdrawal"] },
    amount:   { type: Number, required: true, min: 1 },
    date:     { type: Date,   required: true },
    month:    { type: Number, required: true, min: 1, max: 12 },
    year:     { type: Number, required: true },
    note:     { type: String, default: "" },
    addedBy:  { type: String, default: "" },
  },
  { timestamps: true }
);

FundTransactionSchema.index({ fundId: 1, branch: 1, date: -1 });
FundTransactionSchema.index({ branch: 1, year: 1, month: 1 });

const FundTransaction =
  mongoose.models.FundTransaction ||
  mongoose.model("FundTransaction", FundTransactionSchema);

export default FundTransaction;

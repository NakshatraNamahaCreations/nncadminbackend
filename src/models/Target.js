import mongoose from "mongoose";

const TargetSchema = new mongoose.Schema(
  {
    month:              { type: Number, required: true }, // 1-12
    year:               { type: Number, required: true },
    branch:             { type: String, default: "" },   // "" = company-wide
    revenueTarget:      { type: Number, default: 0 },
    leadsTarget:        { type: Number, default: 0 },
    closedDealsTarget:  { type: Number, default: 0 },
    advanceTarget:      { type: Number, default: 0 },
    setBy:              { type: String, default: "" },
  },
  { timestamps: true }
);

TargetSchema.index({ month: 1, year: 1, branch: 1 }, { unique: true });

const Target = mongoose.models.Target || mongoose.model("Target", TargetSchema);
export default Target;

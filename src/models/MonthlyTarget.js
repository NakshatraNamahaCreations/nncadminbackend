import mongoose from "mongoose";

const MonthlyTargetSchema = new mongoose.Schema(
  {
    year:          { type: Number, required: true },
    month:         { type: Number, required: true }, // 1–12
    targetDeals:   { type: Number, default: 0, min: 0 },
    targetRevenue: { type: Number, default: 0, min: 0 },
    notes:         { type: String, default: "" },
  },
  { timestamps: true }
);

MonthlyTargetSchema.index({ year: 1, month: 1 }, { unique: true });

export default mongoose.model("MonthlyTarget", MonthlyTargetSchema);

import mongoose from "mongoose";

/**
 * One document per company/branch stores all financial configuration
 * and reserve-fund running balances.
 */
const FinancialConfigSchema = new mongoose.Schema(
  {
    branch: { type: String, default: "" }, // "" = company-wide

    // ── Cost structure ──────────────────────────────────────────────────────
    cogsPercent:   { type: Number, default: 30, min: 0, max: 100 }, // % of revenue as direct project cost
    taxRatePercent:{ type: Number, default: 30, min: 0, max: 60  }, // 30% — Firm / LLP rate

    // ── Reserve fund TARGETS ────────────────────────────────────────────────
    bufferMonths:       { type: Number, default: 5  }, // 5 months of opex as buffer
    emergencyPct:       { type: Number, default: 15 }, // 15% of annual revenue
    taxReserveAuto:     { type: Boolean,default: true }, // auto-compute from net profit
    growthFundPct:      { type: Number, default: 15 }, // 15% of monthly net profit → growth fund

    // ── Reserve fund CURRENT BALANCES (updated by user) ────────────────────
    bufferBalance:    { type: Number, default: 0 },
    emergencyBalance: { type: Number, default: 0 },
    taxReserveBalance:{ type: Number, default: 0 },
    growthBalance:    { type: Number, default: 0 },

    // ── Overhead allocation method ──────────────────────────────────────────
    // "equal"  → fixed opex ÷ # deals
    // "revenue"→ fixed opex × (deal_rev / total_rev)
    overheadMethod: { type: String, enum: ["equal","revenue"], default: "equal" },

    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

FinancialConfigSchema.index({ branch: 1 }, { unique: true });

const FinancialConfig =
  mongoose.models.FinancialConfig ||
  mongoose.model("FinancialConfig", FinancialConfigSchema);

export default FinancialConfig;

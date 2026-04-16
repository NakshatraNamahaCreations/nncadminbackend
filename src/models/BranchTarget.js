import mongoose from "mongoose";

const branchTargetSchema = new mongoose.Schema(
  {
    branch: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    target: {
      type: Number,
      default: 0,
    },
    achieved: {
      type: Number,
      default: 0,
    },
    month: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

const BranchTarget = mongoose.model("BranchTarget", branchTargetSchema);

export default BranchTarget;
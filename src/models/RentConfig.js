import mongoose from "mongoose";

const RentConfigSchema = new mongoose.Schema(
  {
    branch:  { type: String, enum: ["Mysore", "Bangalore", "Mumbai"], required: true, unique: true },
    amount:  { type: Number, required: true, min: 0 },
    dueDay:  { type: Number, default: 1, min: 1, max: 28 }, // day of month rent is due
    notes:   { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("RentConfig", RentConfigSchema);

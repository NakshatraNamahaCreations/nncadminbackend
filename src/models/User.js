import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    username:  { type: String, required: true, unique: true, trim: true, lowercase: true },
    password:  { type: String, required: true },
    role:      { type: String, default: "User", trim: true },
    modules:   [{ type: String }],
    isActive:  { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);

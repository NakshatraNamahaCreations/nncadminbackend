import mongoose from "mongoose";

// A developer / designer who works on client projects. Assignments are stored
// on the project (Lead.developers), so one developer can be on many projects
// and one project can have many developers.

export const DEVELOPER_ROLES = [
  "Full Stack", "Frontend", "Backend", "Mobile App", "UI/UX Designer",
  "WordPress / CMS", "Tester / QA", "Other",
];

const DeveloperSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    role:     { type: String, enum: DEVELOPER_ROLES, default: "Full Stack" },
    email:    { type: String, default: "", trim: true, lowercase: true },
    phone:    { type: String, default: "", trim: true },
    branch:   { type: String, default: "", trim: true },
    skills:   { type: String, default: "", trim: true }, // e.g. "React, Node, Flutter"
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "developers" }
);

DeveloperSchema.index({ isActive: 1, name: 1 });

const Developer = mongoose.models.Developer || mongoose.model("Developer", DeveloperSchema);
export default Developer;

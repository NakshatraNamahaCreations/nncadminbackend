// models/TodayPlanTask.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const todayPlanTaskSchema = new Schema(
  {
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    taskType: {
      type: String,
      enum: ["new_call", "follow_up", "payment", "proposal", "meeting", "onboarding"],
      required: [true, "Task type is required"],
      trim: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
      trim: true,
    },
    section: {
      type: String,
      enum: ["call_immediately", "follow_up_today", "other"],
      default: "call_immediately",
      trim: true,
    },
    dueLabel: {
      type: String,
      default: "ASAP",
      trim: true,
    },
    subtitle: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },
    ownerName: {
      type: String,
      default: "",
      trim: true,
    },
    source: {
      type: String,
      default: "",
      trim: true,
    },
    service: {
      type: String,
      default: "",
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    plannedDate: {
      type: Date,
      required: [true, "Planned date is required"],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

todayPlanTaskSchema.index({ plannedDate: 1, status: 1 });
todayPlanTaskSchema.index({ plannedDate: 1, section: 1 });
todayPlanTaskSchema.index({ leadId: 1, plannedDate: 1 });
todayPlanTaskSchema.index({ taskType: 1, plannedDate: 1 });

const TodayPlanTask =
  mongoose.models.TodayPlanTask ||
  mongoose.model("TodayPlanTask", todayPlanTaskSchema);

export default TodayPlanTask;
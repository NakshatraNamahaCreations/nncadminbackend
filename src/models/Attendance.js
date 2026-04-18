import mongoose from "mongoose";

const AttendanceSchema = new mongoose.Schema(
  {
    employeeId:    { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName:  { type: String, default: "", trim: true },
    employeeCode:  { type: String, default: "", trim: true },
    branch: {
      type: String,
      enum: ["Mysore", "Bangalore", "Mumbai"],
    },
    date:          { type: Date,   required: true }, // stored as UTC midnight of the day
    month:         { type: Number, required: true }, // 1-12
    year:          { type: Number, required: true },
    checkIn:       { type: Date,   default: null },  // full datetime
    checkOut:      { type: Date,   default: null },
    workingHours:  { type: Number, default: 0 },     // decimal hours
    lateMinutes:   { type: Number, default: 0 },
    earlyLeaveMin: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["present", "late", "half-day", "absent", "leave", "holiday"],
      default: "absent",
    },
    leaveType: { type: String, default: "" }, // "CL","SL","EL","LOP"
    notes:     { type: String, default: "" },
    markedBy:  { type: String, default: "" },
  },
  { timestamps: true }
);

AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ year: 1, month: 1 });
AttendanceSchema.index({ branch: 1, year: 1, month: 1 });
AttendanceSchema.index({ date: 1 });
AttendanceSchema.index({ status: 1, date: 1 });

const Attendance = mongoose.models.Attendance || mongoose.model("Attendance", AttendanceSchema);

export default Attendance;

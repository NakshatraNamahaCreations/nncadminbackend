import mongoose from "mongoose";

const SalaryRecordSchema = new mongoose.Schema(
  {
    employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: { type: String, default: "", trim: true },
    employeeCode: { type: String, default: "", trim: true },
    branch:       { type: String, default: "" },
    department:   { type: String, default: "" },
    designation:  { type: String, default: "" },
    month:        { type: Number, required: true }, // 1-12
    year:         { type: Number, required: true },

    // Attendance summary
    totalWorkingDays: { type: Number, default: 0 },
    presentDays:      { type: Number, default: 0 },
    absentDays:       { type: Number, default: 0 },
    lateDays:         { type: Number, default: 0 },
    halfDays:         { type: Number, default: 0 },
    leaveDays:        { type: Number, default: 0 },
    totalLateMinutes: { type: Number, default: 0 },

    // Salary components (earnings)
    grossSalary:       { type: Number, default: 0 },
    basicSalary:       { type: Number, default: 0 },
    hra:               { type: Number, default: 0 },
    da:                { type: Number, default: 0 },
    specialAllowance:  { type: Number, default: 0 },
    perDayRate:        { type: Number, default: 0 },
    daysInMonth:       { type: Number, default: 0 },  // total calendar days

    // Leave entitlement
    monthlyLeaveEntitlement: { type: Number, default: 1.5 }, // 1 casual + 0.5 sick
    excessLeaveDays:         { type: Number, default: 0 },   // leaveDays beyond entitlement

    // Deductions (lateDeduction always 0 — late is info-only)
    absentDeduction:   { type: Number, default: 0 },
    halfDayDeduction:  { type: Number, default: 0 },
    leaveDeduction:    { type: Number, default: 0 },  // only excess leave days
    lateDeduction:     { type: Number, default: 0 },  // always 0, kept for schema compat
    pfEmployee:        { type: Number, default: 0 },  // 12% of basic (employee share)
    pfEmployer:        { type: Number, default: 0 },  // 12% of basic (employer share, shown for info)
    esi:               { type: Number, default: 0 },  // ESI employee contribution 0.75%
    professionalTax:   { type: Number, default: 0 },  // ₹200 standard (Karnataka)
    totalDeduction:    { type: Number, default: 0 },
    netSalary:         { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["generated", "paid"],
      default: "generated",
    },
    paidDate:       { type: Date,   default: null },
    paymentMethod:  { type: String, default: "" },
    generatedBy:    { type: String, default: "" },
    generatedAt:    { type: Date,   default: Date.now },
    notes:          { type: String, default: "" },
  },
  { timestamps: true }
);

SalaryRecordSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
SalaryRecordSchema.index({ branch: 1, year: 1, month: 1 });
SalaryRecordSchema.index({ status: 1 });
SalaryRecordSchema.index({ year: 1, month: 1 });

const SalaryRecord = mongoose.models.SalaryRecord || mongoose.model("SalaryRecord", SalaryRecordSchema);

export default SalaryRecord;

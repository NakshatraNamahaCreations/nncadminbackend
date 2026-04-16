import mongoose from "mongoose";

const EmployeeSchema = new mongoose.Schema(
  {
    employeeId:     { type: String, required: true, unique: true, trim: true }, // e.g. "NNC-MYS-001"
    name:           { type: String, required: true, trim: true },
    email:          { type: String, default: "", lowercase: true, trim: true },
    phone:          { type: String, default: "", trim: true },
    branch: {
      type: String,
      required: true,
      enum: ["Mysore", "Bangalore", "Mumbai"],
    },
    department:      { type: String, default: "", trim: true },
    designation:     { type: String, default: "", trim: true },
    shiftStart:      { type: String, default: "09:30" }, // HH:MM
    shiftEnd:        { type: String, default: "18:30" }, // HH:MM
    gracePeriodMin:  { type: Number, default: 15 },
    monthlySalary:   { type: Number, default: 0, min: 0 },

    // Salary structure — fixed rupee amounts
    basicAmt:        { type: Number, default: 0 },   // fixed Basic amount
    hraAmt:          { type: Number, default: 0 },   // fixed HRA amount
    daAmt:           { type: Number, default: 0 },   // fixed DA amount
    // Legacy percentage fields (kept for backward compat, ignored when *Amt > 0)
    basicPct:        { type: Number, default: 40  },
    hraPct:          { type: Number, default: 40  },
    daPct:           { type: Number, default: 10  },
    pfApplicable:    { type: Boolean, default: true  }, // deduct PF employee 12% of basic
    esiApplicable:   { type: Boolean, default: false }, // ESI 0.75% employee if gross ≤ 21000
    ptApplicable:    { type: Boolean, default: true  }, // Professional Tax ₹200 if gross > 15000
    pfFixed:         { type: Number, default: 0 },      // fixed override (0 = auto 12%)
    esiFixed:        { type: Number, default: 0 },      // fixed override (0 = auto 0.75%)
    ptFixed:         { type: Number, default: 0 },      // fixed override (0 = auto ₹200)

    // Salary history — each entry records a salary revision
    salaryHistory: [{
      salary:        { type: Number, required: true },
      effectiveDate: { type: Date,   required: true },
      hikePct:       { type: Number, default: null },   // % hike from previous (null for first entry)
      remarks:       { type: String, default: "" },
    }],

    dateOfBirth:     { type: Date, default: null },
    employmentType:  { type: String, enum: ["probationary", "permanent"], default: "permanent" },
    isActive:        { type: Boolean, default: true },
    joinedDate:      { type: Date, default: null },
  },
  { timestamps: true }
);

EmployeeSchema.index({ branch: 1 });
EmployeeSchema.index({ isActive: 1 });
EmployeeSchema.index({ branch: 1, isActive: 1 });

const Employee = mongoose.models.Employee || mongoose.model("Employee", EmployeeSchema);

export default Employee;

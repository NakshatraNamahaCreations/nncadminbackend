import mongoose from "mongoose";

// One document: Sales Desk rules, message details, edited templates and snoozed items
const SnoozeSchema = new mongoose.Schema(
  {
    key:   { type: String, required: true }, // "<clientId>-<kind>"
    until: { type: Date, required: true },
    by:    { type: String, default: "" },
  },
  { _id: false }
);

const SalesDeskSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    rules: {
      maxAuto:   { type: Number, default: 3 },      // routine reminders before a person must call
      bigAmount: { type: Number, default: 100000 }, // amounts at/above this always go to a person
      quietDays: { type: Number, default: 5 },
      afterSend: { type: Number, default: 2 },      // days before a sent message comes back
      holdPause: { type: Boolean, default: true },
      reviewDays: { type: Number, default: 90 },    // ask for a review within N days of completion
    },
    bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", default: null },
    upi:        { type: String, default: "", trim: true },
    reviewLink: { type: String, default: "", trim: true },
    templates:  { type: Map, of: String, default: {} },
    snoozes:    { type: [SnoozeSchema], default: [] },
    // Calendar: working hours shown in the week/day view and reminder lead time
    calendar: {
      start:  { type: String, default: "10:00" },
      end:    { type: String, default: "19:00" },
      days:   { type: [Number], default: [1, 2, 3, 4, 5, 6] }, // 0 = Sunday
      buffer: { type: Number, default: 15 },
      remind: { type: Number, default: 30 },
      office: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true, collection: "sales_desk_settings" }
);

export default mongoose.models.SalesDeskSetting || mongoose.model("SalesDeskSetting", SalesDeskSettingSchema);

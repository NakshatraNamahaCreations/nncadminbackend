import mongoose from "mongoose";

const calendarEventSchema = new mongoose.Schema(
  {
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    enquiryId:    { type: mongoose.Schema.Types.ObjectId, ref: "Enquiry", default: null },
    leadName:     { type: String, default: "" },
    leadPhone:    { type: String, default: "" },
    leadBusiness: { type: String, default: "" },
    leadStage:    { type: String, default: "" },
    type: {
      type: String,
      enum: ["payment_followup", "call_followup", "demo", "client_response", "enquiry_followup", "block"],
      required: true,
    },
    date:      { type: Date, required: true },
    title:     { type: String, default: "" },
    notes:     { type: String, default: "" },
    createdBy: { type: String, default: "" },
    // Meetings / Sales Desk
    time:     { type: String, default: "" },          // "HH:MM" (24h), "" = all day
    duration: { type: Number, default: 30 },          // minutes
    mode:     { type: String, enum: ["", "meet", "office", "phone"], default: "" },
    email:    { type: String, default: "" },
    amount:   { type: Number, default: 0 },
    link:     { type: String, default: "" },
    status:   { type: String, enum: ["scheduled", "done", "cancelled", "noshow"], default: "scheduled" },
    done:     { type: Boolean, default: false },
    doneAt:   { type: Date, default: null },
    summary:  { type: String, default: "" },
    outcome:  { type: String, default: "" },
  },
  { timestamps: true }
);

calendarEventSchema.index({ date: 1, type: 1 });
calendarEventSchema.index({ leadId: 1 });
calendarEventSchema.index({ done: 1, date: 1 });

export default mongoose.model("CalendarEvent", calendarEventSchema);

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
      enum: ["payment_followup", "call_followup", "demo", "client_response", "enquiry_followup"],
      required: true,
    },
    date:      { type: Date, required: true },
    title:     { type: String, default: "" },
    notes:     { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

calendarEventSchema.index({ date: 1, type: 1 });
calendarEventSchema.index({ leadId: 1 });

export default mongoose.model("CalendarEvent", calendarEventSchema);

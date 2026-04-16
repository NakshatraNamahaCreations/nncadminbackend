import mongoose from "mongoose";

const ownerNoteSchema = new mongoose.Schema(
  {
    text:         { type: String, required: true, trim: true },
    pinned:       { type: Boolean, default: false },
    date:         { type: String }, // "YYYY-MM-DD" — diary date
    // Payment Expected fields (type = "payment_expected")
    type:         { type: String, default: "note" }, // "note" | "payment_expected"
    amount:       { type: Number, default: null },
    expectedDate: { type: String, default: null }, // "YYYY-MM-DD"
    collected:    { type: Boolean, default: false },
    collectedAt:  { type: Date,   default: null },
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    leadName:     { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("OwnerNote", ownerNoteSchema);

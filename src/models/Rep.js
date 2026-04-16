import mongoose from "mongoose";

const repSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
    },

    branch: {
      type: String,
      trim: true,
      default: "",
    },

    branches: {
      type: [String],
      default: [],
    },

    role: {
      type: String,
      trim: true,
      default: "Sales Rep",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "reps",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

repSchema.virtual("displayName").get(function () {
  try {
    return this.name || "";
  } catch (error) {
    console.error("Rep displayName virtual error:", error);
    return "";
  }
});

repSchema.pre("save", function (next) {
  try {
    if (this.name) {
      this.name = this.name.trim();
    }

    if (this.branch) {
      this.branch = this.branch.trim();
    }

    if (this.email) {
      this.email = this.email.trim().toLowerCase();
    }

    if (this.phone) {
      this.phone = this.phone.trim();
    }

    if (this.role) {
      this.role = this.role.trim();
    }

    next();
  } catch (error) {
    console.error("Rep pre-save error:", error);
    next(error);
  }
});

repSchema.index({ branch: 1 });
repSchema.index({ isActive: 1 });
repSchema.index({ email: 1 });
repSchema.index({ phone: 1 });

const Rep = mongoose.models.Rep || mongoose.model("Rep", repSchema);

export default Rep;
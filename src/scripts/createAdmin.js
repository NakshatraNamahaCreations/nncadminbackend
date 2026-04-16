import mongoose from "mongoose";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["master_admin", "branch_manager", "sales_rep", "viewer"],
      default: "master_admin",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "admins" }
);

const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);

const ADMIN = {
  name: "Super Admin",
  email: "admin@nnc.com",
  password: "Admin@123",
  role: "master_admin",
};

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    const existing = await Admin.findOne({ email: ADMIN.email });
    if (existing) {
      console.log(`Admin already exists: ${existing.email}`);
      process.exit(0);
    }

    const hashed = await bcrypt.hash(ADMIN.password, 10);
    const admin = await Admin.create({ ...ADMIN, password: hashed });

    console.log("Admin created successfully:");
    console.log(`  Name  : ${admin.name}`);
    console.log(`  Email : ${admin.email}`);
    console.log(`  Role  : ${admin.role}`);
    console.log(`  Pass  : ${ADMIN.password}`);

    process.exit(0);
  } catch (err) {
    console.error("Error creating admin:", err);
    process.exit(1);
  }
}

run();

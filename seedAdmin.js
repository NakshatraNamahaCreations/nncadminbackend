import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import Admin from "./src/models/Admin.js";

dotenv.config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    await Admin.deleteMany({ email: "admin@nnc.in" });

    const hashedPassword = await bcrypt.hash("password123", 10);

    await Admin.create({
      name: "Master Admin",
      email: "admin@nnc.in",
      password: hashedPassword,
      role: "master_admin",
      isActive: true,
    });

    console.log("Admin reset successfully");
    process.exit(0);
  } catch (error) {
    console.error("seedAdmin error:", error);
    process.exit(1);
  }
};

seedAdmin();
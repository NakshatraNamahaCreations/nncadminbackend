import mongoose from "mongoose";
import dotenv from "dotenv";
import Admin from "./src/models/Admin.js";

dotenv.config();

const run = async () => {
  try {
    await mongoose.connect("mongodb+srv://developersnnc_db_user:wTOUGBUN3zQeXjZR@cluster0.nwraiu4.mongodb.net/");

    const email = "info@nakshatranamahacreations.com";

    const existing = await Admin.findOne({ email });

    if (existing) {
      existing.name = "Master Admin";
      existing.email = email;
      existing.role = "master_admin";
      existing.password = "password123";
      existing.resetPasswordToken = "";
      existing.resetPasswordExpires = null;

      await existing.save();
      console.log("Master admin updated successfully");
    } else {
      await Admin.create({
        name: "Master Admin",
        email,
        password: "password123",
        role: "master_admin",
      });
      console.log("Master admin created successfully");
    }

    process.exit(0);
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  }
};

run();
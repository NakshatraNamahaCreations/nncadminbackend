import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import leadRoutes from "./src/routes/lead.routes.js";
import repRoutes from "./src/routes/rep.routes.js";
import documentRoutes from "./src/routes/document.routes.js";
import authRoutes from "./src/routes/auth.routes.js";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsPath = path.join(__dirname, "uploads");

try {
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }
} catch (error) {
  console.error("Upload folder creation error:", error);
}

try {
  app.use(
    cors({
      origin: ["http://localhost:5173", "http://localhost:3000","https://admincrm.nakshatranamahacreations.com"],
      credentials: true,
    })
  );

  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan("dev"));

  app.get("/", async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        message: "NNC CRM Backend is running",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Server error",
      });
    }
  });

  app.use("/uploads", express.static(uploadsPath));

  app.use("/api/auth", authRoutes);
  app.use("/api/leads", leadRoutes);
  app.use("/api/reps", repRoutes);
  app.use("/api/documents", documentRoutes);

  app.use((req, res) => {
    try {
      return res.status(404).json({
        success: false,
        message: "Route not found",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Server error",
      });
    }
  });

  app.use((err, req, res, next) => {
    try {
      console.error("Server Error:", err);

      return res.status(500).json({
        success: false,
        message: err.message || "Internal server error",
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });
} catch (error) {
  console.error("App setup error:", error);
}

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI missing in .env");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: true,
    });

    console.log("MongoDB connected successfully");

    app.listen(PORT, () => {
      try {
        console.log(`API running at http://localhost:${PORT}`);
        console.log(`Uploads served at http://localhost:${PORT}/uploads`);
        console.log(`Auth API at http://localhost:${PORT}/api/auth`);
        console.log(`Leads API at http://localhost:${PORT}/api/leads`);
        console.log(`Reps API at http://localhost:${PORT}/api/reps`);
        console.log(`Documents API at http://localhost:${PORT}/api/documents`);
      } catch (error) {
        console.error("Server start log error:", error);
      }
    });
  } catch (err) {
    console.error("MongoDB connect error:", err.message || err);
    process.exit(1);
  }
}

startServer();
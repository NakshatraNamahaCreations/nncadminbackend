import express from "express";
import authRoutes from "./auth.routes.js";
import leadRoutes from "./lead.routes.js";
import documentRoutes from "./document.routes.js";
import analyticsRoutes from "./analytics.routes.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/leads", leadRoutes);
router.use("/documents", documentRoutes);
router.use("/analytics", analyticsRoutes);

export default router;
import express from "express";
import leadRoutes from "./lead.routes.js";
import repRoutes from "./rep.routes.js";
import documentRoutes from "./document.routes.js";

const router = express.Router();

router.use("/leads", leadRoutes);
router.use("/reps", repRoutes);
router.use("/documents", documentRoutes);

export default router;
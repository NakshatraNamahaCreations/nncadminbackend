import express from "express";
import { getBranchReports } from "../controllers/branchReports.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getBranchReports);

export default router;
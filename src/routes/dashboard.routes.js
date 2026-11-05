import express from "express";
import {
  fetchDashboardSummary,
  fetchSalesStats,
  fetchMonthlyTarget,
  saveMonthlyTarget,
} from "../controllers/dashboard.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import { ownerView } from "../controllers/ownerView.controller.js";

const router = express.Router();

router.use(protect);

router.get("/summary", fetchDashboardSummary);
router.get("/sales",   fetchSalesStats);
router.get("/target",  fetchMonthlyTarget);
router.post("/target", saveMonthlyTarget);
router.get("/owner-view", requireModule("dashboard", "view"), ownerView);   // the Dashboard page

export default router;

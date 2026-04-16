import express from "express";
import {
  createTodayPlanTask,
  createTodayPlanTaskFromLead,
  getTodayPlanDashboard,
  toggleTodayPlanTaskStatus,
  deleteTodayPlanTask,
} from "../controllers/todayPlan.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/dashboard", getTodayPlanDashboard);
router.post("/", createTodayPlanTask);
router.post("/from-lead/:leadId", createTodayPlanTaskFromLead);
router.patch("/:id/toggle", toggleTodayPlanTaskStatus);
router.delete("/:id", deleteTodayPlanTask);

export default router;
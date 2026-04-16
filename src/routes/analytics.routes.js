import express from "express";
import {
  getAnalytics,
  getAdvancedAnalytics,
  getTargets,
  setTarget,
} from "../controllers/analytics.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/",         getAnalytics);
router.get("/advanced", getAdvancedAnalytics);
router.get("/targets",  getTargets);
router.post("/targets", setTarget);

export default router;

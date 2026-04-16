import express from "express";
import { getPnL, getPnLDashboard } from "../controllers/pnl.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/dashboard", getPnLDashboard);
router.get("/",          getPnL);
export default router;

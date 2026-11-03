import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import { getSettings, updateSettings, snoozeItems } from "../controllers/salesDesk.controller.js";

// Sales Desk works on leads — same access as All Leads
const canView = requireModule("all-leads", "view");
const canEdit = requireModule("all-leads", "edit");

const router = express.Router();
router.use(protect);

router.get("/settings",  canView, getSettings);
router.put("/settings",  canEdit, updateSettings);
router.post("/snooze",   canEdit, snoozeItems);

export default router;

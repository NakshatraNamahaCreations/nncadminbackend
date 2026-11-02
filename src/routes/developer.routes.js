import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import {
  getDevelopers, createDeveloper, updateDeveloper, deleteDeveloper, setProjectDevelopers,
} from "../controllers/developer.controller.js";

// Developers are assigned to projects — same access as Projects ("all-leads")
const canView = requireModule("all-leads", "view");
const canEdit = requireModule("all-leads", "edit");

const router = express.Router();
router.use(protect);

router.get("/",                    canView, getDevelopers);
router.post("/",                   canEdit, createDeveloper);
router.put("/project/:leadId",     canEdit, setProjectDevelopers);
router.put("/:id",                 canEdit, updateDeveloper);
router.delete("/:id",              canEdit, deleteDeveloper);

export default router;

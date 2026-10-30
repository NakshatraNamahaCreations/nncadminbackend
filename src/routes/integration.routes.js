import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import {
  getIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  revealSecret,
} from "../controllers/integration.controller.js";

const router = express.Router();
router.use(protect);

const canView = requireModule("integrations", "view");
const canEdit = requireModule("integrations", "edit");

router.get("/",        canView, getIntegrations);
router.post("/",       canEdit, createIntegration);
router.put("/:id",     canEdit, updateIntegration);
router.delete("/:id",  canEdit, deleteIntegration);

// Revealing a secret needs edit access, and is logged
router.post("/:id/secrets/:secretId/reveal", canEdit, revealSecret);

export default router;

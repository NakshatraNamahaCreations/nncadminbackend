import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import {
  getAll, getLeadOptions,
  createMember, updateMember, deleteMember,
  createClient, updateClient, deleteClient,
  addWork, updateWork, deleteWork,
  saveAdsDay, markAdsSent, deleteAdsDay,
  addKeyword, rankCheck, deleteKeyword,
  saveSettings,
} from "../controllers/seoTeam.controller.js";

const canView = requireModule("seo-team", "view");
const canEdit = requireModule("seo-team", "edit");

const router = express.Router();
router.use(protect);

router.get("/all",            canView, getAll);
router.get("/lead-options",   canView, getLeadOptions);

router.post("/team",          canEdit, createMember);
router.put("/team/:id",       canEdit, updateMember);
router.delete("/team/:id",    canEdit, deleteMember);

router.post("/clients",       canEdit, createClient);
router.put("/clients/:id",    canEdit, updateClient);
router.delete("/clients/:id", canEdit, deleteClient);

// Logging work and ads reports is the team's daily job — view access is enough
router.post("/work",          canView, addWork);
router.put("/work/:id",       canView, updateWork);
router.delete("/work/:id",    canEdit, deleteWork);

router.post("/ads",           canView, saveAdsDay);
router.put("/ads/:id/sent",   canView, markAdsSent);
router.delete("/ads/:id",     canEdit, deleteAdsDay);

router.post("/keywords",       canView, addKeyword);
router.post("/keywords/check", canView, rankCheck);
router.delete("/keywords/:id", canEdit, deleteKeyword);

router.put("/settings",       canEdit, saveSettings);

export default router;

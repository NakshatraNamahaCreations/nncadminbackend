import express from "express";
import {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  addNote,
  addComm,
  addFollowup,
  uploadDoc,
  getPipelineData,
  getLeadCalendarData,
} from "../controllers/lead.controller.js";
import { leadUpload } from "../middleware/leadUpload.js";

const router = express.Router();

router.get("/", getLeads);
router.get("/pipeline-data/all", getPipelineData);
router.get("/calendar/month", getLeadCalendarData);
router.get("/:id", getLeadById);

router.post("/", createLead);
router.put("/:id", updateLead);
router.delete("/:id", deleteLead);

router.post("/:id/notes", addNote);
router.post("/:id/comms", addComm);
router.post("/:id/followups", addFollowup);
router.post("/:id/docs", leadUpload.single("file"), uploadDoc);

export default router;
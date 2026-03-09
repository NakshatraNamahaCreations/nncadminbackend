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
  exportLeadsCsv,
} from "../controllers/lead.controller.js";
import { leadUpload } from "../middleware/leadUpload.js";

const router = express.Router();

/* Lead list + filters */
router.get("/", getLeads);

/* Export */
router.get("/export/csv", exportLeadsCsv);

/* Pipeline + calendar */
router.get("/pipeline-data/all", getPipelineData);
router.get("/calendar/month", getLeadCalendarData);

/* Single lead */
router.get("/:id", getLeadById);

/* CRUD */
router.post("/", createLead);
router.put("/:id", updateLead);
router.delete("/:id", deleteLead);

/* Lead actions */
router.post("/:id/notes", addNote);
router.post("/:id/comms", addComm);
router.post("/:id/followups", addFollowup);
router.post("/:id/docs", leadUpload.single("file"), uploadDoc);

export default router;
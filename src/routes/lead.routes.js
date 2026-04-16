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
  markFollowupDone,
  uploadDoc,
  deleteDoc,
  getPipelineData,
  getLeadCalendarData,
  exportLeadsCsv,
  sendLeadEmail,
  addMOM,
  updateApprovalStatus,
  addEmailLogResponse,
} from "../controllers/lead.controller.js";
import { leadUpload } from "../middleware/leadUpload.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

// All lead routes require authentication
router.use(protect);

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
router.patch("/:id/followup-done", markFollowupDone);
router.post("/:id/docs", leadUpload.single("file"), uploadDoc);
router.delete("/:id/docs/index/:idx", deleteDoc);
router.delete("/:id/docs/:docId", deleteDoc);

/* Automated emails + MOM + approval */
router.post("/:id/send-email", sendLeadEmail);
router.post("/:id/mom", addMOM);
router.patch("/:id/approval", updateApprovalStatus);
router.patch("/:id/email-logs/:logId/response", addEmailLogResponse);

export default router;
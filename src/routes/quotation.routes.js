import express from "express";
import {
  getQuotations,
  getQuotationStats,
  getQuotationById,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  sendQuotationEmail,
  updateStatus,
  addNegotiationNote,
  createRevision,
  convertToProforma,
} from "../controllers/quotation.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(protect);

router.get("/stats",              getQuotationStats);
router.get("/",                   getQuotations);
router.post("/",                  createQuotation);
router.get("/:id",                getQuotationById);
router.put("/:id",                updateQuotation);
router.delete("/:id",             deleteQuotation);
router.post("/:id/send",          sendQuotationEmail);
router.patch("/:id/status",       updateStatus);
router.post("/:id/negotiate",     addNegotiationNote);
router.post("/:id/revise",        createRevision);
router.post("/:id/convert-to-proforma", convertToProforma);

export default router;

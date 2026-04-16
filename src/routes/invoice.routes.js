import express from "express";
import {
  getInvoices, getInvoice, createInvoice, updateInvoice,
  deleteInvoice, convertToTax, updateStatus,
  getInvoiceConfig, updateInvoiceConfig,
} from "../controllers/invoice.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

/* Config routes must come before /:id to avoid param collision */
router.get("/config",       getInvoiceConfig);
router.put("/config",       updateInvoiceConfig);

router.get("/",             getInvoices);
router.post("/",            createInvoice);
router.get("/:id",          getInvoice);
router.put("/:id",          updateInvoice);
router.delete("/:id",       deleteInvoice);
router.post("/:id/convert", convertToTax);
router.patch("/:id/status", updateStatus);

export default router;

import express from "express";
import {
  getProformaInvoices,
  getProformaById,
  updateProforma,
  deleteProforma,
  sendProformaEmail,
} from "../controllers/proformaInvoice.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(protect);

router.get("/",             getProformaInvoices);
router.get("/:id",          getProformaById);
router.put("/:id",          updateProforma);
router.delete("/:id",       deleteProforma);
router.post("/:id/send",    sendProformaEmail);

export default router;

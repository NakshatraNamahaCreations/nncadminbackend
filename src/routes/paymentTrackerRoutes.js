import express from "express";
import {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getPayments,
  createPayment,
  getInvoicePayments,
  getClientHistory,
  uploadPaymentProof,
  uploadPaymentInvoice,
  updatePayment,
  getBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from "../controllers/paymentTrackerController.js";
import { protect } from "../middleware/auth.middleware.js";
import { proofUpload, invoiceUpload } from "../middleware/paymentUpload.js";

const router = express.Router();

router.use(protect);

router.get("/clients", getClients);
router.post("/clients", createClient);
router.put("/clients/:id", updateClient);
router.delete("/clients/:id", deleteClient);

router.get("/payments", getPayments);
router.post("/payments", createPayment);
router.patch("/payments/:id", updatePayment);
router.post("/payments/:id/upload-proof",   proofUpload.single("file"),   uploadPaymentProof);
router.post("/payments/:id/upload-invoice", invoiceUpload.single("file"), uploadPaymentInvoice);
router.get("/invoice-payments", getInvoicePayments);
router.get("/clients/:id/history", getClientHistory);

router.get("/bank-accounts",        getBankAccounts);
router.post("/bank-accounts",       createBankAccount);
router.put("/bank-accounts/:id",    updateBankAccount);
router.delete("/bank-accounts/:id", deleteBankAccount);

export default router;
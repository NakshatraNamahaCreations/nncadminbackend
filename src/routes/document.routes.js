import express from "express";
import upload from "../utils/upload.js";
import {
  uploadDocument,
  getAllDocuments,
  getDocumentStats,
  deleteDocument,
} from "../controllers/document.controller.js";

const router = express.Router();

router.post("/upload", upload.single("file"), uploadDocument);
router.get("/", getAllDocuments);
router.get("/stats", getDocumentStats);
router.delete("/:id", deleteDocument);

export default router;
import express from "express";
import { getOwnerDesk, getNotes, addNote, deleteNote, pinNote, markCollected, getPaymentExpected, leadSearch } from "../controllers/ownerDesk.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();
router.use(protect);

router.get("/",               getOwnerDesk);
router.get("/notes",          getNotes);
router.post("/notes",         addNote);
router.delete("/notes/:id",   deleteNote);
router.patch("/notes/:id/pin",     pinNote);
router.patch("/notes/:id/collect", markCollected);
router.get("/payment-expected",    getPaymentExpected);
router.get("/lead-search",         leadSearch);

export default router;

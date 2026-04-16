import express from "express";
import { gstLookup } from "../controllers/gst.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/:gstin", gstLookup);

export default router;

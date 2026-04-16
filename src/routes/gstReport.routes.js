import express from "express";
import { getGstReport } from "../controllers/gstReport.controller.js";

const router = express.Router();

router.get("/", getGstReport);

export default router;

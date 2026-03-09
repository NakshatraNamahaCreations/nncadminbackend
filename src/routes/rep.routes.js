import express from "express";
import { getReps, createRep } from "../controllers/rep.controller.js";

const router = express.Router();

router.get("/", getReps);
router.post("/", createRep);

export default router;
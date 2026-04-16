import express from "express";
import { createRep, getReps, getAllReps, updateRep, deleteRep } from "../controllers/rep.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/all", getAllReps);
router.get("/", getReps);
router.post("/", createRep);
router.put("/:id", updateRep);
router.delete("/:id", deleteRep);

export default router;
import express from "express";
import { loginAdmin, getProfile } from "../controllers/auth.controller.js";
import { protectAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/login", loginAdmin);
router.get("/profile", getProfile);

export default router;
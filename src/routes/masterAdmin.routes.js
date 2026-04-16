import express from "express";
import {
  getMasterAdminDashboard,
  createMasterAdminUser,
  updateMasterAdminUser,
  deleteMasterAdminUser,
} from "../controllers/masterAdmin.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/dashboard", getMasterAdminDashboard);
router.post("/users", createMasterAdminUser);
router.put("/users/:id", updateMasterAdminUser);
router.delete("/users/:id", deleteMasterAdminUser);

export default router;
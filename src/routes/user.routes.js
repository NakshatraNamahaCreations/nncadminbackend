import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { getUsers, createUser, updateUser, deleteUser } from "../controllers/user.controller.js";

const router = express.Router();

const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "master_admin") {
    return res.status(403).json({ success: false, message: "Super admin access required" });
  }
  next();
};

router.get(   "/",    protect, requireSuperAdmin, getUsers);
router.post(  "/",    protect, requireSuperAdmin, createUser);
router.put(   "/:id", protect, requireSuperAdmin, updateUser);
router.delete("/:id", protect, requireSuperAdmin, deleteUser);

export default router;

import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import {
  getCredentials,
  createCredential,
  updateCredential,
  deleteCredential,
  revealPassword,
  togglePin,
} from "../controllers/credential.controller.js";

const router = express.Router();
router.use(protect);

router.get("/",            getCredentials);
router.post("/",           createCredential);
router.put("/:id",         updateCredential);
router.delete("/:id",      deleteCredential);
router.post("/:id/reveal", revealPassword);
router.patch("/:id/pin",   togglePin);

export default router;

import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { getEvents, createEvent, deleteEvent } from "../controllers/calendarEvent.controller.js";

const router = express.Router();

router.get(      "/",    protect, getEvents);
router.post(     "/",    protect, createEvent);
router.delete(   "/:id", protect, deleteEvent);

export default router;

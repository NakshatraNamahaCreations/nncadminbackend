import express from "express";
import {
  getExpenses,
  getExpenseSummary,
  createExpense,
  updateExpense,
  deleteExpense,
  markExpenseStatus,
  getRentConfig,
  updateRentConfig,
  addRentConfig,
  deleteRentConfig,
  getRentStatus,
} from "../controllers/expense.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

/* rent config — must be before /:id routes */
router.get("/rent-config",          getRentConfig);
router.post("/rent-config",         addRentConfig);
router.put("/rent-config/:branch",  updateRentConfig);
router.delete("/rent-config/:branch", deleteRentConfig);
router.get("/rent-status",          getRentStatus);

router.get("/summary", getExpenseSummary);
router.get("/",        getExpenses);
router.post("/",       createExpense);
router.put("/:id",     updateExpense);
router.delete("/:id",  deleteExpense);
router.patch("/:id/status", markExpenseStatus);

export default router;

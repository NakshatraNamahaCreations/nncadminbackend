import express from "express";
import {
  // Employee CRUD
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  addSalaryHike,
  // Daily attendance
  getDailyAttendance,
  markAttendance,
  bulkMarkAttendance,
  // Monthly report
  getMonthlyReport,
  // Celebrations
  getCelebrations,
  // Salary
  generateSalary,
  generateBulkSalary,
  getSalaryRecords,
  getSalaryById,
  markSalaryPaid,
  generateSalarySlipPDF,
} from "../controllers/attendance.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

// ── Employee routes ──────────────────────────────────────────────────────────
router.get("/employees",      getEmployees);
router.post("/employees",     createEmployee);
router.get("/employees/:id",  getEmployeeById);
router.put("/employees/:id",  updateEmployee);
router.delete("/employees/:id", deleteEmployee);
router.post("/employees/:id/salary-hike", addSalaryHike);

// ── Daily attendance ─────────────────────────────────────────────────────────
router.get("/daily",       getDailyAttendance);
router.post("/mark",       markAttendance);
router.post("/mark-bulk",  bulkMarkAttendance);

// ── Monthly report ───────────────────────────────────────────────────────────
router.get("/monthly", getMonthlyReport);

// ── Celebrations (birthdays + anniversaries) ────────────────────────────────
router.get("/celebrations", getCelebrations);

// ── Salary routes (specific before :id) ─────────────────────────────────────
router.post("/salary/generate",       generateSalary);
router.post("/salary/generate-bulk",  generateBulkSalary);
router.get("/salary",                 getSalaryRecords);
router.get("/salary/:id/slip-pdf",    generateSalarySlipPDF);
router.get("/salary/:id",             getSalaryById);
router.patch("/salary/:id/paid",      markSalaryPaid);

export default router;

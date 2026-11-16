import mongoose from "mongoose";
import Expense from "../models/Expense.js";
import RentConfig from "../models/RentConfig.js";

const RENT_BRANCHES = ["Mysore", "Bangalore", "Mumbai"];
const RENT_DEFAULTS = { Mysore: 32000, Bangalore: 24750, Mumbai: 33000 };
const VALID_CATEGORIES = ["rent", "salary", "electricity", "internet", "maintenance", "other"];

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function safeNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function parseYearMonth(query) {
  const now = new Date();
  const year = safeNumber(query.year, now.getFullYear());
  const month = safeNumber(query.month, now.getMonth() + 1);
  if (month < 1 || month > 12) return null;
  if (year < 1970 || year > 2100) return null;
  return { year, month };
}

/* ─── the 3 offices are added the first time only; after that offices are added and removed in Settings ─── */
async function ensureRentConfigs() {
  if (await RentConfig.exists({})) return;
  for (const branch of RENT_BRANCHES) {
    await RentConfig.findOneAndUpdate(
      { branch },
      { $setOnInsert: { amount: RENT_DEFAULTS[branch], dueDay: 1, notes: "" } },
      { upsert: true, new: true }
    );
  }
}

/* ─── GET /api/expenses/rent-config ─── */
export async function getRentConfig(req, res) {
  try {
    await ensureRentConfigs();
    const configs = await RentConfig.find({}).sort({ createdAt: 1 }).lean();
    return res.status(200).json({ success: true, data: configs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── PUT /api/expenses/rent-config/:branch ─── */
export async function updateRentConfig(req, res) {
  try {
    const { branch } = req.params;
    if (!(await RentConfig.exists({ branch }))) {
      return res.status(404).json({ success: false, message: "Office not found" });
    }
    const { amount, dueDay, notes } = req.body;
    const updates = {};
    // rename: the office's past rent entries move to the new name too
    const newName = String(req.body.name ?? "").trim().slice(0, 60);
    if (newName && newName !== branch) {
      if (await RentConfig.exists({ branch: newName })) return res.status(409).json({ success: false, message: `${newName} already exists` });
      updates.branch = newName;
    }
    if (amount !== undefined) {
      const num = Number(amount);
      if (!Number.isFinite(num) || num < 0) {
        return res.status(400).json({ success: false, message: "amount must be a non-negative number" });
      }
      updates.amount = num;
    }
    if (dueDay !== undefined) {
      const num = Number(dueDay);
      if (!Number.isFinite(num) || num < 1 || num > 28) {
        return res.status(400).json({ success: false, message: "dueDay must be between 1 and 28" });
      }
      updates.dueDay = num;
    }
    if (notes !== undefined) updates.notes = notes;

    const config = await RentConfig.findOneAndUpdate(
      { branch },
      { $set: updates },
      { new: true }
    ).lean();
    if (updates.branch) await Expense.updateMany({ category: "rent", branch }, { $set: { branch: updates.branch } });
    return res.status(200).json({ success: true, data: config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── POST /api/expenses/rent-config { name, amount, dueDay, notes } → a new office ─── */
export async function addRentConfig(req, res) {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ success: false, message: "Office name is required" });
    if (await RentConfig.exists({ branch: name })) return res.status(409).json({ success: false, message: `${name} already exists` });
    const amount = Number(req.body.amount || 0), dueDay = Number(req.body.dueDay || 1);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ success: false, message: "amount must be a non-negative number" });
    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 28) return res.status(400).json({ success: false, message: "dueDay must be between 1 and 28" });
    const config = await RentConfig.create({ branch: name, amount, dueDay, notes: String(req.body.notes || "") });
    return res.status(201).json({ success: true, data: config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── DELETE /api/expenses/rent-config/:branch → stop tracking rent for an office (paid rent entries stay) ─── */
export async function deleteRentConfig(req, res) {
  try {
    const r = await RentConfig.findOneAndDelete({ branch: req.params.branch });
    if (!r) return res.status(404).json({ success: false, message: "Office not found" });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── GET /api/expenses/rent-status?year=&month= ─── */
export async function getRentStatus(req, res) {
  try {
    await ensureRentConfigs();
    const ym = parseYearMonth(req.query);
    if (!ym) return res.status(400).json({ success: false, message: "Invalid year or month" });
    const { year, month } = ym;

    const [configs, rentExpenses] = await Promise.all([
      RentConfig.find({}).sort({ createdAt: 1 }).lean(),
      Expense.find({ year, month, category: "rent" }).lean(),
    ]);

    const paidMap = {};
    for (const exp of rentExpenses) {
      if (!paidMap[exp.branch]) paidMap[exp.branch] = { total: 0, entries: [] };
      paidMap[exp.branch].total += exp.amount;
      paidMap[exp.branch].entries.push({ _id: exp._id, amount: exp.amount, status: exp.status, date: exp.date });
    }

    const status = configs.map(cfg => {
      const paid = paidMap[cfg.branch];
      const paidAmount  = paid?.total || 0;
      const isPaid      = paid?.entries?.some(e => e.status === "paid") && paidAmount >= cfg.amount;
      return {
        branch:      cfg.branch,
        configuredAmount: cfg.amount,
        dueDay:      cfg.dueDay,
        notes:       cfg.notes,
        paidAmount,
        isPaid,
        entries:     paid?.entries || [],
        shortfall:   Math.max(0, cfg.amount - paidAmount),
      };
    });

    return res.status(200).json({ success: true, data: status });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── GET /api/expenses?year=&month=&category=&branch= ─── */
export async function getExpenses(req, res) {
  try {
    const ym = parseYearMonth(req.query);
    if (!ym) return res.status(400).json({ success: false, message: "Invalid year or month" });
    const { year, month } = ym;

    const filter = { year, month };
    if (req.query.category && req.query.category !== "all") filter.category = req.query.category;
    if (req.query.branch   && req.query.branch   !== "all") filter.branch   = req.query.branch;

    const expenses = await Expense.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: expenses });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── GET /api/expenses/summary?year=&month= ─── */
export async function getExpenseSummary(req, res) {
  try {
    const ym = parseYearMonth(req.query);
    if (!ym) return res.status(400).json({ success: false, message: "Invalid year or month" });
    const { year, month } = ym;

    const [categoryBreakdown, branchBreakdown, statusBreakdown] = await Promise.all([
      Expense.aggregate([
        { $match: { year, month } },
        { $group: {
          _id:    "$category",
          total:  { $sum: "$amount" },
          count:  { $sum: 1 },
          paid:   { $sum: { $cond: [{ $eq: ["$status", "paid"] },    "$amount", 0] } },
          pending:{ $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } },
        }},
      ]),
      Expense.aggregate([
        { $match: { year, month } },
        { $group: {
          _id:   "$branch",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        }},
      ]),
      Expense.aggregate([
        { $match: { year, month } },
        { $group: {
          _id:    null,
          total:  { $sum: "$amount" },
          paid:   { $sum: { $cond: [{ $eq: ["$status", "paid"] },    "$amount", 0] } },
          pending:{ $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0] } },
          count:  { $sum: 1 },
        }},
      ]),
    ]);

    const totals = statusBreakdown[0] || { total: 0, paid: 0, pending: 0, count: 0 };

    return res.status(200).json({
      success: true,
      data: {
        year, month,
        total:   totals.total,
        paid:    totals.paid,
        pending: totals.pending,
        count:   totals.count,
        byCategory: categoryBreakdown.reduce((acc, r) => { acc[r._id] = r; return acc; }, {}),
        byBranch:   branchBreakdown.reduce((acc, r)   => { acc[r._id] = r; return acc; }, {}),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── POST /api/expenses ─── */
export async function createExpense(req, res) {
  try {
    const { category, subcategory, branch, amount, date, description,
            paidBy, paymentMethod, status, isRecurring, notes } = req.body;

    if (!category || amount === undefined || amount === null || !date) {
      return res.status(400).json({ success: false, message: "category, amount and date are required" });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0) {
      return res.status(400).json({ success: false, message: "amount must be a non-negative number" });
    }

    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid date" });
    }
    const month = d.getMonth() + 1;
    const year  = d.getFullYear();

    if (status && !["paid", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be paid or pending" });
    }

    const expense = await Expense.create({
      category, subcategory, branch, amount: numAmount,
      date: d, month, year, description, paidBy,
      paymentMethod, status: status || "pending",
      isRecurring: !!isRecurring, notes,
    });

    return res.status(201).json({ success: true, data: expense });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── PUT /api/expenses/:id ─── */
export async function updateExpense(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid expense ID" });
    }

    const updates = { ...req.body };

    if (updates.category !== undefined && !VALID_CATEGORIES.includes(updates.category)) {
      return res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }

    if (updates.status !== undefined && !["paid", "pending"].includes(updates.status)) {
      return res.status(400).json({ success: false, message: "status must be paid or pending" });
    }

    if (updates.date) {
      const d = new Date(updates.date);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date" });
      }
      updates.date  = d;
      updates.month = d.getMonth() + 1;
      updates.year  = d.getFullYear();
    }
    if (updates.amount !== undefined) {
      const numAmount = Number(updates.amount);
      if (!Number.isFinite(numAmount) || numAmount < 0) {
        return res.status(400).json({ success: false, message: "amount must be a non-negative number" });
      }
      updates.amount = numAmount;
    }

    const expense = await Expense.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    return res.status(200).json({ success: true, data: expense });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── DELETE /api/expenses/:id ─── */
export async function deleteExpense(req, res) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid expense ID" });
    }
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── PATCH /api/expenses/:id/status ─── */
export async function markExpenseStatus(req, res) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid expense ID" });
    }
    const { status } = req.body;
    if (!status || !["paid", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be paid or pending" });
    }
    const expense = await Expense.findByIdAndUpdate(
      req.params.id, { $set: { status } }, { new: true }
    ).lean();
    if (!expense) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: expense });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

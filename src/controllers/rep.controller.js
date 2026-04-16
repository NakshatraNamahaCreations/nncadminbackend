import mongoose from "mongoose";
import Rep from "../models/Rep.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getReps = async (req, res) => {
  try {
    const reps = await Rep.find({ isActive: true }).sort({ name: 1 }).lean();

    return res.status(200).json({
      success: true,
      message: "Reps fetched successfully",
      data: reps,
    });
  } catch (error) {
    console.error("getReps error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reps",
    });
  }
};

const createRep = async (req, res) => {
  try {
    const name     = String(req.body?.name || "").trim();
    const branches = Array.isArray(req.body?.branches) ? req.body.branches : (req.body?.branch ? [req.body.branch] : []);
    const branch   = branches[0] || "";

    if (!name) {
      return res.status(400).json({ success: false, message: "Rep name is required" });
    }

    const existingRep = await Rep.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") } });
    if (existingRep) {
      return res.status(200).json({ success: true, message: "Rep already exists", data: existingRep });
    }

    const rep = await Rep.create({
      name,
      branch,
      branches,
      email: req.body?.email || "",
      phone: req.body?.phone || "",
    });

    return res.status(201).json({ success: true, message: "Rep created successfully", data: rep });
  } catch (error) {
    console.error("createRep error:", error);
    return res.status(500).json({ success: false, message: "Failed to create rep" });
  }
};

const getAllReps = async (req, res) => {
  try {
    const reps = await Rep.find({}).sort({ name: 1 }).lean();
    return res.status(200).json({ success: true, data: reps });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch reps" });
  }
};

const updateRep = async (req, res) => {
  try {
    const { name, email, phone, isActive } = req.body;
    const branches = Array.isArray(req.body?.branches) ? req.body.branches : undefined;
    const branch   = branches ? (branches[0] || "") : req.body?.branch;

    const update = {
      ...(name     !== undefined && { name }),
      ...(email    !== undefined && { email }),
      ...(phone    !== undefined && { phone }),
      ...(isActive !== undefined && { isActive }),
      ...(branches !== undefined && { branches, branch }),
      ...(branch   !== undefined && branches === undefined && { branch }),
    };

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid rep id" });
    }
    const rep = await Rep.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!rep) return res.status(404).json({ success: false, message: "Rep not found" });
    return res.json({ success: true, data: rep });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update rep" });
  }
};

const deleteRep = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid rep id" });
    }
    const rep = await Rep.findByIdAndDelete(req.params.id);
    if (!rep) return res.status(404).json({ success: false, message: "Rep not found" });
    return res.json({ success: true, message: "Rep deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to delete rep" });
  }
};

export { getReps, getAllReps, createRep, updateRep, deleteRep };
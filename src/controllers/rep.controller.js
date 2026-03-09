import Rep from "../models/Rep.js";

const clean = (v) => (v == null ? "" : String(v).trim());

export const getReps = async (req, res) => {
  try {
    const reps = await Rep.find({ isActive: true }).sort({ name: 1 });

    return res.json({
      success: true,
      data: reps,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch reps",
    });
  }
};

export const createRep = async (req, res) => {
  try {
    const { name } = req.body || {};

    if (!clean(name)) {
      return res.status(400).json({
        success: false,
        message: "Rep name is required",
      });
    }

    const exists = await Rep.findOne({
      name: { $regex: new RegExp(`^${clean(name)}$`, "i") },
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Rep already exists",
      });
    }

    const rep = await Rep.create({
      name: clean(name),
    });

    return res.status(201).json({
      success: true,
      data: rep,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create rep",
    });
  }
};
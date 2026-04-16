import bcrypt from "bcrypt";
import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import BranchTarget from "../models/BranchTarget.js";

const DEFAULT_BRANCHES = ["Bangalore", "Mumbai", "Mysore"];

const normalizeBranch = (value) => {
  try {
    if (!value || typeof value !== "string") return "";
    return value.trim();
  } catch (error) {
    console.error("normalizeBranch error:", error);
    return "";
  }
};

export const getMasterAdminDashboard = async (req, res) => {
  try {
    const users = await Admin.find({})
      .select("name email role branch isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const branchTargets = await BranchTarget.find({}).sort({ branch: 1 }).lean();

    const userBranches = users
      .map((user) => normalizeBranch(user?.branch))
      .filter((branch) => branch && branch.toLowerCase() !== "all");

    const targetBranches = branchTargets
      .map((item) => normalizeBranch(item?.branch))
      .filter(Boolean);

    const branches = [...new Set([...DEFAULT_BRANCHES, ...userBranches, ...targetBranches])];

    const activeBranches = [
      ...new Set(
        users
          .filter((user) => user?.isActive)
          .map((user) => normalizeBranch(user?.branch))
          .filter((branch) => branch && branch.toLowerCase() !== "all")
      ),
    ];

    const monthlyTarget = branchTargets.reduce((sum, item) => {
      const n = Number(item?.target);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          totalUsers: users.length,
          activeBranches: activeBranches.length || branches.length || 0,
          monthlyTarget,
          systemHealth: 98,
        },
        users,
        branchTargets,
        branches,
      },
    });
  } catch (error) {
    console.error("getMasterAdminDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch master admin dashboard",
    });
  }
};

export const createMasterAdminUser = async (req, res) => {
  try {
    const { name, email, password, role, branch, isActive } = req.body;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    const existingUser = await Admin.findOne({
      email: email.trim().toLowerCase(),
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    const newUser = await Admin.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role: role || "sales_rep",
      branch: normalizeBranch(branch) || "Bangalore",
      isActive: isActive ?? true,
    });

    const userObj = newUser.toObject();
    delete userObj.password;

    return res.status(201).json({
      success: true,
      message: "User created successfully",
      data: userObj,
    });
  } catch (error) {
    console.error("createMasterAdminUser error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create user",
    });
  }
};

export const updateMasterAdminUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, branch, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const user = await Admin.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (email?.trim()) {
      const duplicateUser = await Admin.findOne({
        email: email.trim().toLowerCase(),
        _id: { $ne: id },
      });

      if (duplicateUser) {
        return res.status(409).json({
          success: false,
          message: "Another user already exists with this email",
        });
      }
    }

    user.name = name?.trim() || user.name;
    user.email = email?.trim()?.toLowerCase() || user.email;
    user.role = role || user.role;
    user.branch = normalizeBranch(branch) || user.branch;
    user.isActive = typeof isActive === "boolean" ? isActive : user.isActive;

    if (password?.trim()) {
      user.password = await bcrypt.hash(password.trim(), 10);
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      data: userObj,
    });
  } catch (error) {
    console.error("updateMasterAdminUser error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user",
    });
  }
};

export const deleteMasterAdminUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const user = await Admin.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.role === "master_admin") {
      return res.status(400).json({
        success: false,
        message: "Master admin cannot be deleted",
      });
    }

    await Admin.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("deleteMasterAdminUser error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete user",
    });
  }
};
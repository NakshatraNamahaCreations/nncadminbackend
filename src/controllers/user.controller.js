import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "../models/User.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/* ─── Simple in-memory cache for user list (invalidated on write) ── */
let _usersCache = null;
let _usersCacheAt = 0;
const USERS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const invalidateUsersCache = () => { _usersCache = null; _usersCacheAt = 0; };

/* ─── GET all users ─────────────────────────────────────── */
export const getUsers = async (req, res) => {
  try {
    const now = Date.now();
    if (_usersCache && (now - _usersCacheAt) < USERS_CACHE_TTL) {
      return res.json({ success: true, data: _usersCache });
    }
    const users = await User.find({}).select("-password").sort({ createdAt: -1 }).lean();
    _usersCache   = users;
    _usersCacheAt = now;
    return res.json({ success: true, data: users });
  } catch (err) {
    console.error("getUsers error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── POST create user ─────────────────────────────────── */
export const createUser = async (req, res) => {
  try {
    const { name, username, password, role, modules } = req.body;

    if (!name?.trim() || !username?.trim() || !password?.trim()) {
      return res.status(400).json({ success: false, message: "Name, username, and password are required" });
    }
    if (password.trim().length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const existing = await User.findOne({ username: username.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: "Username already taken" });
    }

    const hashed = await bcrypt.hash(password.trim(), 10);
    const user = await User.create({
      name:      name.trim(),
      username:  username.trim().toLowerCase(),
      password:  hashed,
      role:      role?.trim() || "User",
      modules:   Array.isArray(modules) ? modules : [],
      createdBy: req.user?.id || null,
    });

    invalidateUsersCache();
    const obj = user.toObject();
    delete obj.password;
    return res.status(201).json({ success: true, data: obj });
  } catch (err) {
    console.error("createUser error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── PUT update user ──────────────────────────────────── */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const { name, username, password, role, modules, isActive } = req.body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (name?.trim())     user.name     = name.trim();
    if (role !== undefined) user.role   = role?.trim() || user.role;
    if (modules !== undefined) {
      user.modules = Array.isArray(modules) ? modules : user.modules;
      user.markModified('modules');
    }
    if (isActive !== undefined) user.isActive = Boolean(isActive);

    if (username?.trim()) {
      const lc = username.trim().toLowerCase();
      const taken = await User.findOne({ username: lc, _id: { $ne: id } });
      if (taken) return res.status(409).json({ success: false, message: "Username already taken" });
      user.username = lc;
    }

    if (password?.trim() && password.trim().length >= 6) {
      user.password = await bcrypt.hash(password.trim(), 10);
    }

    await user.save();
    invalidateUsersCache();
    const obj = user.toObject();
    delete obj.password;
    return res.json({ success: true, data: obj });
  } catch (err) {
    console.error("updateUser error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── DELETE user ──────────────────────────────────────── */
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    invalidateUsersCache();
    return res.json({ success: true, message: "User deleted" });
  } catch (err) {
    console.error("deleteUser error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

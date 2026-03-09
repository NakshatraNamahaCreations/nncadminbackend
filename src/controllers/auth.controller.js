import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";

export const loginAdmin = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    console.log("Login request:", { email, role ,password});

    if (!email?.trim() || !password?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const admin = await Admin.findOne({
      email: email.trim().toLowerCase(),
    });

    console.log("Admin found:", admin ? admin.email : null);
    console.log("Stored role:", admin?.role || null);
    console.log("Stored password:", admin?.password || null);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive",
      });
    }

    let isPasswordCorrect = false;

    try {
      if (typeof admin.password === "string" && admin.password.startsWith("$2")) {
        isPasswordCorrect = await bcrypt.compare(password, admin.password);
      } else {
        isPasswordCorrect = password === admin.password;
      }
    } catch (error) {
      console.error("Password compare error:", error);
      isPasswordCorrect = false;
    }

    console.log("Password matched:", isPasswordCorrect);

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (role && admin.role && role !== admin.role) {
      return res.status(403).json({
        success: false,
        message: `You are not allowed to login as ${role}`,
      });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        email: admin.email,
        role: admin.role,
      },
      process.env.JWT_SECRET || "supersecretkey",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          isActive: admin.isActive,
        },
      },
    });
  } catch (error) {
    console.error("loginAdmin error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user.id).select("-password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};
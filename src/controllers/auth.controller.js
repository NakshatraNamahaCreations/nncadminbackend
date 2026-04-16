import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import Admin from "../models/Admin.js";
import User from "../models/User.js";

function getMailer() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || process.env.SMTP_HOST,
    port: Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 465),
    secure: Number(process.env.EMAIL_PORT || 465) === 465,
    auth: {
      user: process.env.EMAIL_USER || process.env.SMTP_USER,
      pass: process.env.EMAIL_PASS || process.env.SMTP_PASS,
    },
  });
}

async function checkPassword(plain, stored) {
  if (typeof stored === "string" && stored.startsWith("$2")) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

export const loginAdmin = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email?.trim() || !password?.trim()) {
      return res.status(400).json({ success: false, message: "Username/email and password are required" });
    }

    const identifier = email.trim().toLowerCase();

    /* ── 1. Try Admin model first (by email) ── */
    const admin = await Admin.findOne({ email: identifier });

    if (admin) {
      if (!admin.isActive) {
        return res.status(403).json({ success: false, message: "Your account is inactive" });
      }

      const ok = await checkPassword(password, admin.password);
      if (!ok) {
        return res.status(401).json({ success: false, message: "Invalid email or password" });
      }

      if (role && admin.role && role !== admin.role) {
        return res.status(403).json({ success: false, message: `You are not allowed to login as ${role}` });
      }

      const token = jwt.sign(
        { id: admin._id, email: admin.email, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          token,
          user: {
            id:        admin._id,
            name:      admin.name,
            email:     admin.email,
            role:      admin.role,
            isActive:  admin.isActive,
            modules:   null, // null = all access (super admin)
            userType:  "admin",
          },
        },
      });
    }

    /* ── 2. Try managed User model (by username) ── */
    const managedUser = await User.findOne({ username: identifier });

    if (managedUser) {
      if (!managedUser.isActive) {
        return res.status(403).json({ success: false, message: "Your account is inactive" });
      }

      const ok = await checkPassword(password, managedUser.password);
      if (!ok) {
        return res.status(401).json({ success: false, message: "Invalid username or password" });
      }

      const token = jwt.sign(
        { id: managedUser._id, email: managedUser.username, role: managedUser.role, userType: "managed" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          token,
          user: {
            id:        managedUser._id,
            name:      managedUser.name,
            email:     managedUser.username,
            role:      managedUser.role,
            isActive:  managedUser.isActive,
            modules:   managedUser.modules,
            userType:  "managed",
          },
        },
      });
    }

    return res.status(401).json({ success: false, message: "Invalid credentials" });

  } catch (error) {
    console.error("loginAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userType = req.user.userType || "admin";

    if (userType === "managed") {
      const user = await User.findById(userId).select("-password");
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      return res.status(200).json({
        success: true,
        data: {
          id:       user._id,
          name:     user.name,
          email:    user.username,
          role:     user.role,
          isActive: user.isActive,
          modules:  user.modules,
          userType: "managed",
        },
      });
    }

    // Admin (master_admin / branch_manager / etc.)
    const admin = await Admin.findById(userId).select("-password");
    if (!admin) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    return res.status(200).json({
      success: true,
      data: {
        id:       admin._id,
        name:     admin.name,
        email:    admin.email,
        role:     admin.role,
        isActive: admin.isActive,
        modules:  null,
        userType: "admin",
      },
    });
  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required",
      });
    }

    if (password.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const allowedRoles = ["master_admin", "branch_manager", "sales_rep", "viewer"];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${allowedRoles.join(", ")}`,
      });
    }

    const existing = await Admin.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An admin with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    const admin = await Admin.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role: role || "master_admin",
    });

    return res.status(201).json({
      success: true,
      message: "Admin registered successfully",
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
      },
    });
  } catch (error) {
    console.error("registerAdmin error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

export const changePassword = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!currentPassword?.trim() || !newPassword?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    let isCurrentPasswordCorrect = false;

    try {
      if (typeof admin.password === "string" && admin.password.startsWith("$2")) {
        isCurrentPasswordCorrect = await bcrypt.compare(currentPassword, admin.password);
      } else {
        isCurrentPasswordCorrect = currentPassword === admin.password;
      }
    } catch (error) {
      console.error("Current password compare error:", error);
      isCurrentPasswordCorrect = false;
    }

    if (!isCurrentPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    let isSamePassword = false;

    try {
      if (typeof admin.password === "string" && admin.password.startsWith("$2")) {
        isSamePassword = await bcrypt.compare(newPassword, admin.password);
      } else {
        isSamePassword = newPassword === admin.password;
      }
    } catch (error) {
      console.error("Same password compare error:", error);
      isSamePassword = false;
    }

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    admin.password = hashedPassword;
    await admin.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

// ── Forgot Password: send OTP ──────────────────────────────────────────────────
export const forgotPassword = async (req, res) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: "Email is required" });

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(404).json({ success: false, message: "No account found with that email" });

    // Generate 6-digit OTP, valid for 10 minutes
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    admin.otpCode   = otp;
    admin.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await admin.save();

    await getMailer().sendMail({
      from: `"NNC CRM" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "NNC CRM — Password Reset OTP",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:12px;">
          <h2 style="color:#1e293b;margin:0 0 8px;">Password Reset</h2>
          <p style="color:#64748b;font-size:14px;margin:0 0 24px;">Use the OTP below to reset your NNC CRM password. It expires in <strong>10 minutes</strong>.</p>
          <div style="background:#fff;border:2px dashed #e2e8f0;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
            <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#2563eb;">${otp}</div>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:0;">If you didn't request this, ignore this email. Your password will not change.</p>
        </div>
      `,
    });

    const masked = email.replace(/(.{2})(.*)(@.*)/, "$1***$3");
    return res.json({ success: true, message: `OTP sent to ${masked}` });
  } catch (error) {
    console.error("forgotPassword error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to send OTP" });
  }
};

// ── Verify OTP ─────────────────────────────────────────────────────────────────
export const verifyOtp = async (req, res) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();
    const otp   = req.body?.otp?.trim();
    if (!email || !otp) return res.status(400).json({ success: false, message: "Email and OTP are required" });

    const admin = await Admin.findOne({ email });
    if (!admin || !admin.otpCode) return res.status(400).json({ success: false, message: "No OTP requested for this email" });

    if (new Date() > admin.otpExpiry) {
      admin.otpCode = null; admin.otpExpiry = null; await admin.save();
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    if (admin.otpCode !== otp) return res.status(400).json({ success: false, message: "Incorrect OTP" });

    return res.json({ success: true, message: "OTP verified" });
  } catch (error) {
    console.error("verifyOtp error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// ── Reset Password ─────────────────────────────────────────────────────────────
export const resetPassword = async (req, res) => {
  try {
    const email       = req.body?.email?.trim().toLowerCase();
    const otp         = req.body?.otp?.trim();
    const newPassword = req.body?.newPassword?.trim();

    if (!email || !otp || !newPassword) return res.status(400).json({ success: false, message: "Email, OTP and new password are required" });
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });

    const admin = await Admin.findOne({ email });
    if (!admin || !admin.otpCode) return res.status(400).json({ success: false, message: "No OTP found. Please request a new one." });
    if (new Date() > admin.otpExpiry) {
      admin.otpCode = null; admin.otpExpiry = null; await admin.save();
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }
    if (admin.otpCode !== otp) return res.status(400).json({ success: false, message: "Incorrect OTP" });

    admin.password  = await bcrypt.hash(newPassword, 10);
    admin.otpCode   = null;
    admin.otpExpiry = null;
    await admin.save();

    return res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("resetPassword error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};
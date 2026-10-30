import Admin from "../models/Admin.js";
import User from "../models/User.js";

/**
 * Server-side module permission check (use after `protect`).
 *
 *   requireModule("integrations")          → needs view access
 *   requireModule("integrations", "edit")  → needs full/edit access
 *
 * Admin accounts have full access (role "viewer" is view-only).
 * Managed users need the module in their `modules` list:
 *   "integrations" or "integrations:edit" → full, "integrations:view" → view only.
 *
 * Also sets req.actorName (the person's display name) for audit fields.
 */
export const requireModule = (moduleKey, level = "view") => async (req, res, next) => {
  try {
    const { id, userType, role } = req.user || {};
    let canView = false;
    let canEdit = false;

    if (userType === "managed") {
      const u = await User.findById(id).select("name modules isActive").lean();
      const mods = u?.isActive ? (u.modules || []) : [];
      canEdit = mods.includes(moduleKey) || mods.includes(`${moduleKey}:edit`);
      canView = canEdit || mods.includes(`${moduleKey}:view`);
      req.actorName = u?.name || "User";
    } else {
      const a = await Admin.findById(id).select("name isActive").lean();
      const active = a ? a.isActive !== false : false;
      canView = active;
      canEdit = active && role !== "viewer";
      req.actorName = a?.name || "Admin";
    }

    if (level === "edit" ? canEdit : canView) return next();
    return res.status(403).json({ success: false, message: "You don't have permission for this action" });
  } catch (err) {
    console.error("requireModule error:", err);
    return res.status(500).json({ success: false, message: "Permission check failed" });
  }
};

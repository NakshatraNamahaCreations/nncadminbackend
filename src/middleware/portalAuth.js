import jwt from "jsonwebtoken";
import { PortalAccount } from "../models/Portal.js";

// Portal tokens use their own signing key, so they can never pass the CRM's `protect`
// (and CRM tokens can never pass this one).
export const portalSecret = () => {
  const base = process.env.PORTAL_JWT_SECRET || (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}::nnc-employee-portal` : "");
  if (!base) throw new Error("JWT_SECRET is not set");
  return base;
};

export const signPortalToken = (acc) => jwt.sign({ id: String(acc._id), kind: "portal" }, portalSecret(), { expiresIn: "7d" });

export const protectPortal = async (req, res, next) => {
  try {
    const h = req.headers.authorization || "";
    if (!h.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Please sign in" });
    const decoded = jwt.verify(h.slice(7), portalSecret());
    if (decoded.kind !== "portal") throw new Error("wrong token");
    const acc = await PortalAccount.findById(decoded.id).lean();
    if (!acc || acc.status !== "active") return res.status(401).json({ success: false, message: "Your account is not active" });
    req.portal = acc;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
  }
};

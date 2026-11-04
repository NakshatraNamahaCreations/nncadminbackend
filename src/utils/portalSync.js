import bcrypt from "bcryptjs";
import { PortalAccount, PortalTask, PortalNotification, PortalBlocker, TeamRead } from "../models/Portal.js";

// Keeps CRM team records (Developer, SeoMember) and Employee Portal logins in step.

// CRM developer role → portal role
const DEV_TO_PORTAL = {
  "Full Stack": "full", Frontend: "web", Backend: "back", "Mobile App": "app",
  "UI/UX Designer": "ux", "WordPress / CMS": "web", "Tester / QA": "test", Other: "other",
};
const DEV_PORTAL_ROLES = ["app", "web", "back", "full", "ux", "test", "other"];

export function checkPassword(pw) {
  if (String(pw).length < 8 || !/\d/.test(pw)) {
    const e = new Error("Password needs at least 8 characters and a number."); e.status = 400; throw e;
  }
}

// Delete portal logins (and their personal inbox data). Logged work, meetings and days stay as history.
export async function removePortalAccounts(filter) {
  const accs = await PortalAccount.find(filter).select("_id").lean();
  if (!accs.length) return 0;
  const ids = accs.map(a => a._id);
  await Promise.all([
    PortalTask.deleteMany({ account: { $in: ids } }),
    PortalNotification.deleteMany({ account: { $in: ids } }),
    PortalBlocker.deleteMany({ account: { $in: ids } }),
    TeamRead.deleteMany({ who: { $in: ids.map(i => `emp:${i}`) } }),
    PortalAccount.deleteMany({ _id: { $in: ids } }),
  ]);
  return ids.length;
}

// Create or update the portal login for a CRM developer. password is optional on updates.
export async function syncDeveloperLogin(dev, password, by) {
  const email = String(dev.email || "").trim().toLowerCase();
  let acc = await PortalAccount.findOne({ developer: dev._id }).select("+password");
  if (!acc && !password) return null;                       // no login yet and none asked for
  if (!acc && email) acc = await PortalAccount.findOne({ email }).select("+password");
  if (password) checkPassword(password);
  if (!email) { const e = new Error("Add the developer's email: it is their portal login."); e.status = 400; throw e; }
  const clash = await PortalAccount.findOne({ email, ...(acc ? { _id: { $ne: acc._id } } : {}) }).select("_id").lean();
  if (clash) { const e = new Error("Another portal account already uses this email."); e.status = 409; throw e; }

  const role = DEV_TO_PORTAL[dev.role] || "full";
  if (!acc) {
    acc = new PortalAccount({ name: dev.name, email, phone: dev.phone || "-", role, status: "active", approvedBy: by || "Admin" });
  } else {
    acc.name = dev.name; acc.email = email;
    if (dev.phone) acc.phone = dev.phone;
    if (DEV_PORTAL_ROLES.includes(acc.role)) acc.role = role;   // keep a tester/designer role if it was set on purpose
    if (password && acc.status !== "active") acc.status = "active";
  }
  acc.developer = dev._id;
  if (password) { acc.password = await bcrypt.hash(password, 10); acc.mustChange = false; }
  if (dev.isActive === false && acc.status === "active") acc.status = "disabled";
  await acc.save();
  return acc;
}

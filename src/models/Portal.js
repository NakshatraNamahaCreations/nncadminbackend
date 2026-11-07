import mongoose from "mongoose";

const { ObjectId, Mixed } = mongoose.Schema.Types;

// Employee Portal roles (the portal's own list; linked to SEO team / Developers records)
export const PORTAL_ROLES = ["seo", "seox", "ads", "gfx", "app", "web", "back", "full", "ux", "test", "other", "acc"];

/* An employee's portal login */
const PortalAccountSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, trim: true },
    email:      { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone:      { type: String, required: true, trim: true },
    role:       { type: String, enum: PORTAL_ROLES, required: true },
    roles:      { type: [{ type: String, enum: PORTAL_ROLES }], default: [] },   // extra roles (the main one is role)
    branch:     { type: String, default: "", trim: true },   // office they work from: Bangalore, Mysore or Mumbai
    password:   { type: String, required: true, select: false },
    status:     { type: String, enum: ["pending", "active", "disabled"], default: "pending" },
    mustChange: { type: Boolean, default: false },   // set after an admin reset
    lastLogin:  { type: Date, default: null },
    logins:     { type: Number, default: 0 },
    // Linked CRM records, created when the account becomes active
    seoMember:  { type: ObjectId, ref: "SeoMember", default: null },
    developer:  { type: ObjectId, ref: "Developer", default: null },
    approvedBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "portal_accounts" }
);
PortalAccountSchema.index({ phone: 1 });

/* One piece of logged work (the employee's timesheet) */
const PortalWorkSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: "PortalAccount", required: true },
    date:    { type: String, required: true },         // "YYYY-MM-DD" (employee's day)
    type:    { type: String, required: true },
    refType: { type: String, enum: ["client", "project", ""], default: "" },
    refId:   { type: ObjectId, default: null },        // SeoClient or Lead
    refName: { type: String, default: "" },
    title:   { type: String, default: "", trim: true },
    url:     { type: String, default: "", trim: true },
    hrs:     { type: Number, default: 0, min: 0 },
    meta:    { type: Mixed, default: {} },             // kw, da, screens, bug status, etc.
    seoWork: { type: ObjectId, ref: "SeoWork", default: null }, // copy in the SEO & Ads Team log
  },
  { timestamps: true, collection: "portal_work", minimize: false }
);
PortalWorkSchema.index({ account: 1, date: -1 });
PortalWorkSchema.index({ date: -1 });
PortalWorkSchema.index({ type: 1, "meta.assign": 1 });

/* Tasks: assigned by the admin, or the employee's own to-dos */
const PortalTaskSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: "PortalAccount", required: true },
    title:   { type: String, required: true, trim: true },
    refName: { type: String, default: "" },
    refId:   { type: ObjectId, default: null },              // the CRM project (Lead) or SEO client it is for
    due:     { type: String, required: true },         // "YYYY-MM-DD"
    status:  { type: String, enum: ["todo", "doing", "done"], default: "todo" },
    from:    { type: String, default: "me" },          // "me" or the admin's name
    doneOn:  { type: String, default: "" },
  },
  { timestamps: true, collection: "portal_tasks" }
);
PortalTaskSchema.index({ account: 1, status: 1 });

/* Meeting notes and minutes */
const PortalMeetingSchema = new mongoose.Schema(
  {
    account:  { type: ObjectId, ref: "PortalAccount", required: true },
    refName:  { type: String, default: "" },
    title:    { type: String, required: true, trim: true },
    date:     { type: String, required: true },
    time:     { type: String, default: "" },
    dur:      { type: Number, default: 1 },
    mode:     { type: String, default: "Google Meet" },
    theirs:   { type: String, default: "" },
    ours:     { type: String, default: "" },
    notes:    { type: String, default: "" },
    images:   { type: [String], default: [] },         // compressed data URLs
    files:    { type: [{ url: String, name: String, type: { type: String }, size: Number, _id: false }], default: [] }, // MOM and other documents
    momTxt:   { type: String, default: "" },
    sentWa:   { type: String, default: "" },
    sentMail: { type: String, default: "" },
    // the client, for the invite and minutes emails
    clientEmail: { type: String, default: "" },
    clientPhone: { type: String, default: "" },
    link:     { type: String, default: "" },
    // every time the minutes were sent: WhatsApp or email, to whom
    sendLog:  { type: [{ via: String, to: String, at: Date, _id: false }], default: [] },
  },
  { timestamps: true, collection: "portal_meetings" }
);
PortalMeetingSchema.index({ account: 1, date: -1 });

/* "I'm blocked" flags */
const PortalBlockerSchema = new mongoose.Schema(
  {
    account:  { type: ObjectId, ref: "PortalAccount", required: true },
    date:     { type: String, required: true },
    refName:  { type: String, default: "" },
    text:     { type: String, required: true, trim: true },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "portal_blockers" }
);

/* A submitted day (locks that day's entries) */
const PortalDaySchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: "PortalAccount", required: true },
    date:    { type: String, required: true },
    at:      { type: String, default: "" },
    note:    { type: String, default: "" },
    plan:    { type: String, default: "" },
  },
  { timestamps: true, collection: "portal_days" }
);
PortalDaySchema.index({ account: 1, date: 1 }, { unique: true });

/* Plans for the day: what the employee means to get done, ticked off as they go (the admin sees it in the CRM) */
const PortalPlanSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: "PortalAccount", required: true },
    date:    { type: String, required: true },         // "YYYY-MM-DD" (India time)
    items:   { type: [{ text: { type: String, required: true, trim: true }, refName: { type: String, default: "" }, done: { type: Boolean, default: false }, doneAt: { type: Date, default: null }, at: { type: Date, default: Date.now } }], default: [] },
  },
  { timestamps: true, collection: "portal_plans" }
);
PortalPlanSchema.index({ account: 1, date: 1 }, { unique: true });
PortalPlanSchema.index({ date: -1 });

/* Check in and check out times for one employee and day; several sessions if they step out */
const PortalAttendanceSchema = new mongoose.Schema(
  {
    account:  { type: ObjectId, ref: "PortalAccount", required: true },
    date:     { type: String, required: true },         // "YYYY-MM-DD" (employee's day)
    sessions: [{ in: { type: Date, required: true }, out: { type: Date, default: null }, _id: false }],
  },
  { timestamps: true, collection: "portal_attendance" }
);
PortalAttendanceSchema.index({ account: 1, date: 1 }, { unique: true });
PortalAttendanceSchema.index({ date: -1 });

/* Bell notifications for one employee (task assigned, bug raised or fixed, admin message…) */
const PortalNotificationSchema = new mongoose.Schema(
  {
    account: { type: ObjectId, ref: "PortalAccount", required: true },
    kind:    { type: String, default: "info" },  // task | bug | bug_fixed | bug_verified | bug_reopened | message
    title:   { type: String, required: true, trim: true },
    text:    { type: String, default: "" },
    link:    { type: String, default: "" },      // portal path to open
    from:    { type: String, default: "" },
    read:    { type: Boolean, default: false },
  },
  { timestamps: true, collection: "portal_notifications" }
);
PortalNotificationSchema.index({ account: 1, createdAt: -1 });

/* Chat between the CRM admin and one employee (one thread per employee) */
const PortalMessageSchema = new mongoose.Schema(
  {
    account:   { type: ObjectId, ref: "PortalAccount", required: true }, // whose thread
    from:      { type: String, enum: ["admin", "emp"], required: true },
    by:        { type: String, default: "" },
    text:      { type: String, required: true, trim: true },
    refName:   { type: String, default: "" },   // optional project or client it is about
    readEmp:   { type: Boolean, default: false },
    readAdmin: { type: Boolean, default: false },
    seenAt:    { type: Date, default: null },     // when the other side read it
  },
  { timestamps: true, collection: "portal_messages" }
);
PortalMessageSchema.index({ account: 1, createdAt: -1 });

/* Team chat: group channels ("all", "dev", "seo") and direct messages ("dm:<accountId>:<accountId>") */
const TeamMessageSchema = new mongoose.Schema(
  {
    channel: { type: String, required: true },
    who:     { type: String, required: true },   // "emp:<accountId>" or "admin:<crm user id>"
    name:    { type: String, default: "" },
    role:    { type: String, default: "" },      // portal role, or "admin"
    text:    { type: String, required: true, trim: true },
  },
  { timestamps: true, collection: "portal_team_messages" }
);
TeamMessageSchema.index({ channel: 1, createdAt: -1 });

/* When each person last read each channel (for unread counts) */
const TeamReadSchema = new mongoose.Schema(
  {
    who:     { type: String, required: true },
    channel: { type: String, required: true },
    at:      { type: Date, default: Date.now },
  },
  { collection: "portal_team_reads" }
);
TeamReadSchema.index({ who: 1, channel: 1 }, { unique: true });

/* Portal sign-up rules */
const PortalSettingSchema = new mongoose.Schema(
  {
    key:        { type: String, default: "default", unique: true },
    approval:   { type: Boolean, default: true },
    domainOnly: { type: Boolean, default: false },
    showSecrets: { type: Boolean, default: true }, // assigned developers can reveal integration passwords
    domain:     { type: String, default: "nakshatranamahacreations.com" },
  },
  { timestamps: true, collection: "portal_settings" }
);

/* Documents an employee sends to a colleague (a tester to a developer), with a message and replies */
const DocFile = { url: String, name: String, type: { type: String }, size: Number, _id: false };
const PortalDocSchema = new mongoose.Schema(
  {
    from:     { type: ObjectId, ref: "PortalAccount", required: true },
    fromName: { type: String, default: "" },
    to:       { type: ObjectId, ref: "PortalAccount", required: true },
    toName:   { type: String, default: "" },
    refName:  { type: String, default: "" },
    title:    { type: String, required: true, trim: true },
    text:     { type: String, default: "" },
    files:    { type: [DocFile], default: [] },
    seenAt:   { type: Date, default: null },
    done:     { type: Boolean, default: false },
    replies:  { type: [{ by: ObjectId, name: String, text: String, files: { type: [DocFile], default: [] }, at: Date, _id: false }], default: [] },
  },
  { timestamps: true, collection: "portal_docs" }
);
PortalDocSchema.index({ to: 1, createdAt: -1 });
PortalDocSchema.index({ from: 1, createdAt: -1 });

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
export const PortalAccount = model("PortalAccount", PortalAccountSchema);
export const PortalWork    = model("PortalWork", PortalWorkSchema);
export const PortalTask    = model("PortalTask", PortalTaskSchema);
export const PortalMeeting = model("PortalMeeting", PortalMeetingSchema);
export const PortalDoc     = model("PortalDoc", PortalDocSchema);
export const PortalBlocker = model("PortalBlocker", PortalBlockerSchema);
export const PortalDay     = model("PortalDay", PortalDaySchema);
export const PortalAttendance = model("PortalAttendance", PortalAttendanceSchema);
export const PortalPlan    = model("PortalPlan", PortalPlanSchema);
export const PortalSetting = model("PortalSetting", PortalSettingSchema);
export const PortalNotification = model("PortalNotification", PortalNotificationSchema);
export const PortalMessage = model("PortalMessage", PortalMessageSchema);
export const TeamMessage = model("TeamMessage", TeamMessageSchema);
export const TeamRead = model("TeamRead", TeamReadSchema);

// Add a bell notification; never fails the request that caused it
// Every role an employee has: the main role first, then the extra ones
export const rolesOf = (a) => [...new Set([a?.role, ...(a?.roles || [])].filter(r => PORTAL_ROLES.includes(r)))];
export const hasRole = (a, list) => rolesOf(a).some(r => list.includes(r));

export async function notify(account, n) {
  try { if (account) await PortalNotification.create({ account, ...n }); }
  catch (err) { console.error("portal notify error:", err.message); }
}

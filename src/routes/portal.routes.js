import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import { protectPortal } from "../middleware/portalAuth.js";
import * as P from "../controllers/portal.controller.js";
import * as A from "../controllers/portalAdmin.controller.js";
import * as PP from "../controllers/portalProject.controller.js";
import * as C from "../controllers/portalComms.controller.js";
import { empTeam, adminTeam } from "../controllers/teamChat.controller.js";

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again after 15 minutes." },
});
const revealLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many password views. Please try again after 15 minutes." },
});

/* public */
router.get("/settings", P.publicSettings);
router.post("/signup", authLimiter, P.signup);
router.post("/login", authLimiter, P.login);

/* admin — signed in with the CRM admin login */
const adminView = [protect, requireModule("employee-portal", "view")];
const adminEdit = [protect, requireModule("employee-portal", "edit")];
router.get("/admin/accounts", adminView, A.listAccounts);
router.post("/admin/accounts", adminEdit, A.createAccount);
router.put("/admin/accounts/:id/projects", adminEdit, A.updateProjects);
router.put("/admin/accounts/:id", adminEdit, A.updateAccount);
router.post("/admin/accounts/:id/reset", adminEdit, A.resetPassword);
router.put("/admin/accounts/:id/password", adminEdit, A.setPassword);
router.delete("/admin/accounts/:id", adminEdit, A.deleteAccount);
router.get("/admin/accounts/:id/projects", adminView, A.accountProjects);
router.get("/admin/work", adminView, A.teamWork);
router.put("/admin/blockers/:id/resolve", adminEdit, A.resolveBlocker);
router.get("/admin/meetings", adminView, A.allMeetings);
router.get("/admin/tasks", adminView, A.listTasks);
router.post("/admin/tasks", adminEdit, A.assignTask);
router.get("/admin/threads", adminView, C.adminThreads);
router.get("/admin/messages/:account", adminView, C.adminMessages);
router.post("/admin/messages/:account", adminEdit, C.adminSend);
router.post("/admin/announce", adminEdit, C.adminAnnounce);
router.get("/admin/team/channels", adminView, adminTeam.channels);
router.get("/admin/team/messages", adminView, adminTeam.messages);
router.post("/admin/team/messages", adminEdit, adminTeam.send);
router.get("/admin/settings", adminView, A.getSettings);
router.put("/admin/settings", adminEdit, A.saveSettings);

/* employee — signed in with a portal login */
router.use(protectPortal);
router.get("/me", P.getMe);
router.put("/me", P.updateMe);
router.put("/me/password", P.changePassword);
router.get("/assigned", P.assigned);

router.get("/work", P.listWork);
router.post("/work", P.addWork);
router.delete("/work/:id", P.deleteWork);
router.get("/bugs", P.myBugs);
router.get("/bugs/activity", P.bugActivity);
router.get("/developers", P.developersList);
router.patch("/bugs/:id", P.bugAction);
router.patch("/designs/:id", P.designStatus);

router.get("/tasks", P.listTasks);
router.post("/tasks", P.addTask);
router.patch("/tasks/:id", P.taskStatus);
router.get("/blockers", P.listBlockers);
router.post("/blockers", P.addBlocker);
router.patch("/blockers/:id/resolve", P.resolveBlocker);
router.post("/days", P.submitDay);

router.get("/calendar", C.calendar);
router.get("/notifications", C.listNotifications);
router.put("/notifications/read", C.readNotifications);
router.get("/team/channels", empTeam.channels);
router.get("/team/messages", empTeam.messages);
router.post("/team/messages", empTeam.send);
router.get("/messages", C.myMessages);
router.post("/messages", C.sendMyMessage);
router.get("/projects", PP.listProjects);
router.get("/projects/:id", PP.projectDetail);
router.post("/projects/:id/integrations/:iid/secrets/:sid/reveal", revealLimiter, PP.revealProjectSecret);
router.get("/meetings", P.listMeetings);
router.post("/meetings", P.saveMeeting);
router.put("/meetings/:id", P.saveMeeting);
router.post("/meetings/:id/sent", C.meetingSent);
router.delete("/meetings/:id", P.deleteMeeting);

router.get("/keywords", P.clientKeywords);
router.post("/ranks", P.saveRanks);
router.get("/ads", P.clientAds);
router.post("/ads", P.saveAds);
router.put("/ads/:id/sent", P.adsSent);

export default router;

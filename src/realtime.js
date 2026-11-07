import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { portalSecret } from "./middleware/portalAuth.js";
import mongoose from "mongoose";
import { PortalAccount, rolesOf } from "./models/Portal.js";

// Live updates for chat. The socket only carries a short "something changed here" signal,
// never the message itself: the screen then loads it through the normal API, which checks who may read it.
// If the socket cannot connect, the screens keep checking every few seconds as before.

const DEV = ["app", "web", "back", "full", "ux", "test", "other"];
const SEO = ["seo", "seox", "ads", "gfx"];
let io = null;

export function initRealtime(server, origin) {
  io = new Server(server, { cors: { origin, credentials: true }, path: "/socket.io" });
  io.use(async (socket, next) => {
    const token = String(socket.handshake.auth?.token || "");
    try {
      const d = jwt.verify(token, portalSecret());
      if (d.kind !== "portal") throw new Error("not portal");
      const acc = await PortalAccount.findById(d.id).select("name role roles status").lean();
      if (!acc || acc.status !== "active") return next(new Error("not active"));
      const R = rolesOf(acc);
      socket.data.me = { admin: false, id: String(d.id), who: `emp:${d.id}`, name: acc.name };
      socket.data.rooms = [`emp:${d.id}`, "team:all", ...(R.some(r => DEV.includes(r)) ? ["team:dev"] : []), ...(R.some(r => SEO.includes(r)) ? ["team:seo"] : [])];
      return next();
    } catch { /* not a portal login, try the CRM login */ }
    try {
      if (!process.env.JWT_SECRET) throw new Error("no secret");
      const u = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.me = { admin: true, id: "", who: `admin:${u.id}`, name: "Admin" };
      socket.data.rooms = ["admins", "team:all", "team:dev", "team:seo"];
      return next();
    } catch { return next(new Error("Please sign in")); }
  });
  io.on("connection", (socket) => {
    socket.join(socket.data.rooms);
    socket.on("typing", (p) => typing(socket, p));
  });
  return io;
}

// "X is typing…": passed on only to the people in that chat, at most a few times a second
function typing(socket, p) {
  const me = socket.data.me;
  if (!me || !p || typeof p !== "object") return;
  const now = Date.now();
  if (now - (socket.data.lastTyping || 0) < 800) return;
  socket.data.lastTyping = now;
  const name = String(me.admin ? (p.name || "Admin") : me.name).slice(0, 60);
  if (p.chat === "pm") {
    if (me.admin) {
      if (!mongoose.Types.ObjectId.isValid(String(p.account))) return;
      socket.to(`emp:${p.account}`).emit("typing", { chat: "pm", account: String(p.account), from: "admin", name });
    } else socket.to("admins").emit("typing", { chat: "pm", account: me.id, from: "emp", name });
    return;
  }
  if (p.chat === "team") {
    const ch = String(p.channel || "");
    if (ch.startsWith("dm:")) {
      const ids = ch.split(":").slice(1);
      if (me.admin || ids.length !== 2 || !ids.includes(me.id)) return;
      socket.to(`emp:${ids.find(x => x !== me.id)}`).emit("typing", { chat: "team", channel: ch, who: me.who, name });
    } else if (socket.data.rooms.includes(`team:${ch}`)) {
      socket.to(`team:${ch}`).emit("typing", { chat: "team", channel: ch, who: me.who, name });
    }
  }
}

// Employee ↔ admin chat changed for this employee
export function pingPortalChat(account) {
  if (!io) return;
  io.to(`emp:${account}`).to("admins").emit("pm", { account: String(account) });
}

// Team chat: a new message in a channel ("all", "dev", "seo" or "dm:<id>:<id>")
export function pingTeam(channel) {
  if (!io) return;
  const rooms = channel.startsWith("dm:") ? channel.split(":").slice(1).map(id => `emp:${id}`) : [`team:${channel}`];
  io.to(rooms).emit("team", { channel });
}

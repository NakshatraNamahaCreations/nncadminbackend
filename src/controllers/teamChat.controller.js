import { PortalAccount, TeamMessage, TeamRead, rolesOf } from "../models/Portal.js";
import { pingTeam } from "../realtime.js";

// Team chat for everyone: employees (portal login) and the admin (CRM login).
// Group channels: "all" (everyone), "dev" (development, design, testing), "seo" (SEO, Ads, graphics).
// Direct messages between two employees: "dm:<smallerId>:<largerId>".

const DEV = ["app", "web", "back", "full", "ux", "test", "other"];
const SEO = ["seo", "seox", "ads", "gfx"];
const GROUPS = { all: "Everyone", dev: "Development and design", seo: "Digital Marketing" };
const str = (v) => String(v ?? "").trim();

function fail(res, err, where) {
  console.error(`team chat ${where} error:`, err);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

// Who is calling: an employee or a CRM admin
export const empActor = (req) => ({ who: `emp:${req.portal._id}`, id: String(req.portal._id), name: req.portal.name, role: req.portal.role, roles: rolesOf(req.portal), admin: false });
export const adminActor = (req) => ({ who: `admin:${req.user?.id}`, id: "", name: req.actorName || "Admin", role: "admin", admin: true });

const dmId = (a, b) => `dm:${[String(a), String(b)].sort().join(":")}`;
function canUse(me, ch) {
  if (ch === "all") return true;
  if (ch === "dev") return me.admin || (me.roles || [me.role]).some(r => DEV.includes(r));
  if (ch === "seo") return me.admin || (me.roles || [me.role]).some(r => SEO.includes(r));
  if (ch.startsWith("dm:")) return !me.admin && ch.split(":").slice(1).includes(me.id);
  return false;
}

async function channelsFor(me) {
  const groups = Object.keys(GROUPS).filter(g => canUse(me, g)).map(g => ({ id: g, kind: "group", name: GROUPS[g] }));
  let dms = [];
  if (!me.admin) {
    const people = await PortalAccount.find({ status: "active", _id: { $ne: me.id } }).select("name role").sort({ name: 1 }).lean();
    dms = people.map(p => ({ id: dmId(me.id, p._id), kind: "dm", name: p.name, role: p.role }));
  }
  const all = [...groups, ...dms], ids = all.map(c => c.id);
  const [reads, last] = await Promise.all([
    TeamRead.find({ who: me.who, channel: { $in: ids } }).lean(),
    TeamMessage.aggregate([{ $match: { channel: { $in: ids } } }, { $sort: { createdAt: -1 } }, { $group: { _id: "$channel", text: { $first: "$text" }, name: { $first: "$name" }, who: { $first: "$who" }, at: { $first: "$createdAt" } } }]),
  ]);
  const withMsgs = new Set(last.map(l => l._id));
  const counts = await Promise.all(all.map(c => {
    if (!withMsgs.has(c.id)) return 0;
    const r = reads.find(x => x.channel === c.id);
    return TeamMessage.countDocuments({ channel: c.id, who: { $ne: me.who }, ...(r ? { createdAt: { $gt: r.at } } : {}) });
  }));
  return all.map((c, i) => {
    const l = last.find(x => x._id === c.id);
    return { ...c, unread: counts[i], last: l ? { text: l.text, name: l.who === me.who ? "You" : l.name, at: l.at } : null };
  });
}

const handlers = (actor) => ({
  // GET …/team/channels
  async channels(req, res) {
    try {
      const L = await channelsFor(actor(req));
      return res.json({ success: true, data: L, unread: L.reduce((a, c) => a + c.unread, 0) });
    } catch (err) { return fail(res, err, "channels"); }
  },
  // GET …/team/messages?channel=
  async messages(req, res) {
    try {
      const me = actor(req), ch = str(req.query.channel);
      if (!canUse(me, ch)) return res.status(403).json({ success: false, message: "You cannot open this chat" });
      const [L, others] = await Promise.all([
        TeamMessage.find({ channel: ch }).sort({ createdAt: -1 }).limit(150).lean(),
        TeamRead.find({ channel: ch, who: { $ne: me.who } }).select("who at").lean(),
      ]);
      const prev = await TeamRead.findOneAndUpdate({ who: me.who, channel: ch }, { $set: { at: new Date() } }, { upsert: true, new: false }).lean();
      // I just read messages from others that were new to me: their screens show "seen" straight away
      const lastOther = L.find(m => m.who !== me.who);
      if (lastOther && (!prev || new Date(prev.at) < new Date(lastOther.createdAt))) pingTeam(ch);
      // only people who can read this chat count (a direct message has just the other person)
      const data = L.reverse().map(m => {
        if (m.who !== me.who) return { ...m, mine: false };
        const seenBy = others.filter(r => new Date(r.at) >= new Date(m.createdAt)).length;
        return { ...m, mine: true, seenBy };
      });
      return res.json({ success: true, data });
    } catch (err) { return fail(res, err, "messages"); }
  },
  // POST …/team/messages { channel, text }
  async send(req, res) {
    try {
      const me = actor(req), ch = str(req.body?.channel), text = str(req.body?.text).slice(0, 4000);
      if (!canUse(me, ch)) return res.status(403).json({ success: false, message: "You cannot post in this chat" });
      if (!text) return res.status(400).json({ success: false, message: "Type a message" });
      if (ch.startsWith("dm:")) {
        const other = ch.split(":").slice(1).find(x => x !== me.id);
        if (!(await PortalAccount.exists({ _id: other, status: "active" }))) return res.status(404).json({ success: false, message: "This person is not active" });
      }
      const m = await TeamMessage.create({ channel: ch, who: me.who, name: me.name, role: me.role, text });
      pingTeam(ch);
      await TeamRead.updateOne({ who: me.who, channel: ch }, { $set: { at: new Date() } }, { upsert: true });
      return res.status(201).json({ success: true, data: { ...m.toObject(), mine: true } });
    } catch (err) { return fail(res, err, "send"); }
  },
});

export const empTeam = handlers(empActor);
export const adminTeam = handlers(adminActor);

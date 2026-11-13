/**
 * Auto check out: anyone still checked in at 10 pm (India time) on their day
 * is checked out at 10 pm, and the CRM attendance is updated the same way as a normal check out.
 * Runs every 15 minutes, so a missed run (server restart) is caught up.
 */
import cron from "node-cron";
import { PortalAttendance, PortalAccount } from "../models/Portal.js";
import { syncFromPortal } from "../controllers/attendance.controller.js";

const CUTOFF_UTC_MIN = 22 * 60 - 330;   // 10:00 pm IST = 4:30 pm UTC
// Days before this were left as they are (closing them now would change past attendance)
const FROM_DAY = "2026-11-13";

// 10 pm India time on a "YYYY-MM-DD" day
function cutoffOf(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, CUTOFF_UTC_MIN));
}

export async function runAutoCheckout() {
  const now = new Date();
  const L = await PortalAttendance.find({ "sessions.out": null, date: { $gte: [FROM_DAY, new Date(now - 45 * 864e5).toISOString().slice(0, 10)].sort().pop() } });
  let n = 0;
  for (const a of L) {
    const cut = cutoffOf(a.date);
    if (now < cut) continue;                       // their day is not over yet
    let changed = false;
    for (const s of a.sessions) {
      if (s.out) continue;
      s.out = new Date(Math.max(cut.getTime(), new Date(s.in).getTime()));
      s.auto = true;
      changed = true;
    }
    if (!changed) continue;
    a.markModified("sessions");
    await a.save();
    n++;
    try {
      const acc = await PortalAccount.findById(a.account);
      if (acc) await syncFromPortal(acc, a.date, a.sessions);
    } catch (e) { console.error("[AutoCheckout] attendance sync:", e.message); }
  }
  if (n) console.log(`[AutoCheckout] checked out ${n} employee day(s) at 10 pm`);
  return n;
}

export function initAutoCheckout() {
  cron.schedule("*/15 * * * *", () => { runAutoCheckout().catch(e => console.error("[AutoCheckout]", e.message)); });
  runAutoCheckout().catch(e => console.error("[AutoCheckout]", e.message));
}

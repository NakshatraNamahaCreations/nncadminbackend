/**
 * Report Scheduler
 * Fires bi-weekly: 1st and 16th of every month at 8:00 AM IST
 */
import cron from "node-cron";
import { sendBIReport } from "./biReportService.js";

const REPORT_EMAIL = "nn.creations7@gmail.com";

export function initReportScheduler() {
  // 0 8 1,16 * *  →  8:00 AM on the 1st and 16th of every month
  cron.schedule("0 8 1,16 * *", async () => {
    console.log(`[Scheduler] BI Report triggered at ${new Date().toISOString()}`);
    try {
      const result = await sendBIReport(REPORT_EMAIL);
      console.log(`[Scheduler] BI Report sent — ${result.period}`);
    } catch (err) {
      console.error("[Scheduler] BI Report FAILED:", err.message);
    }
  }, {
    timezone: "Asia/Kolkata",
  });

  console.log("[Scheduler] BI Report scheduler initialized — fires on 1st and 16th at 8:00 AM IST");
}

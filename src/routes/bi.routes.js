import express from "express";
import {
  getBIDashboard,
  getConfig, setConfig,
  getFunds, addFundTransaction, deleteFundTransaction,
} from "../controllers/bi.controller.js";
import { getIntelligence } from "../controllers/intelligence.controller.js";
import { sendBIReport } from "../services/biReportService.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/dashboard",                    getBIDashboard);
router.get("/intelligence",                 getIntelligence);
router.get("/config",                       getConfig);
router.post("/config",                      setConfig);
router.get("/funds",                        getFunds);
router.post("/funds/transaction",           addFundTransaction);
router.delete("/funds/transaction/:id",     deleteFundTransaction);

// Manual trigger — POST /api/bi/report/send?to=email@example.com
router.post("/report/send", async (req, res) => {
  try {
    const to = req.query.to || (req.body && req.body.to) || process.env.ADMIN_NOTIFY_EMAIL || "nn.creations7@gmail.com";
    const result = await sendBIReport(to);
    return res.json({ success:true, message:`Report sent to ${to}`, ...result });
  } catch (err) {
    console.error("Manual report send error:", err);
    return res.status(500).json({ success:false, message:err.message });
  }
});

export default router;

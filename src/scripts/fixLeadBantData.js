import mongoose from "mongoose";
import dotenv from "dotenv";
import Lead from "../src/models/Lead.js";

dotenv.config();

const clean = (v) => {
  try {
    if (v == null) return "";
    if (typeof v === "object") return String(v.text || "").trim();
    return String(v).trim();
  } catch {
    return "";
  }
};

const toNum = (v, def = 0) => {
  try {
    if (v == null || v === "") return def;
    if (typeof v === "string" && v.includes("/")) {
      const first = Number(v.split("/")[0]);
      return Number.isFinite(first) ? first : def;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  } catch {
    return def;
  }
};

const calcBantScore = (b = {}) => {
  let s = 0;
  if (toNum(b.budgetMin, 0) > 0 || toNum(b.budgetMax, 0) > 0) s += 1;
  if (clean(b.authorityName)) s += 1;
  if (clean(b.need)) s += 1;
  if (clean(b.timeline)) s += 1;
  return s;
};

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Mongo connected");

    const leads = await Lead.find({});
    console.log(`Found ${leads.length} leads`);

    for (const lead of leads) {
      const bd = lead.bantDetails || {};

      const normalized = {
        budgetMin: toNum(bd.budgetMin, 0),
        budgetMax: toNum(bd.budgetMax, 0),
        authorityName: clean(bd.authorityName),
        authorityRole: clean(bd.authorityRole),
        need: clean(bd.need),
        timeline: clean(bd.timeline),
        score: 0,
      };

      normalized.score = calcBantScore(normalized);

      lead.bantDetails = normalized;
      lead.bant = `${normalized.score}/4`;

      await lead.save();
      console.log(`Fixed lead: ${lead.name}`);
    }

    console.log("All leads fixed");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
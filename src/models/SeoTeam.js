import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

export const SEO_ROLES = ["seo", "ads", "design"]; // SEO analyst, Google Ads expert, Designer
export const SEO_WORK_TYPES = ["backlink", "blog", "gmb", "poster", "other"];

/* Team members of the SEO and Ads team */
const SeoMemberSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    role:     { type: String, enum: SEO_ROLES, default: "seo" },
    roles:    { type: [{ type: String, enum: SEO_ROLES }], default: [] },   // everything this person does (seo, ads, design)
    phone:    { type: String, default: "", trim: true },
    email:    { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "seo_team" }
);

/* A client the team works for — usually linked to a CRM lead */
const SeoClientSchema = new mongoose.Schema(
  {
    lead:     { type: ObjectId, ref: "Lead", default: null },
    name:     { type: String, required: true, trim: true },
    contact:  { type: String, default: "", trim: true },
    phone:    { type: String, default: "", trim: true },
    email:    { type: String, default: "", trim: true },
    site:     { type: String, default: "", trim: true },
    start:    { type: Date, required: true },               // day 1 of the engagement
    seo:      { type: ObjectId, ref: "SeoMember", default: null },
    ads:      { type: ObjectId, ref: "SeoMember", default: null },
    design:   { type: ObjectId, ref: "SeoMember", default: null },
    // everyone working on this client; seo, ads and design above are filled from it for reports
    members:  { type: [{ type: ObjectId, ref: "SeoMember" }], default: [] },
    budget:   { type: Number, default: 0, min: 0 },          // Google Ads budget per month
    metaBudget: { type: Number, default: 0, min: 0 },        // Meta (Facebook / Instagram) Ads budget per month
    targets: {
      backlink: { type: Number, default: 40 },
      blog:     { type: Number, default: 4 },
      gmb:      { type: Number, default: 12 },
      poster:   { type: Number, default: 6 },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "seo_clients" }
);

/* One piece of work: a backlink, blog, GMB post, poster or other task */
const SeoWorkSchema = new mongoose.Schema(
  {
    client:   { type: ObjectId, ref: "SeoClient", required: true },
    who:      { type: ObjectId, ref: "SeoMember", default: null },
    date:     { type: Date, required: true },
    type:     { type: String, enum: SEO_WORK_TYPES, required: true },
    url:      { type: String, default: "", trim: true },
    title:    { type: String, default: "", trim: true },
    kw:       { type: String, default: "", trim: true },
    da:       { type: Number, default: null },
    platform: { type: String, default: "", trim: true },
    status:   { type: String, enum: ["live", "pending"], default: "live" },
    by:       { type: String, default: "" },
  },
  { timestamps: true, collection: "seo_work" }
);
SeoWorkSchema.index({ client: 1, date: -1 });
SeoWorkSchema.index({ date: -1 });

/* Google Ads daily report (one per client per day) */
const TermSchema = new mongoose.Schema(
  { t: String, clicks: Number, impr: Number, cost: Number, conv: Number },
  { _id: false }
);
const SeoAdsDaySchema = new mongoose.Schema(
  {
    client: { type: ObjectId, ref: "SeoClient", required: true },
    who:    { type: ObjectId, ref: "SeoMember", default: null },
    date:   { type: Date, required: true },
    spend:  { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    impr:   { type: Number, default: 0 },
    conv:   { type: Number, default: 0 },
    terms:  { type: [TermSchema], default: [] },
    negs:   { type: [String], default: [] },
    notes:  { type: String, default: "" },
    sent:   { type: Boolean, default: false },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "seo_ads_days" }
);
SeoAdsDaySchema.index({ client: 1, date: 1 }, { unique: true });

/* An agreed keyword and its Google position history */
const RankPointSchema = new mongoose.Schema(
  { date: Date, pos: { type: Number, default: null }, url: { type: String, default: "" } },
  { _id: false }
);
const SeoKeywordSchema = new mongoose.Schema(
  {
    client:  { type: ObjectId, ref: "SeoClient", required: true },
    keyword: { type: String, required: true, trim: true },
    added:   { type: Date, default: Date.now },
    hist:    { type: [RankPointSchema], default: [] },
  },
  { timestamps: true, collection: "seo_keywords" }
);
SeoKeywordSchema.index({ client: 1, keyword: 1 }, { unique: true });

/* Report branding */
const SeoSettingSchema = new mongoose.Schema(
  { key: { type: String, default: "default", unique: true }, logo: { type: String, default: "" } },
  { timestamps: true, collection: "seo_settings" }
);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
export const SeoMember  = model("SeoMember", SeoMemberSchema);
export const SeoClient  = model("SeoClient", SeoClientSchema);
export const SeoWork    = model("SeoWork", SeoWorkSchema);
export const SeoAdsDay  = model("SeoAdsDay", SeoAdsDaySchema);
export const SeoKeyword = model("SeoKeyword", SeoKeywordSchema);
export const SeoSetting = model("SeoSetting", SeoSettingSchema);

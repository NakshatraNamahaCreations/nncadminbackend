import mongoose from "mongoose";
import crypto from "crypto";

const ALGO = "aes-256-cbc";
const KEY  = crypto.scryptSync(
  process.env.JWT_SECRET || "nnc_crm_fallback_key_32chars!!!!",
  "nnc_vault_salt",
  32
);

export const encrypt = (text) => {
  if (!text) return "";
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + enc.toString("hex");
};

export const decrypt = (data) => {
  if (!data || !data.includes(":")) return data || "";
  try {
    const [ivHex, encHex] = data.split(":");
    const iv      = Buffer.from(ivHex, "hex");
    const enc     = Buffer.from(encHex, "hex");
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
};

const CredentialSchema = new mongoose.Schema(
  {
    label:    { type: String, required: true, trim: true },       // e.g. "GitHub - NNC Org"
    category: {
      type: String,
      enum: ["GitHub", "Database", "Email", "Server", "Client", "API Key", "Domain/Hosting", "Social Media", "Other"],
      default: "Other",
    },
    username: { type: String, default: "", trim: true },          // stored plain (not secret)
    password: { type: String, default: "" },                      // AES-256 encrypted
    url:      { type: String, default: "", trim: true },
    notes:    { type: String, default: "", trim: true },
    tags:     { type: [String], default: [] },
    pinned:   { type: Boolean, default: false },
    addedBy:  { type: String, default: "Owner" },
  },
  { timestamps: true }
);

CredentialSchema.index({ category: 1, createdAt: -1 });
CredentialSchema.index({ pinned: -1, createdAt: -1 });
CredentialSchema.index(
  { label: "text", username: "text", tags: "text", notes: "text" },
  { name: "credential_text_search" }
);

const Credential = mongoose.models.Credential || mongoose.model("Credential", CredentialSchema);
export default Credential;

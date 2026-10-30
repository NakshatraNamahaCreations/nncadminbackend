import crypto from "crypto";

/*
 * Encryption for project integration secrets (API keys, passwords).
 *
 * Uses its OWN key (INTEGRATION_ENC_KEY), independent of JWT_SECRET, so
 * rotating the login secret never makes stored secrets unreadable.
 * AES-256-GCM also detects tampering (decrypt fails instead of returning junk).
 *
 * Stored format: "v1:<iv hex>:<auth tag hex>:<ciphertext hex>"
 */
const ALGO = "aes-256-gcm";

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw || raw.length < 32) {
    const err = new Error("INTEGRATION_ENC_KEY is not set (needs 32+ characters) — cannot store secrets");
    err.status = 500;
    throw err;
  }
  cachedKey = crypto.scryptSync(raw, "nnc_integrations_v1", 32);
  return cachedKey;
}

export function encryptSecret(plain) {
  if (plain == null || plain === "") return "";
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc    = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (!stored) return "";
  const [ver, ivHex, tagHex, encHex] = String(stored).split(":");
  if (ver !== "v1" || !ivHex || !tagHex || encHex == null) {
    throw new Error("Unrecognised secret format");
  }
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
}

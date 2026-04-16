import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PROOF_DIR   = path.join(__dirname, "../../uploads/payment-proofs");
const INVOICE_DIR = path.join(__dirname, "../../uploads/payment-invoices");
fs.mkdirSync(PROOF_DIR,   { recursive: true });
fs.mkdirSync(INVOICE_DIR, { recursive: true });

const makeStorage = (dir) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename:    (req, file, cb) => {
    const ext    = path.extname(file.originalname || "").toLowerCase() || ".bin";
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ext}`);
  },
});

const imageFilter = (req, file, cb) => {
  if (file.mimetype?.startsWith("image/") || file.mimetype === "application/pdf")
    cb(null, true);
  else cb(new Error("Only images and PDF allowed"), false);
};

const docFilter = (req, file, cb) => {
  const ok = file.mimetype?.startsWith("image/") || file.mimetype === "application/pdf";
  ok ? cb(null, true) : cb(new Error("Only image or PDF allowed"), false);
};

export const proofUpload   = multer({ storage: makeStorage(PROOF_DIR),   fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
export const invoiceUpload = multer({ storage: makeStorage(INVOICE_DIR), fileFilter: docFilter,   limits: { fileSize: 20 * 1024 * 1024 } });

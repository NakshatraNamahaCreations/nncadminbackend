import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, "../../uploads/leads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      cb(null, UPLOAD_DIR);
    } catch (error) {
      cb(error, UPLOAD_DIR);
    }
  },
  filename: (req, file, cb) => {
    try {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${ext}`);
    } catch (error) {
      cb(error, "");
    }
  },
});

const fileFilter = (req, file, cb) => {
  try {
    const allowed =
      file.mimetype?.startsWith("image/") ||
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/msword" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed";

    if (!allowed) {
      return cb(new Error("Only image/pdf/doc/docx/xls/xlsx/zip allowed"), false);
    }

    cb(null, true);
  } catch (error) {
    cb(error, false);
  }
};

export const leadUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});
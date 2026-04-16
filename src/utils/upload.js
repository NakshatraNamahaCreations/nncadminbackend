import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, "../../uploads/docs");

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (error) {
  console.error("UPLOAD_DIR create error:", error);
}

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
      const baseName = path
        .basename(file.originalname || "file", ext)
        .replace(/[^a-zA-Z0-9-_]/g, "_");

      cb(null, `${Date.now()}-${baseName}${ext}`);
    } catch (error) {
      cb(error, "file.bin");
    }
  },
});

const fileFilter = (req, file, cb) => {
  try {
    const allowedMimeTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "application/x-zip-compressed",
    ];

    const isAllowed =
      file.mimetype?.startsWith("image/") || allowedMimeTypes.includes(file.mimetype);

    if (!isAllowed) {
      return cb(new Error("File type not allowed"), false);
    }

    cb(null, true);
  } catch (error) {
    cb(error, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});

export default upload;
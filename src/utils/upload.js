import multer from "multer";
import fs from "fs";
import path from "path";

const uploadDir = path.join(process.cwd(), "uploads");

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (error) {
  console.error("upload dir creation error:", error);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      cb(null, uploadDir);
    } catch (error) {
      cb(error, uploadDir);
    }
  },
  filename: function (req, file, cb) {
    try {
      const ext = path.extname(file.originalname);
      const baseName = path
        .basename(file.originalname, ext)
        .replace(/[^a-zA-Z0-9-_]/g, "_");

      cb(null, `${Date.now()}-${baseName}${ext}`);
    } catch (error) {
      cb(error, file.originalname);
    }
  },
});

const allowedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
];

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    try {
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Unsupported file type"));
      }
    } catch (error) {
      cb(error, false);
    }
  },
});

export default upload;
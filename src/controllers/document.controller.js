import fs from "fs";
import path from "path";
import Document from "../models/Document.js";

export const uploadDocument = async (req, res) => {
  try {
    const { type, linkedLead, date, name, notes } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Document type is required",
      });
    }

    if (!linkedLead) {
      return res.status(400).json({
        success: false,
        message: "Linked lead is required",
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Document date is required",
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Document name is required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const newDocument = await Document.create({
      type,
      linkedLead,
      date: new Date(date),
      name: name.trim(),
      notes: notes?.trim() || "",
      originalFileName: req.file.originalname,
      storedFileName: req.file.filename,
      fileUrl: `/uploads/${req.file.filename}`,
      fileSize: req.file.size || 0,
      mimeType: req.file.mimetype || "",
    });

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully",
      data: newDocument,
    });
  } catch (error) {
    console.error("uploadDocument error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to upload document",
    });
  }
};

export const getAllDocuments = async (req, res) => {
  try {
    const { type, search } = req.query;

    const query = {};

    if (type && type !== "all") {
      query.type = type;
    }

    if (search && search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: "i" } },
        { linkedLead: { $regex: search.trim(), $options: "i" } },
        { notes: { $regex: search.trim(), $options: "i" } },
        { originalFileName: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const documents = await Document.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: documents.length,
      data: documents,
    });
  } catch (error) {
    console.error("getAllDocuments error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch documents",
    });
  }
};

export const getDocumentStats = async (req, res) => {
  try {
    const documents = await Document.find();

    const stats = {
      invoices: 0,
      quotations: 0,
      moms: 0,
      clientInputs: 0,
      totalStorage: 0,
      totalDocuments: documents.length,
    };

    for (const doc of documents) {
      try {
        stats.totalStorage += Number(doc.fileSize || 0);

        if (doc.type === "invoice") stats.invoices += 1;
        if (doc.type === "quotation") stats.quotations += 1;
        if (doc.type === "mom") stats.moms += 1;
        if (doc.type === "client_input") stats.clientInputs += 1;
      } catch (innerError) {
        console.error("stats loop error:", innerError);
      }
    }

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("getDocumentStats error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch document stats",
    });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const existingDocument = await Document.findById(id);

    if (!existingDocument) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    try {
      const fullFilePath = path.join(
        process.cwd(),
        existingDocument.fileUrl.replace(/^\/+/, "")
      );

      if (fs.existsSync(fullFilePath)) {
        fs.unlinkSync(fullFilePath);
      }
    } catch (fileError) {
      console.error("file delete error:", fileError);
    }

    await Document.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Document deleted successfully",
    });
  } catch (error) {
    console.error("deleteDocument error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete document",
    });
  }
};
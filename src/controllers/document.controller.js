import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Document from "../models/Document.js";
import Lead from "../models/Lead.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const uploadDocument = async (req, res) => {
  try {
    const { type, linkedLead, date, name, notes } = req.body;

    if (!type || !type.trim())
      return res.status(400).json({ success: false, message: "Document type is required" });
    if (!linkedLead || !linkedLead.trim())
      return res.status(400).json({ success: false, message: "Linked lead is required" });
    if (!date)
      return res.status(400).json({ success: false, message: "Document date is required" });
    if (!name || !name.trim())
      return res.status(400).json({ success: false, message: "Document name is required" });
    if (!req.file)
      return res.status(400).json({ success: false, message: "File is required" });

    const newDocument = await Document.create({
      type: type.trim(),
      linkedLead: linkedLead.trim(),
      date: new Date(date),
      name: name.trim(),
      notes: notes?.trim() || "",
      originalFileName: req.file.originalname || "",
      storedFileName: req.file.filename || "",
      fileUrl: `/uploads/docs/${req.file.filename}`,
      fileSize: req.file.size || 0,
      mimeType: req.file.mimetype || "",
    });

    return res.status(201).json({ success: true, message: "Document uploaded successfully", data: newDocument });
  } catch (error) {
    console.error("uploadDocument error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to upload document" });
  }
};

export const getAllDocuments = async (req, res) => {
  try {
    const { type, search, page = 1, limit = 200 } = req.query;
    const query = {};

    if (type && type !== "all") query.type = type;

    if (search && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      query.$or = [
        { name:             { $regex: safeSearch, $options: "i" } },
        { linkedLead:       { $regex: safeSearch, $options: "i" } },
        { notes:            { $regex: safeSearch, $options: "i" } },
        { originalFileName: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const safePage  = Math.max(1, Number(page)  || 1);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const skip = (safePage - 1) * safeLimit;
    const [documents, total] = await Promise.all([
      Document.find(query)
        .select("type linkedLead date name notes originalFileName storedFileName fileUrl fileSize mimeType createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Document.countDocuments(query),
    ]);

    return res.status(200).json({ success: true, count: documents.length, total, data: documents });
  } catch (error) {
    console.error("getAllDocuments error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch documents" });
  }
};

export const getDocumentStats = async (req, res) => {
  try {
    /* Single aggregation instead of loading all documents */
    const [agg] = await Document.aggregate([
      {
        $group: {
          _id: null,
          total:        { $sum: 1 },
          totalStorage: { $sum: "$fileSize" },
          invoices:     { $sum: { $cond: [{ $eq: ["$type", "invoice"] },       1, 0] } },
          quotations:   { $sum: { $cond: [{ $eq: ["$type", "quotation"] },     1, 0] } },
          moms:         { $sum: { $cond: [{ $eq: ["$type", "mom"] },           1, 0] } },
          clientInputs: { $sum: { $cond: [{ $eq: ["$type", "client_input"] },  1, 0] } },
        },
      },
    ]);

    const stats = agg
      ? { invoices: agg.invoices, quotations: agg.quotations, moms: agg.moms,
          clientInputs: agg.clientInputs, totalStorage: agg.totalStorage, totalDocuments: agg.total }
      : { invoices: 0, quotations: 0, moms: 0, clientInputs: 0, totalStorage: 0, totalDocuments: 0 };

    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error("getDocumentStats error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to fetch document stats" });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }
    const existingDocument = await Document.findById(id).select("fileUrl").lean();

    if (!existingDocument)
      return res.status(404).json({ success: false, message: "Document not found" });

    /* Async file deletion — does not block the event loop */
    if (existingDocument.fileUrl) {
      try {
        const relativePath = existingDocument.fileUrl.replace(/^\/+/, "");
        const fullFilePath = path.join(process.cwd(), relativePath);
        await fs.promises.unlink(fullFilePath).catch(() => {});
      } catch (fileError) {
        console.error("file delete error:", fileError);
      }
    }

    await Document.findByIdAndDelete(id);

    // Also remove from lead's documents array if linked
    if (existingDocument.leadId) {
      Lead.findById(existingDocument.leadId).then(lead => {
        if (!lead) return;
        const storedName = existingDocument.storedFileName || "";
        const fileUrl    = existingDocument.fileUrl || "";
        const before = lead.documents.length;
        lead.documents = lead.documents.filter(d =>
          d.fileName !== storedName &&
          (d.url || d.fileUrl) !== fileUrl
        );
        if (lead.documents.length !== before) lead.save().catch(() => {});
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: "Document deleted successfully" });
  } catch (error) {
    console.error("deleteDocument error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to delete document" });
  }
};

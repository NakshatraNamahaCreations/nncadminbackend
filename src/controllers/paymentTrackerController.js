import mongoose from "mongoose";
import PaymentClient from "../models/PaymentClient.js";
import PaymentRecord from "../models/PaymentRecord.js";
import Invoice from "../models/Invoice.js";
import BankAccount from "../models/BankAccount.js";
import Lead from "../models/Lead.js";

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const safeNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const getClientStatus = (received, totalValue, currentStatus) => {
  try {
    const total = safeNumber(totalValue);
    const rec = safeNumber(received);

    if (currentStatus === "Declined" || currentStatus === "Not Finalised") {
      return currentStatus;
    }

    if (total > 0 && rec >= total) return "Paid";
    if (rec > 0 && rec < total) return "Partial";
    return "Pending";
  } catch (error) {
    console.error("getClientStatus error:", error);
    return "Pending";
  }
};

export const getClients = async (req, res) => {
  try {
    const clients = await PaymentClient.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: clients,
    });
  } catch (error) {
    console.error("getClients error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch clients",
    });
  }
};

export const createClient = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.client?.trim()) {
      return res.status(400).json({ success: false, message: "Client name is required" });
    }

    payload.totalValue = safeNumber(payload.totalValue);
    payload.received = safeNumber(payload.received);
    payload.status = getClientStatus(
      payload.received,
      payload.totalValue,
      payload.status
    );

    const client = await PaymentClient.create(payload);

    return res.status(201).json({
      success: true,
      message: "Client created successfully",
      data: client,
    });
  } catch (error) {
    console.error("createClient error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create client",
    });
  }
};

export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid client id" });
    }

    const payload = { ...req.body };

    payload.totalValue = safeNumber(payload.totalValue);
    payload.received = safeNumber(payload.received);
    payload.status = getClientStatus(
      payload.received,
      payload.totalValue,
      payload.status
    );

    const client = await PaymentClient.findByIdAndUpdate(id, payload, {
      new: true,
      runValidators: true,
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Client updated successfully",
      data: client,
    });
  } catch (error) {
    console.error("updateClient error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update client",
    });
  }
};

export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid client id" });
    }

    const client = await PaymentClient.findByIdAndDelete(id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    await PaymentRecord.deleteMany({ clientId: id });

    return res.status(200).json({
      success: true,
      message: "Client and related payments deleted successfully",
    });
  } catch (error) {
    console.error("deleteClient error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete client",
    });
  }
};

export const getPayments = async (req, res) => {
  try {
    const filter = {};
    if (req.query.account && isValidObjectId(req.query.account)) filter.account = req.query.account;
    if (req.query.clientId && isValidObjectId(req.query.clientId)) filter.clientId = req.query.clientId;
    const payments = await PaymentRecord.find(filter)
      .populate("account", "name bankName accountNumber")
      .sort({ date: -1, createdAt: -1 });

    return res.status(200).json({ success: true, data: payments });
  } catch (error) {
    console.error("getPayments error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch payments" });
  }
};

export const createPayment = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (!payload.clientId || !isValidObjectId(payload.clientId)) {
      return res.status(400).json({ success: false, message: "Valid client id is required" });
    }

    const client = await PaymentClient.findById(payload.clientId);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const amount = safeNumber(payload.amount);
    const tdsAmt = payload.tds ? safeNumber(payload.tdsAmt) : 0;

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    if (tdsAmt > amount) {
      return res.status(400).json({
        success: false,
        message: "TDS amount cannot exceed amount",
      });
    }

    const outstanding =
      safeNumber(client.totalValue) - safeNumber(client.received);

    if (amount > outstanding && outstanding > 0) {
      return res.status(400).json({
        success: false,
        message: `Payment exceeds outstanding balance of ₹${outstanding.toLocaleString(
          "en-IN"
        )}`,
      });
    }

    payload.amount = amount;
    payload.tdsAmt = tdsAmt;
    payload.netAmount = amount - tdsAmt;
    payload.client = client.client;
    payload.project = payload.project || client.project || "";
    payload.tdsStatus = payload.tds ? "Pending" : "N/A";

    const payment = await PaymentRecord.create(payload);

    client.received = safeNumber(client.received) + amount;
    client.lastFollowUp = payload.date;
    client.status = getClientStatus(
      client.received,
      client.totalValue,
      client.status
    );

    await client.save();

    return res.status(201).json({
      success: true,
      message: "Payment added successfully",
      data: {
        payment,
        client,
      },
    });
  } catch (error) {
    console.error("createPayment error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create payment",
    });
  }
};

/* ─── GET /api/payment-tracker/invoice-payments ─── */
export const getInvoicePayments = async (req, res) => {
  try {
    const { type, status, from, to, search } = req.query;

    const q = {};
    if (type && type !== "all") q.type = type;
    if (status && status !== "all") q.status = status;
    if (from || to) {
      q.invoiceDate = {};
      if (from) q.invoiceDate.$gte = new Date(from);
      if (to)   q.invoiceDate.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      q.$or = [
        { clientName:     { $regex: safe, $options: "i" } },
        { clientBusiness: { $regex: safe, $options: "i" } },
        { invoiceNumber:  { $regex: safe, $options: "i" } },
      ];
    }

    const invoices = await Invoice.find(q)
      .sort({ invoiceDate: -1 })
      .select("invoiceNumber type status clientName clientBusiness officeLocation invoiceDate dueDate validUntil totalAmount finalizedAmount quotedAmount proformaId proformaNumber createdAt")
      .lean();

    const data = invoices.map(inv => ({
      _id:             inv._id,
      invoiceNumber:   inv.invoiceNumber,
      type:            inv.type,
      status:          inv.status,
      clientName:      inv.clientName,
      clientBusiness:  inv.clientBusiness,
      officeLocation:  inv.officeLocation,
      invoiceDate:     inv.invoiceDate,
      dueDate:         inv.dueDate || inv.validUntil || null,
      totalAmount:     inv.type === "tax" ? inv.finalizedAmount || inv.totalAmount : inv.quotedAmount || inv.totalAmount,
      proformaId:      inv.proformaId || null,
      proformaNumber:  inv.proformaNumber || null,
      createdAt:       inv.createdAt,
    }));

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getInvoicePayments error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch invoice payments" });
  }
};
/* ─── GET /api/payment-tracker/clients/:id/history ─── */
/* id can be a PaymentClient _id OR a Lead _id */
export const getClientHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    // 1. Try PaymentClient first
    let client = await PaymentClient.findById(id).lean();
    let payments = [];

    if (client) {
      // Found by PaymentClient ID — fetch its payments
      payments = await PaymentRecord.find({ clientId: id }).sort({ date: -1 })
        .populate("invoiceId", "invoiceNumber type status totalAmount finalizedAmount invoiceDate")
        .populate("account", "name bankName accountNumber").lean();
    } else {
      // 2. Try as a Lead ID — build a virtual client from lead data
      const lead = await Lead.findById(id).lean();
      if (!lead) return res.status(404).json({ success: false, message: "Client not found" });

      client = {
        _id: lead._id,
        client: lead.name || lead.clientName || "—",
        project: lead.business || lead.project || "",
        city: lead.city || lead.branch || "",
        totalValue: lead.value || 0,
        received: lead.advanceReceived || 0,
        status: lead.stage || "",
      };

      // Find PaymentRecords by client name (from payment tracker records created via handlePaySave)
      const nameRegex = new RegExp((client.client).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      payments = await PaymentRecord.find({ client: nameRegex }).sort({ date: -1 })
        .populate("invoiceId", "invoiceNumber type status totalAmount finalizedAmount invoiceDate")
        .populate("account", "name bankName accountNumber").lean();
    }

    // Find linked invoices from Invoice model by client name
    const clientName = client.client || "";
    const invoices = clientName ? await Invoice.find({
      clientName: { $regex: new RegExp(clientName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
    }).select("invoiceNumber type status totalAmount finalizedAmount quotedAmount invoiceDate dueDate proformaId proformaNumber").sort({ invoiceDate: -1 }).lean() : [];

    return res.status(200).json({ success: true, client, payments, invoices });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── POST /api/payment-tracker/payments/:id/upload-proof ─── */
export const uploadPaymentProof = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid payment id" });
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const payment = await PaymentRecord.findByIdAndUpdate(id, { paymentProof: req.file.filename }, { new: true }).lean();
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.status(200).json({ success: true, data: payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── POST /api/payment-tracker/payments/:id/upload-invoice ─── */
export const uploadPaymentInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid payment id" });
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const payment = await PaymentRecord.findByIdAndUpdate(id, { uploadedInvoicePath: req.file.filename }, { new: true }).lean();
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    return res.status(200).json({ success: true, data: payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── PATCH /api/payment-tracker/payments/:id ─── */
export const updatePayment = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const { transactionId, remarks, invoiceId } = req.body;
    const updates = {};
    if (transactionId !== undefined) updates.transactionId = transactionId;
    if (remarks      !== undefined) updates.remarks = remarks;
    if (invoiceId    !== undefined) updates.invoiceId = isValidObjectId(invoiceId) ? invoiceId : null;
    const payment = await PaymentRecord.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
    if (!payment) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── Bank Account CRUD ─── */
export const getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find({ isActive: true }).sort({ createdAt: 1 });
    return res.status(200).json({ success: true, data: accounts });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const createBankAccount = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: "Account name is required" });
    const acc = await BankAccount.create(req.body);
    return res.status(201).json({ success: true, data: acc });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const updateBankAccount = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    const acc = await BankAccount.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!acc) return res.status(404).json({ success: false, message: "Not found" });
    return res.status(200).json({ success: true, data: acc });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const deleteBankAccount = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    await BankAccount.findByIdAndUpdate(req.params.id, { isActive: false });
    return res.status(200).json({ success: true, message: "Deleted" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

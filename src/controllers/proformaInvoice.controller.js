import ProformaInvoice from "../models/ProformaInvoice.js";
import sendEmail       from "../utils/sendEmail.js";

// GET /api/proforma-invoices
export async function getProformaInvoices(req, res) {
  try {
    const { branch, status, q, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (branch) filter.branch = branch;
    if (status) filter.status = status;
    if (q?.trim()) {
      filter.$or = [
        { clientName:    new RegExp(q.trim(), "i") },
        { clientPhone:   new RegExp(q.trim(), "i") },
        { clientCompany: new RegExp(q.trim(), "i") },
        { proformaNumber: new RegExp(q.trim(), "i") },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await ProformaInvoice.countDocuments(filter);
    const data  = await ProformaInvoice.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    return res.json({ success: true, data, total });
  } catch (err) {
    console.error("getProformaInvoices error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}

// GET /api/proforma-invoices/:id
export async function getProformaById(req, res) {
  try {
    const pi = await ProformaInvoice.findById(req.params.id).lean();
    if (!pi) return res.status(404).json({ success: false, message: "Proforma invoice not found" });
    return res.json({ success: true, data: pi });
  } catch (err) {
    console.error("getProformaById error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}

// PUT /api/proforma-invoices/:id
export async function updateProforma(req, res) {
  try {
    const pi = await ProformaInvoice.findById(req.params.id);
    if (!pi) return res.status(404).json({ success: false, message: "Proforma invoice not found" });

    const allowed = ["deliveryDate", "paymentTerms", "notes", "terms", "status"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) pi[key] = req.body[key];
    }
    if (req.body.status === "sent" && !pi.sentAt) pi.sentAt = new Date();
    if (req.body.status === "paid" && !pi.paidAt) pi.paidAt = new Date();

    await pi.save();
    return res.json({ success: true, data: pi });
  } catch (err) {
    console.error("updateProforma error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}

// DELETE /api/proforma-invoices/:id
export async function deleteProforma(req, res) {
  try {
    const pi = await ProformaInvoice.findById(req.params.id);
    if (!pi) return res.status(404).json({ success: false, message: "Proforma invoice not found" });
    await ProformaInvoice.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Proforma invoice deleted" });
  } catch (err) {
    console.error("deleteProforma error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}

// POST /api/proforma-invoices/:id/send
export async function sendProformaEmail(req, res) {
  try {
    const pi = await ProformaInvoice.findById(req.params.id).lean();
    if (!pi) return res.status(404).json({ success: false, message: "Proforma invoice not found" });
    if (!pi.clientEmail) return res.status(400).json({ success: false, message: "Client email is not set" });

    const itemRows = (pi.lineItems || [])
      .map((item, i) => `
        <tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"}">
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#374151">${item.description}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#374151;text-align:center">${item.qty}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#374151;text-align:right">₹${Number(item.rate || 0).toLocaleString("en-IN")}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#0f172a;text-align:right">₹${Number(item.amount || 0).toLocaleString("en-IN")}</td>
        </tr>`)
      .join("");

    const gstLine = pi.tax > 0
      ? `<tr><td style="padding:6px 14px;font-size:13px;color:#64748b;text-align:right">GST (${pi.tax}%)</td><td style="padding:6px 14px;font-size:13px;text-align:right;width:130px">₹${(((pi.subtotal - pi.discount) * pi.tax) / 100).toLocaleString("en-IN")}</td></tr>`
      : "";
    const discountLine = pi.discount > 0
      ? `<tr><td style="padding:6px 14px;font-size:13px;color:#16a34a;text-align:right">Discount</td><td style="padding:6px 14px;font-size:13px;color:#16a34a;text-align:right">− ₹${Number(pi.discount).toLocaleString("en-IN")}</td></tr>`
      : "";

    const html = `
<div style="font-family:Arial,sans-serif;max-width:660px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#0f172a,#065f46);padding:28px 32px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <div style="font-size:22px;font-weight:900;color:#fff">NNC</div>
          <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">Nakshatra Namaha Creations</div>
        </td>
        <td style="text-align:right">
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:1.5px">Proforma Invoice</div>
          <div style="font-size:20px;font-weight:900;color:#34d399;font-family:monospace;margin-top:3px">${pi.proformaNumber}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:2px">Ref: ${pi.quoteNumber}</div>
        </td>
      </tr>
    </table>
  </div>

  <div style="background:#f8fafc;padding:20px 32px;border-bottom:1px solid #e2e8f0">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align:top;width:55%">
          <div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Bill To</div>
          <div style="font-size:15px;font-weight:700;color:#0f172a">${pi.clientName}</div>
          ${pi.clientCompany ? `<div style="font-size:13px;color:#475569;margin-top:2px">${pi.clientCompany}</div>` : ""}
          ${pi.clientAddress ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${pi.clientAddress}</div>` : ""}
          ${pi.clientPhone   ? `<div style="font-size:12px;color:#64748b;margin-top:4px">📞 ${pi.clientPhone}</div>` : ""}
          ${pi.clientGstin   ? `<div style="font-size:12px;color:#64748b;margin-top:4px">GSTIN: ${pi.clientGstin}</div>` : ""}
        </td>
        <td style="vertical-align:top;text-align:right">
          <div style="font-size:12px;color:#64748b;margin-bottom:4px">Date: <strong style="color:#0f172a">${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</strong></div>
          ${pi.deliveryDate ? `<div style="font-size:12px;color:#64748b;margin-bottom:4px">Delivery: <strong style="color:#0f172a">${new Date(pi.deliveryDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</strong></div>` : ""}
          ${pi.paymentTerms ? `<div style="font-size:12px;color:#64748b">Payment: <strong style="color:#0f172a">${pi.paymentTerms}</strong></div>` : ""}
        </td>
      </tr>
    </table>
  </div>

  <div style="padding:0 32px 24px">
    <table style="width:100%;border-collapse:collapse;margin-top:20px">
      <thead>
        <tr style="background:#0f172a">
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px">Description</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px;width:60px">Qty</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px;width:110px">Rate</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.5px;width:120px">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <table style="width:100%;margin-top:4px;border-top:2px solid #e2e8f0">
      <tr><td style="padding:6px 14px;font-size:13px;color:#64748b;text-align:right">Subtotal</td><td style="padding:6px 14px;font-size:13px;text-align:right;width:130px">₹${Number(pi.subtotal || 0).toLocaleString("en-IN")}</td></tr>
      ${discountLine}
      ${gstLine}
      <tr style="background:#f1f5f9">
        <td style="padding:12px 14px;font-size:16px;font-weight:900;color:#0f172a;text-align:right">Total</td>
        <td style="padding:12px 14px;font-size:16px;font-weight:900;color:#059669;text-align:right">₹${Number(pi.total || 0).toLocaleString("en-IN")}</td>
      </tr>
    </table>
  </div>

  ${pi.notes ? `<div style="margin:0 32px 16px;background:#f8fafc;border-radius:8px;padding:14px 16px;font-size:13px;color:#475569;border-left:3px solid #059669"><strong>Notes:</strong><br/>${pi.notes.replace(/\n/g, "<br/>")}</div>` : ""}
  ${pi.terms ? `<div style="margin:0 32px 24px;background:#fefce8;border-radius:8px;padding:14px 16px;font-size:12px;color:#713f12;border-left:3px solid #eab308"><strong>Terms & Conditions:</strong><br/>${pi.terms.replace(/\n/g, "<br/>")}</div>` : ""}

  <div style="background:#0f172a;padding:20px 32px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <div style="font-size:12px;color:rgba(255,255,255,.5)">NNC Nakshatra Namaha Creations Pvt. Ltd.</div>
          <div style="font-size:12px;color:#34d399;margin-top:4px">+91 99005 66466</div>
        </td>
        <td style="text-align:right">
          <div style="font-size:11px;color:rgba(255,255,255,.35)">nakshatranamahacreations.com</div>
          <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px">GSTIN: 29AABCN1234F1Z5</div>
        </td>
      </tr>
    </table>
  </div>
</div>`;

    let emailSent = true;
    let emailError = null;
    try {
      await sendEmail({ to: pi.clientEmail, subject: `Proforma Invoice ${pi.proformaNumber} from NNC — ${pi.clientName}`, html });
    } catch (mailErr) {
      emailSent = false;
      emailError = mailErr.message;
    }

    await ProformaInvoice.findByIdAndUpdate(pi._id, { status: "sent", sentAt: new Date() });

    if (!emailSent) {
      return res.json({ success: true, emailSent: false, message: `Marked as Sent, but email failed: ${emailError}` });
    }
    return res.json({ success: true, emailSent: true, message: "Proforma invoice emailed successfully" });
  } catch (err) {
    console.error("sendProformaEmail error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
}

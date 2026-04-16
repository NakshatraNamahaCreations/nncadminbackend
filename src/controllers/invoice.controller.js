import Invoice from "../models/Invoice.js";
import InvoiceConfig from "../models/InvoiceConfig.js";

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ─── Amount in words ─────────────────────────────────────── */
const ONES = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
  "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

function numToWords(n) {
  n = Math.floor(Number(n) || 0);
  if (n === 0) return "Zero Rupees Only";
  const two   = x => x < 20 ? ONES[x] : TENS[Math.floor(x/10)]+(x%10 ? " "+ONES[x%10] : "");
  const three = x => x >= 100 ? ONES[Math.floor(x/100)]+" Hundred"+(x%100 ? " "+two(x%100) : "") : two(x);
  const cr = Math.floor(n/10000000), lk = Math.floor((n%10000000)/100000);
  const th = Math.floor((n%100000)/1000), rest = n%1000;
  let r = "";
  if (cr)   r += two(cr)+" Crore ";
  if (lk)   r += two(lk)+" Lakh ";
  if (th)   r += two(th)+" Thousand ";
  if (rest) r += three(rest)+" ";
  return r.trim()+" Rupees Only";
}

/* ─── Invoice number generator (race-condition safe) ──────── */
const MAX_RETRY = 5;

function buildInvoicePrefix(type, cfg) {
  const prefix  = type === "proforma" ? (cfg.proformaPrefix || "NNC/PRF") : (cfg.taxPrefix || "NNC/TAX");
  const padding = cfg.paddingLength || 4;
  const inclFY  = cfg.includeFiscalYear !== false;

  /* Escape regex special chars in prefix */
  const escaped = prefix.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

  let fullPrefix, regexStr;
  if (inclFY) {
    const now = new Date();
    const fy  = now.getMonth() >= 3
      ? `${String(now.getFullYear()).slice(-2)}${String(now.getFullYear()+1).slice(-2)}`
      : `${String(now.getFullYear()-1).slice(-2)}${String(now.getFullYear()).slice(-2)}`;
    fullPrefix = `${prefix}/${fy}/`;
    regexStr   = `^${escaped}\\/${fy}\\/`;
  } else {
    fullPrefix = `${prefix}/`;
    regexStr   = `^${escaped}\\/`;
  }

  return { fullPrefix, regexStr, padding };
}

async function nextInvoiceNumber(type) {
  const cfg = await InvoiceConfig.findOne().lean() || {};
  const { fullPrefix, regexStr, padding } = buildInvoicePrefix(type, cfg);

  const latest = await Invoice.findOne(
    { invoiceNumber: { $regex: regexStr } },
    "invoiceNumber",
    { sort: { invoiceNumber: -1 } }
  );
  const seq = latest ? parseInt(latest.invoiceNumber.split("/").pop(), 10) + 1 : 1;
  return fullPrefix + String(seq).padStart(padding, "0");
}

/**
 * Saves a pre-built Invoice document with retry on duplicate invoiceNumber.
 * On each retry it regenerates the invoice number so concurrent requests
 * never collide permanently.
 */
async function saveWithRetry(doc, type) {
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      if (attempt > 0) {
        doc.invoiceNumber = await nextInvoiceNumber(type);
      }
      await doc.save();
      return doc;
    } catch (err) {
      const isDupe = err.code === 11000 && err.keyPattern && err.keyPattern.invoiceNumber;
      if (!isDupe || attempt >= MAX_RETRY - 1) throw err;
      /* duplicate key on invoiceNumber – retry with a fresh number */
    }
  }
}

/* ─── GET /api/invoices/config ───────────────────────────── */
export async function getInvoiceConfig(req, res) {
  try {
    const cfg = await InvoiceConfig.findOne().lean()
      || { proformaPrefix: "NNC/PRF", taxPrefix: "NNC/TAX", paddingLength: 4, includeFiscalYear: true };
    return res.json({ success: true, data: cfg });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── PUT /api/invoices/config ───────────────────────────── */
export async function updateInvoiceConfig(req, res) {
  try {
    const { proformaPrefix, taxPrefix, paddingLength, includeFiscalYear } = req.body;
    let cfg = await InvoiceConfig.findOne();
    if (!cfg) cfg = new InvoiceConfig();
    if (proformaPrefix    !== undefined) cfg.proformaPrefix    = String(proformaPrefix).trim();
    if (taxPrefix         !== undefined) cfg.taxPrefix         = String(taxPrefix).trim();
    if (paddingLength     !== undefined) cfg.paddingLength     = Math.max(1, Math.min(8, Number(paddingLength)));
    if (includeFiscalYear !== undefined) cfg.includeFiscalYear = Boolean(includeFiscalYear);
    await cfg.save();
    return res.json({ success: true, data: cfg });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── Compute totals from form data ───────────────────────── */
function computeTotals(data) {
  const items        = data.items || [];
  const subtotal     = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const discountAmt  = data.discountPct > 0
    ? Math.round(subtotal * Number(data.discountPct) / 100)
    : (Number(data.discountAmt) || 0);
  const taxableAmount = Math.max(0, subtotal - discountAmt);
  const igstPct = Number(data.igstPct) || 0;
  const cgstPct = igstPct > 0 ? 0 : (Number(data.cgstPct) ?? 9);
  const sgstPct = igstPct > 0 ? 0 : (Number(data.sgstPct) ?? 9);
  const cgstAmt = Math.round(taxableAmount * cgstPct / 100);
  const sgstAmt = Math.round(taxableAmount * sgstPct / 100);
  const igstAmt = Math.round(taxableAmount * igstPct / 100);
  const totalAmount = taxableAmount + cgstAmt + sgstAmt + igstAmt;
  return { subtotal, discountAmt, taxableAmount, cgstPct, cgstAmt, sgstPct, sgstAmt, igstPct, igstAmt, totalAmount, amountInWords: numToWords(totalAmount) };
}

/* ─── GET /api/invoices ──────────────────────────────────── */
export async function getInvoices(req, res) {
  try {
    const { type, status, officeLocation, search, from, to, page = 1, limit = 100 } = req.query;
    const q = {};
    if (type)           q.type = type;
    if (status)         q.status = status;
    if (officeLocation) q.officeLocation = officeLocation;
    if (search) {
      const safeSearch = escapeRegex(search);
      q.$or = [
        { clientName:     { $regex: safeSearch, $options: "i" } },
        { clientBusiness: { $regex: safeSearch, $options: "i" } },
        { invoiceNumber:  { $regex: safeSearch, $options: "i" } },
      ];
    }
    if (from || to) {
      q.invoiceDate = {};
      if (from) q.invoiceDate.$gte = new Date(from);
      if (to)   q.invoiceDate.$lte = new Date(new Date(to).setHours(23,59,59,999));
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [invoices, total] = await Promise.all([
      Invoice.find(q).sort({ invoiceDate: -1 }).skip(skip).limit(Number(limit)).lean(),
      Invoice.countDocuments(q),
    ]);

    /* Attach linked tax invoice info to each proforma */
    const pfIds = invoices.filter(i => i.type === "proforma").map(i => i._id);
    const linked = pfIds.length
      ? await Invoice.find({ proformaId: { $in: pfIds } }, "proformaId invoiceNumber totalAmount finalizedAmount status").lean()
      : [];
    const taxMap = {};
    linked.forEach(t => { taxMap[String(t.proformaId)] = t; });

    const data = invoices.map(inv => ({
      ...inv,
      linkedTaxInvoice: inv.type === "proforma" ? (taxMap[String(inv._id)] || null) : null,
    }));

    return res.json({ success: true, data, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error("getInvoices:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── GET /api/invoices/:id ──────────────────────────────── */
export async function getInvoice(req, res) {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.json({ success: true, data: inv });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── POST /api/invoices ─────────────────────────────────── */
export async function createInvoice(req, res) {
  try {
    const data   = req.body;
    const number = await nextInvoiceNumber(data.type);
    const totals = computeTotals(data);
    const doc = new Invoice({
      ...data,
      ...totals,
      invoiceNumber:   number,
      quotedAmount:    data.type === "proforma" ? totals.totalAmount : (Number(data.quotedAmount) || totals.totalAmount),
      finalizedAmount: data.type === "tax"      ? totals.totalAmount : 0,
    });
    await saveWithRetry(doc, data.type);
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("createInvoice:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── PUT /api/invoices/:id ──────────────────────────────── */
export async function updateInvoice(req, res) {
  try {
    const data   = req.body;
    const totals = computeTotals(data);
    const updated = await Invoice.findByIdAndUpdate(
      req.params.id,
      { ...data, ...totals },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: "Invoice not found" });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── DELETE /api/invoices/:id ───────────────────────────── */
export async function deleteInvoice(req, res) {
  try {
    await Invoice.findByIdAndUpdate(req.params.id, { status: "cancelled" });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── POST /api/invoices/:id/convert (proforma → tax) ────── */
export async function convertToTax(req, res) {
  try {
    const proforma = await Invoice.findById(req.params.id);
    if (!proforma)                 return res.status(404).json({ success: false, message: "Proforma not found" });
    if (proforma.type !== "proforma") return res.status(400).json({ success: false, message: "Not a proforma invoice" });
    if (proforma.status === "converted") return res.status(400).json({ success: false, message: "Already converted" });

    /* Merge proforma base with any overrides from request body */
    const base = proforma.toObject();
    delete base._id; delete base.__v; delete base.createdAt; delete base.updatedAt;
    const data = { ...base, ...req.body, type: "tax", proformaId: proforma._id, proformaNumber: proforma.invoiceNumber };

    const number = await nextInvoiceNumber("tax");
    const totals = computeTotals(data);
    const taxInv = new Invoice({
      ...data,
      ...totals,
      invoiceNumber:   number,
      quotedAmount:    proforma.totalAmount,
      finalizedAmount: totals.totalAmount,
    });
    await saveWithRetry(taxInv, "tax");
    await Invoice.findByIdAndUpdate(proforma._id, { status: "converted" });
    return res.status(201).json({ success: true, data: taxInv });
  } catch (err) {
    console.error("convertToTax:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ─── PATCH /api/invoices/:id/status ─────────────────────── */
export async function updateStatus(req, res) {
  try {
    const updated = await Invoice.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/* ── GSTIN Lookup Controller ──────────────────────────────────── */

const STATE_CODES = {
  "01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab",
  "04":"Chandigarh","05":"Uttarakhand","06":"Haryana","07":"Delhi",
  "08":"Rajasthan","09":"Uttar Pradesh","10":"Bihar","11":"Sikkim",
  "12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur","15":"Mizoram",
  "16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal",
  "20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh",
  "24":"Gujarat","25":"Daman & Diu","26":"Dadra & Nagar Haveli",
  "27":"Maharashtra","28":"Andhra Pradesh (old)","29":"Karnataka","30":"Goa",
  "31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu","34":"Puducherry",
  "35":"Andaman & Nicobar Islands","36":"Telangana","37":"Andhra Pradesh",
  "38":"Ladakh",
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/* Helper: parse taxpayer address from GST portal response format */
function parseAddr(pradr) {
  if (!pradr) return { address: "", city: "", pincode: "" };
  const a = pradr.addr || pradr;
  const address = [a.bno, a.bnm, a.st, a.flno].filter(Boolean).join(", ");
  const city    = a.loc || a.dst || a.city || "";
  const pincode = a.pncd || a.pin || "";
  return { address, city, pincode };
}

export async function gstLookup(req, res) {
  try {
    const gstin = (req.params.gstin || "").trim().toUpperCase();

    if (!GSTIN_REGEX.test(gstin)) {
      return res.status(400).json({ success: false, message: "Invalid GSTIN format" });
    }

    const stateCode = gstin.slice(0, 2);
    const pan       = gstin.slice(2, 12);
    const stateName = STATE_CODES[stateCode] || "";

    let companyName = "";
    let tradeName   = "";
    let address     = "";
    let city        = "";
    let pincode     = "";
    let status      = "";

    /* ── Try gstincheck.co.in (free tier, no key required) ──── */
    try {
      const r = await fetch(
        `https://api.gstincheck.co.in/check/free/${gstin}`,
        {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; NNCCRM/1.0)",
          },
          signal: AbortSignal.timeout(6000),
        }
      );
      const raw = await r.json();
      const d = raw?.data || raw;
      if (d?.lgnm || d?.tradeNam) {
        companyName = d.lgnm     || d.tradeName || d.tradeNam || "";
        tradeName   = d.tradeNam || d.tradeName  || "";
        status      = d.sts      || "";
        const p     = parseAddr(d.pradr);
        address     = p.address;
        city        = p.city;
        pincode     = p.pincode;
      }
    } catch { /* silent */ }

    /* ── If no company name yet, try apisetu.gov.in sandbox (no key) ── */
    if (!companyName) {
      try {
        const r = await fetch(
          `https://api.sandbox.co.in/gsp/authenticate?$filter=gstin eq ${gstin}`,
          {
            headers: { "Accept": "application/json", "x-api-key": "key_live_free_test" },
            signal: AbortSignal.timeout(5000),
          }
        );
        const raw = await r.json();
        const d = raw?.data || raw;
        if (d?.lgnm) {
          companyName = d.lgnm || "";
          tradeName   = d.tradeNam || "";
          status      = d.sts || "";
          const p     = parseAddr(d.pradr);
          address     = p.address;
          city        = p.city;
          pincode     = p.pincode;
        }
      } catch { /* silent */ }
    }

    /* ── If env has GST_API_KEY, use authenticated gstincheck ── */
    const apiKey = process.env.GST_API_KEY;
    if (!companyName && apiKey) {
      try {
        const r = await fetch(
          `https://api.gstincheck.co.in/check/${apiKey}/${gstin}`,
          { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(6000) }
        );
        const raw = await r.json();
        const d = raw?.data || raw;
        if (d?.lgnm || d?.tradeNam) {
          companyName = d.lgnm     || d.tradeName || d.tradeNam || "";
          tradeName   = d.tradeNam || d.tradeName  || "";
          status      = d.sts      || "";
          const p     = parseAddr(d.pradr);
          address     = p.address;
          city        = p.city;
          pincode     = p.pincode;
        }
      } catch { /* silent */ }
    }

    return res.json({
      success: true,
      gstin,
      pan,
      state:       stateName,
      stateCode,
      companyName,
      tradeName,
      address,
      city,
      pincode,
      status,
      apiNote: !companyName
        ? "Full company details require GST_API_KEY in backend .env (get a free key from gstincheck.co.in)"
        : undefined,
    });
  } catch (error) {
    console.error("gstLookup error:", error);
    return res.status(500).json({ success: false, message: "GST lookup failed" });
  }
}

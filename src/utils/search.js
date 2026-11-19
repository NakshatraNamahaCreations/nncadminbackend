// One search rule for every list: each word typed must match one of the fields, in any order.
// Spaces, dots and dashes inside a value are ignored, so "rentangadi" finds "Rent Angadi"
// and "9845012345" finds "+91 98450-12345".
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GAP = "[\\s.\\-_/()+]*";

export function searchRegexes(q) {
  return String(q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8)
    .map(w => w.slice(0, 40))
    .map(w => new RegExp([...w].map(esc).join(GAP), "i"));
}

// addSearch(filter, q, ["name", "phone"]) → adds one { $or } per word to filter.$and
export function addSearch(filter, q, fields) {
  const R = searchRegexes(q);
  if (!R.length) return filter;
  filter.$and = [...(filter.$and || []), ...R.map(rx => ({ $or: fields.map(f => ({ [f]: rx })) }))];
  return filter;
}

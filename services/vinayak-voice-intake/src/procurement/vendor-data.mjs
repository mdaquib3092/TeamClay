import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../config.mjs";
import { emailAddress } from "../../../vinayak-procurement/integrations/gmail/config.mjs";

export class VendorDataError extends Error {}
const directoryFile = "vendors.csv", historyFile = "vendor_performance.csv";

function readRows(root, file, columns) {
  let header, rows;
  try {
    [header, ...rows] = parseCsv(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch { throw new VendorDataError(`Cannot read ${file}.`); }
  if (!header || new Set(header).size !== header.length || !columns.every(k => header.includes(k))) {
    throw new VendorDataError(`Check the column names in ${file}.`);
  }
  const ids = new Set();
  return rows.map(fields => {
    if (fields.length !== header.length) throw new VendorDataError(`Check the column count in ${file}.`);
    const row = Object.fromEntries(header.map((k, i) => [k, fields[i]]));
    if (!/^V[\w-]+$/.test(row.vendor_id) || ids.has(row.vendor_id)) {
      throw new VendorDataError(`Each row in ${file} needs a unique vendor ID.`);
    }
    ids.add(row.vendor_id);
    return row;
  });
}

export function vendorDirectory(root) {
  const segmentAddresses = new Set();
  return readRows(root, directoryFile, ["vendor_id", "vendor_name", "category", "email"]).map(row => {
    const id = row.vendor_id, segments = [...new Set(row.category.toLowerCase().split(";").map(s => s.trim()).filter(Boolean))];
    if (!row.vendor_name || !segments.length) throw new VendorDataError(`Check the name and segment for ${id}.`);
    let email;
    try { email = emailAddress(row.email); } catch { throw new VendorDataError(`Verify the primary email for ${id}.`); }
    for (const segment of segments) {
      const key = `${segment}\0${email}`;
      if (segmentAddresses.has(key)) throw new VendorDataError(`Vendor inboxes must be distinct within ${segment}.`);
      segmentAddresses.add(key);
    }
    return { id, name: row.vendor_name, email, segments, whatsapp: row.whatsapp || null, paymentTerms: row.payment_terms || null };
  });
}
export function catalogVendors(root, segment) {
  return vendorDirectory(root).filter(v => v.segments.includes(segment)).map(({ id, name, email }) => ({ id, name, email }));
}

function metric(value, max = Infinity) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n <= max ? n : null;
}
export function vendorPerformance(root) {
  const rows = readRows(root, historyFile, ["vendor_id", "total_orders", "on_time_delivery_pct", "avg_quality_rating",
    "avg_reply_hours", "reply_rate_pct", "last_updated"]);
  return new Map(rows.map(r => {
    const orders = metric(r.total_orders);
    // The active CSV is a demonstration dataset. Blanks and rows for new
    // vendors are not observations and must never become scores of zero.
    const history = Number.isSafeInteger(orders) && orders > 0 ? {
      source: historyFile, kind: "demo", orders, onTime: metric(r.on_time_delivery_pct, 100),
      quality: metric(r.avg_quality_rating, 5), replyHours: metric(r.avg_reply_hours),
      replyRate: metric(r.reply_rate_pct, 100), updated: r.last_updated || null,
    } : null;
    return [r.vendor_id, history];
  }));
}

// Read only on demand: a new comparison sees the current file, while approved
// comparisons continue to use their saved snapshot. No seed/import is needed.
export function availablePerformance(root) {
  try { return vendorPerformance(root); }
  catch (error) { if (error instanceof VendorDataError) return new Map(); throw error; }
}
export function vendorSourceStatus(root) {
  const status = { vendors: { file: directoryFile }, performance: { file: historyFile, kind: "demo" } };
  let directory;
  try {
    directory = vendorDirectory(root);
    status.vendors.rows = directory.length;
  } catch (error) { status.vendors.error = error.message; }
  try {
    const history = vendorPerformance(root);
    status.performance.rows = history.size;
    if (directory) status.performance.matched = directory.filter(v => history.get(v.id)).length;
  } catch (error) { status.performance.error = error.message; }
  return status;
}

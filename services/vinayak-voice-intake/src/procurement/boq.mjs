import { catalogVendors } from "./vendor-data.mjs";
import { samples } from "./samples.mjs";
export { catalogVendors } from "./vendor-data.mjs";

export class CaseInputError extends Error {}
export function check(ok, message) { if (!ok) throw new CaseInputError(message); }
export const SAMPLE = samples[0].starter;
export const HELP = `Site engineer: ${SAMPLE}\nUse RFQ instead of DEMO RFQ for a standard case. Separate BOQ items with semicolons. +N means N calendar days from today. The project and address come from your assignment. Nothing is emailed until the project manager reviews the BOQ and types the SEND command. Use STATUS <case ID> for progress.`;
export const formatMoney = paise => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
const unit = s => ({ bags: "bag", packs: "pack", tonnes: "mt", tonne: "mt", tons: "mt", litres: "ltr", pieces: "nos" }[s.toLowerCase()] || s.toLowerCase());
function dateValue(text, today) {
  if (/^\+\d{1,3}$/.test(text)) return new Date(Date.parse(today) + Number(text) * 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(text) || !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text) return null;
  return text;
}

export function captureScope(db, root, projectId, fields, now = Date.now()) {
  check(fields.length === 4, HELP);
  const [items, site, needed, due] = fields;
  check(site && site.length <= 100 && !/[\r\n]/.test(site), "Give a site location of up to 100 characters.");
  const today = new Date(now + 19800000).toISOString().slice(0, 10); // business dates in Kolkata
  const needBy = dateValue(needed.replace(/^need(?:ed)?(?: by)?\s+/i, "").trim(), today);
  const deadline = dateValue(due.replace(/^reply(?: by)?\s+/i, "").trim(), today);
  check(needBy && deadline && today <= deadline && deadline <= needBy, "Specify a reply deadline today or later and a needed-by date on or after it (e.g. need +14 | reply +3).");
  const project = db.prepare("SELECT project_name,address FROM projects WHERE project_id=?").get(projectId);
  check(project?.address, "The assigned project needs a delivery address.");
  const entries = items.split(";").map(s => s.trim());
  check(entries.length <= 10, "Use at most ten same-segment material lines per case.");
  const used = new Set();
  const lines = entries.map(entry => {
    const match = /^(MAT\d+)\s+(\d+(?:\.\d{1,3})?)\s+([a-z0-9]+)$/i.exec(entry);
    check(match, "Each BOQ line must be MATERIAL_CODE quantity unit, for example MAT010 100 bags.");
    const code = match[1].toUpperCase(), total = Number(match[2]);
    const item = db.prepare(`SELECT m.material_name,m.category,m.unit,m.specification,s.qty_available,s.unit stock_unit,s.last_updated
      FROM materials m LEFT JOIN stock s ON s.material_code=m.material_code AND s.project_id=? WHERE m.material_code=?`).get(projectId, code);
    check(item && !used.has(code) && total > 0 && total <= 1000000 && item.unit === unit(match[3]),
      `${code}: check the material code, quantity, unit and duplicate lines.`);
    check(Number.isFinite(item.qty_available) && item.qty_available >= 0 && item.stock_unit === item.unit,
      `${code}: stock quantity/unit is not verified for this project.`);
    used.add(code);
    return { code, name: item.material_name, spec: item.specification, segment: item.category.toLowerCase(),
      unit: item.unit, requested: total, stock: item.qty_available, stockAt: item.last_updated,
      qty: Math.max(0, Math.round((total - item.qty_available) * 1000) / 1000) };
  });
  check(lines.every(l => l.segment === lines[0].segment), "Use one vendor segment per RFQ. Open separate cases for different segments.");
  const segment = lines[0].segment;
  return { projectId, project: project.project_name, address: project.address, site, needBy, deadline, lines, segment,
    vendors: catalogVendors(root, segment) };
}
export const linesForQuote = c => c.scope.lines.filter(l => l.qty > 0);
export const scopeSummary = c => c.scope.lines.map(l =>
  `${l.code} ${l.name} (${l.spec}): need ${l.requested}, stock ${l.stock}, quote ${l.qty} ${l.unit}`).join("\n");

export function renderRfq(template, c, vendor, pm) {
  const s = c.scope, lines = linesForQuote(c), ref = `${c.id} / ${vendor.id}`;
  const fields = {
    vendor_name: vendor.name, vendor_email: vendor.email, requirement_id: ref, item_summary: lines.map(l => l.code).join(", "),
    project_name: s.project, contact_name: `${vendor.name} team`, organisation: "Vinayak Procurement",
    requirement_lines: lines.map(l => `${l.code} — ${l.name}, ${l.spec}: ${l.qty} ${l.unit}`).join("\n"),
    delivery_address: `${s.site}, ${s.address}`, needed_by: s.needBy, reply_deadline: s.deadline,
    sender_name: pm.name, sender_role: "Project Manager",
  };
  const rendered = template.replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!(key in fields)) throw new Error("Unsupported RFQ template field");
    return fields[key];
  }).replaceAll("\r\n", "\n");
  const match = /^To:[^\n]+\nSubject: ([^\n]+)\n\n([\s\S]+)$/.exec(rendered);
  if (!match) throw new Error("Invalid RFQ template");
  const prefix = c.demo ? "[DEMO — no order] " : "";
  const format = lines.map(l => `${l.code}: <INR ex-GST rate> / ${l.unit}`).join("\n");
  return { subject: prefix + match[1], text: (c.demo ? "Test RFQ only. Please use hypothetical terms; do not supply goods.\n\n" : "") +
    match[2].trim() + `\n\nCase/vendor: ${ref}. Reply in this thread from this address; put your terms above the quoted email.\n` +
    `Please copy these fields. Rates are INR excluding GST; freight is a single pre-tax amount. GST applies to goods plus freight. State any different basis as an exclusion.\n` +
    `${format}\nGST: <percent>%\nFreight: <INR amount, 0 if included>\nDelivery: <number> days\nPayment: <terms>\nExclusions: <none or list>\nSpec: <exact or describe deviation>\nThis RFQ is not a work order.` };
}

// Only explicit terms in the supplier's reply can enter the calculation. The
// original email, IDs, flags and later revisions are retained separately.
export function parseTerms(text, scopeLines) {
  const fields = new Map(), flags = [], rates = {};
  for (const line of text.split(/[\n|;]/).map(x => x.trim()).filter(Boolean)) {
    if (/^(?:On .{0,500}wrote:|>+|--\s*$|[-_]{3,}\s*(?:Original|Forwarded) message)/i.test(line)) break;
    const m = /^(MAT\d+|GST|Freight|Delivery|Payment(?: terms)?|Exclusions?|Specs?)\s*[:=]\s*(.{1,400})$/i.exec(line);
    if (!m) continue;
    const k = m[1].toUpperCase().replace(/^PAYMENT TERMS$/, "PAYMENT").replace(/^EXCLUSION$/, "EXCLUSIONS").replace(/^SPECS$/, "SPEC");
    if (fields.has(k)) flags.push(`duplicate ${k}`);
    fields.set(k, m[2].trim());
  }
  for (const k of fields.keys()) if (k.startsWith("MAT") && !scopeLines.some(l => k === l.code)) flags.push(`unrequested ${k}`);
  let base = 0;
  for (const l of scopeLines) {
    const m = /^(?:(?:₹|INR|Rs\.?)\s*)?(\d{1,7}(?:\.\d{1,2})?)\s*(?:\/|per\s+)([a-z0-9]+)$/i.exec(fields.get(l.code) || "");
    if (!m || Number(m[1]) <= 0 || unit(m[2]) !== l.unit) { flags.push(`${l.code} ex-GST rate per ${l.unit}`); continue; }
    rates[l.code] = Math.round(Number(m[1]) * 100);
    base += Math.round(l.qty * rates[l.code]);
  }
  const g = /^(\d{1,3}(?:\.\d{1,2})?)\s*%$/.exec(fields.get("GST") || "");
  const gst = g && Number(g[1]) <= 100 ? Number(g[1]) : null;
  const f = /^(?:(?:INR|₹|Rs\.?)\s*)?(\d{1,8}(?:\.\d{1,2})?)$/i.exec(fields.get("FREIGHT") || "");
  const freight = f ? Math.round(Number(f[1]) * 100) : null;
  const d = /^(\d{1,3})\s*(?:days?)?$/i.exec(fields.get("DELIVERY") || "");
  const days = d ? Number(d[1]) : null, payment = fields.get("PAYMENT") || "", exclusions = fields.get("EXCLUSIONS") || "", spec = fields.get("SPEC") || "";
  if (gst == null) flags.push("GST %"); if (freight == null) flags.push("lump-sum freight"); if (days == null) flags.push("delivery days");
  if (!payment || /<|unknown|discuss|not specified|\btb[dc]\b/i.test(payment)) flags.push("agreed payment terms");
  if (!/^(?:none|nil|no exclusions)\.?$/i.test(exclusions)) flags.push("missing exclusions or scope deviation");
  if (!/^(?:exact|exact match|as specified)\.?$/i.test(spec)) flags.push("exact grade/spec confirmation");
  const tax = flags.length ? null : Math.round((base + freight) * gst / 100);
  return { rates, gst, freight, days, payment, exclusions, spec, flags, base, tax, landed: tax == null ? null : base + freight + tax };
}

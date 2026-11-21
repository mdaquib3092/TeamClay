import { catalogVendors } from "./vendor-data.mjs";
import { samples } from "./samples.mjs";
import { unit } from "./quote-terms.mjs";
export { formatMoney, parseTerms } from "./quote-terms.mjs";
export { catalogVendors } from "./vendor-data.mjs";

export class CaseInputError extends Error {}
export function check(ok, message) { if (!ok) throw new CaseInputError(message); }
export const SAMPLE = samples[0].starter;
export const HELP = `Site engineer: ${SAMPLE}\nUse RFQ instead of DEMO RFQ for a standard case. Separate BOQ items with semicolons. +N means N calendar days from today. The project and address come from your assignment. Nothing is emailed until the project manager reviews the BOQ and types the SEND command. Use STATUS <case ID> for progress.`;
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

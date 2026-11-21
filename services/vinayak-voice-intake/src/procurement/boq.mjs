import { catalogVendors } from "./vendor-data.mjs";
import { samples } from "./samples.mjs";
import { unit } from "./quote-terms.mjs";
import { businessTable, verifiedQuantity } from "./master-data.mjs";
export { formatMoney, parseTerms } from "./quote-terms.mjs";
export { catalogVendors } from "./vendor-data.mjs";

export class CaseInputError extends Error {}
export function check(ok, message) { if (!ok) throw new CaseInputError(message); }
export const SAMPLE = samples[0].starter;
export const HELP = `Site engineer: say what you need, for example “I need 10 bags of PPC cement”. I'll ask one short question at a time and show the quantities before you submit to the PM. Say “cancel” to discard a draft.\nRFQ RUN STEEL and RFQ RUN WATERPROOFING open the two-vendor workflow runs: https://clay-procurement.teamclay-d326e1.workers.dev/runs\nStructured intake: RFQ | MAT010 100 bags | Tower 2 | need +14 | reply +3. The PM reviews the drafts and approves dispatch. Use STATUS <case ID> for progress.`;
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
  const project = businessTable(root,"projects").find(p=>p.project_id===projectId);
  check(project?.address && db.prepare("SELECT 1 FROM projects WHERE project_id=?").get(projectId), "The assigned project needs a delivery address in projects.csv and a mapped project ID.");
  const materials = new Map(businessTable(root,"materials").map(m=>[m.material_code,m]));
  const stock = new Map(businessTable(root,"stock").filter(s=>s.project_id===projectId).map(s=>[s.material_code,s]));
  const entries = items.split(";").map(s => s.trim());
  check(entries.length <= 10, "Use at most ten same-segment material lines per case.");
  const used = new Set();
  const lines = entries.map(entry => {
    const match = /^(MAT\d+)\s+(\d+(?:\.\d{1,3})?)\s+([a-z0-9]+)$/i.exec(entry);
    check(match, "Each BOQ line must be MATERIAL_CODE quantity unit, for example MAT010 100 bags.");
    const code = match[1].toUpperCase(), total = Number(match[2]);
    const item=materials.get(code),observation=stock.get(code),onHand=verifiedQuantity(observation,item);
    check(item?.material_name && item.category && !used.has(code) && total > 0 && total <= 1000000 && item.unit === unit(match[3]),
      `${code}: check the material code, quantity, unit and duplicate lines.`);
    check(db.prepare("SELECT 1 FROM materials WHERE material_code=?").get(code),`${code}: complete the ERP material mapping before issuing this BOQ.`);
    check(onHand!==null&&observation.last_updated, `${code}: stock quantity, unit or timestamp is not verified in stock.csv for this project.`);
    used.add(code);
    return { code, name: item.material_name, spec: item.specification, segment: item.category.toLowerCase(),
      unit: item.unit, requested: total, stock: onHand, stockAt: observation.last_updated,
      qty: Math.max(0, Math.round((total - onHand) * 1000) / 1000) };
  });
  check(lines.every(l => l.segment === lines[0].segment), "Use one vendor segment per RFQ. Open separate cases for different segments.");
  const segment = lines[0].segment;
  return { projectId, project: project.project_name, address: project.address, site, needBy, deadline, lines, segment,
    vendors: catalogVendors(root, segment) };
}
export const linesForQuote = c => c.scope.lines.filter(l => l.qty > 0);
export function bindRun(scope,run){
  if(!run)return scope;
  check(scope.segment===run.key&&scope.lines.length===run.lines.length&&run.lines.every(l=>scope.lines.some(s=>s.code===l.code)),
    `This ${run.label} run uses ${run.lines.map(l=>l.code).join(" and ")}. Check the BOQ codes.`);
  const vendors=run.vendors.map(id=>{
    const v=scope.vendors.find(x=>x.id===id);
    check(v,`Configure ${id} as a ${run.key} vendor in data/vendors.csv before starting this run.`);
    return v;
  });
  return {...scope,runKey:run.key,vendors};
}
export const scopeSummary = c => c.scope.lines.map(l =>
  `${l.code} ${l.name} (${l.spec}): need ${l.requested}, stock ${l.stock}, quote ${l.qty} ${l.unit}`).join("\n")+(c.scope.siteNotes?`\nSite instruction: ${c.scope.siteNotes}`:"");

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
  const prefix = c.scope.runKey ? "[RFQ workflow run — no order] " : c.demo ? "[DEMO — no order] " : "";
  const format = lines.map(l => `${l.code}: <INR ex-GST rate> / ${l.unit}`).join("\n");
  return { subject: prefix + match[1], text: (c.scope.runKey ? "Two-vendor workflow check. Please reply with quotation terms for this exercise; do not supply goods.\n\n" : c.demo ? "Test RFQ only. Please use hypothetical terms; do not supply goods.\n\n" : "") +
    match[2].trim() + (s.siteNotes?`\n\nSite instruction: ${s.siteNotes}`:"") + `\n\nCase/vendor: ${ref}. Reply in this thread from this address; put your terms above the quoted email.\n` +
    `Please copy these fields. Rates are INR excluding GST; freight is a single pre-tax amount. GST applies to goods plus freight. State any different basis as an exclusion.\n` +
    `${format}\nGST: <percent>%\nFreight: <INR amount, 0 if included>\nDelivery: <number> days\nPayment: <terms>\nExclusions: <none or list>\nSpec: <exact or describe deviation>\nThis RFQ is not a work order.` };
}

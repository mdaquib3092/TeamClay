import sourceData from './source-data.json' with { type: 'json' };
import type { Approval, BoqLine, ComparisonLine, ComparisonRow, Item, ItemMatch, ParsedQuote, ParsedRequirement, Quote, QuoteInput, Requirement, RequirementInput, Unit, Vendor, Workspace, WorkspaceAction } from './types';

export const SQFT_PER_SQM = 10.763910416709722;
export const SCORE_WEIGHTS = { price: 0.6, performance: 0.4 };
export const MIN_RFQ_VENDORS = 2;
const units: Unit[] = ['sqm', 'sqft', 'm', 'kg', 'nos', 'lot', 'cum', 'ton'];
const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clean = (s: unknown, max = 30000) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const numberOrNull = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? n : null;
const unitOrNull = (u: unknown): Unit | null => units.includes(u as Unit) ? u as Unit : null;
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const tokens = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['the','and','with','for','supply','apply','work','waterproofing'].includes(t)));
function canonical(unit: Unit): Unit { return unit === 'sqft' ? 'sqm' : unit === 'ton' ? 'kg' : unit; }
function canonicalQty(quantity: number, unit: Unit) { return unit === 'sqft' ? quantity / SQFT_PER_SQM : unit === 'ton' ? quantity * 1000 : quantity; }
export function normalizedRate(rate: number, quoteUnit: Unit, targetUnit: Unit): number | null {
  if (canonical(quoteUnit) !== canonical(targetUnit)) return null;
  return quoteUnit === 'sqft' ? rate * SQFT_PER_SQM : quoteUnit === 'ton' ? rate / 1000 : rate;
}
function hasMatchedItems(ws: Workspace, req: Requirement) {
  return req.lines.filter(l=>l.quantity!==null).every(line=>{const item=ws.items.find(i=>i.id===(line.itemId||(req.lines.length===1?req.selectedItemId:null)));return !!item&&canonical(item.unit)===canonical(line.unit);});
}
function getRequest(ws: Workspace, id: string) { const req = ws.requests.find(r => r.id === id); requireValue(req, 'Requirement not found.'); return req; }
function addEvent(ws: Workspace, actor: string, action: string, detail: string, requestId: string | null) {
  ws.events.unshift({ id: uid('event'), at: now(), actor: clean(actor, 160) || 'Workspace user', action, detail, requestId });
}
function invalidate(ws: Workspace, requestId: string) {
  for (const approval of ws.approvals) {
    if (approval.requestId === requestId && (approval.status === 'Pending' || approval.status === 'Approved')) {
      approval.status = 'Superseded';
      approval.note = 'Underlying requirement, item, quote, or vendor evidence changed. Submit a fresh recommendation.';
    }
  }
}
function validateRequirement(r: RequirementInput) {
  requireValue(clean(r.title) && clean(r.project) && clean(r.category), 'Title, project and category are required.');
  requireValue(Array.isArray(r.lines) && r.lines.length > 0 && r.lines.length <= 150, 'Add between 1 and 150 BOQ lines.');
  const ids = new Set<string>();
  for (const line of r.lines) {
    requireValue(clean(line.id) && !ids.has(line.id), 'Every BOQ line must have a unique ID.'); ids.add(line.id);
    requireValue(clean(line.description), 'Every BOQ line needs a description.');
    requireValue(unitOrNull(line.unit), `Unknown unit for ${line.code || line.id}.`);
    requireValue(line.quantity === null || (Number.isFinite(line.quantity) && line.quantity > 0), 'Quantities must be positive numbers or explicitly unmeasured.');
  }
  requireValue(!r.needBy || /^\d{4}-\d{2}-\d{2}$/.test(r.needBy), 'Required-by date must use YYYY-MM-DD.');
}
function quoteBlockers(q: Quote, req: Requirement) {
  const flags: string[] = [];
  if (!q.reviewed) flags.push('Extracted quote has not been reviewed.');
  if (!q.scopeConfirmed) flags.push('Scope and client-supplied materials require confirmation.');
  if (q.gstPercent === null) flags.push('GST percentage is not confirmed.');
  if (q.freight === null) flags.push('Freight / mobilisation amount is not confirmed.');
  if (!q.paymentTerms || /(?:to be|will\s+fix|after\s+discussion|not specified|unknown|\btbc\b|\btbd\b)/i.test(q.paymentTerms)) flags.push('Payment terms are not agreed.');
  if (q.deliveryDays === null) flags.push('Delivery / mobilisation lead time is not confirmed.');
  for (const line of req.lines.filter(l => l.quantity !== null)) {
    const ql = q.lines.find(l => l.boqLineId === line.id);
    if (!ql || ql.rate === null || ql.unit === null) flags.push(`${line.code}: rate or unit is missing.`);
    else {
      if (!ql.confirmed) flags.push(`${line.code}: extracted rate needs human confirmation.`);
      if (normalizedRate(ql.rate, ql.unit, line.unit) === null) flags.push(`${line.code}: ${ql.unit} cannot be converted to ${line.unit}.`);
    }
  }
  if (req.lines.some(l => l.quantity === null) && !req.measuredScopeOnly) flags.push('Unmeasured BOQ quantities remain; confirm a measured-scope-only comparison or enter quantities.');
  return flags;
}
function validateQuote(q: QuoteInput) {
  requireValue(Array.isArray(q.lines) && q.lines.length > 0 && q.lines.length <= 150, 'Add at least one quoted BOQ line.');
  const ids = new Set<string>();
  for (const line of q.lines) {
    requireValue(clean(line.boqLineId) && !ids.has(line.boqLineId), 'Quoted BOQ lines must be unique.'); ids.add(line.boqLineId);
    requireValue(line.rate === null || (Number.isFinite(line.rate) && line.rate >= 0), 'Rates must be non-negative numbers or empty.');
    requireValue(line.unit === null || unitOrNull(line.unit), 'Unknown quoted unit.');
    requireValue(line.quotedQuantity === null || (Number.isFinite(line.quotedQuantity) && line.quotedQuantity > 0), 'Quoted quantities must be positive or empty.');
  }
  requireValue(q.gstPercent === null || (Number.isFinite(q.gstPercent) && q.gstPercent >= 0 && q.gstPercent <= 100), 'GST must be between 0 and 100%.');
  requireValue(q.freight === null || (Number.isFinite(q.freight) && q.freight >= 0), 'Freight / mobilisation must be non-negative.');
  requireValue(q.deliveryDays === null || (Number.isInteger(q.deliveryDays) && q.deliveryDays >= 0 && q.deliveryDays <= 3650), 'Lead time must be a whole number of days.');
}
function performance(v: Vendor) {
  const p = v.performance;
  if (!p || p.completedOrders < 1) return { score: 50, note: 'No verified vendor history. Neutral 50/100 baseline; no performance advantage assumed.' };
  return { score: money(p.quality * 0.5 + p.delivery * 0.4 + Math.max(0, 100 - p.disputes * 10) * 0.1), note: `Past performance from ${p.completedOrders} completed orders: quality ${p.quality}/100, on-time delivery ${p.delivery}/100, ${p.disputes} recorded disputes. ${p.notes}` };
}
export function compareQuotes(ws: Workspace, requestId: string): ComparisonRow[] {
  const req = getRequest(ws, requestId);
  const measured = req.lines.filter(l => l.quantity !== null);
  const rows = ws.quotes.filter(q => q.requestId === requestId).map(q => {
    const vendor = ws.vendors.find(v => v.id === q.vendorId);
    if (!vendor) throw new Error('Quote refers to an unknown vendor.');
    const p = performance(vendor);
    const blockers = quoteBlockers(q, req);
    const warnings = [...q.flags];
    const lines: ComparisonLine[] = req.lines.map(line => {
      const ql = q.lines.find(l => l.boqLineId === line.id);
      const flags: string[] = [];
      const rate = ql && ql.rate !== null && ql.unit ? normalizedRate(ql.rate, ql.unit, line.unit) : null;
      const quantity = line.quantity === null ? null : canonicalQty(line.quantity, line.unit);
      if (line.quantity === null) flags.push('Unmeasured; excluded from measured-scope subtotal.');
      if (ql?.unit && ql.unit !== line.unit && rate !== null) flags.push(`Converted ${ql.unit} rate to ${canonical(line.unit)}.`);
      if (ql?.rate !== null && ql?.unit && rate === null) flags.push(`Incompatible dimensions: ${ql.unit} and ${line.unit}.`);
      if (ql?.quotedQuantity && ql.unit && quantity && canonical(ql.unit) === canonical(line.unit)) {
        const quoteQty = canonicalQty(ql.quotedQuantity, ql.unit);
        if (Math.abs(quoteQty - quantity) / quantity > 0.005) flags.push(`Vendor quantity ${ql.quotedQuantity} ${ql.unit} differs from site BOQ; subtotal uses site quantity.`);
      }
      if (rate === null && line.quantity !== null) flags.push('No usable rate.');
      return { boqLineId: line.id, code: line.code, description: line.description, quantity, unit: canonical(line.unit), normalizedRate: rate === null ? null : money(rate), amount: quantity !== null && rate !== null ? money(quantity * rate) : null, flags };
    });
    const covered = lines.filter(l => l.quantity !== null && l.amount !== null).length;
    const baseTotal = measured.length && covered === measured.length ? money(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)) : null;
    const gstAmount = baseTotal !== null && q.freight !== null && q.gstPercent !== null ? money((baseTotal + q.freight) * q.gstPercent / 100) : null;
    const landedTotal = baseTotal !== null && q.freight !== null && gstAmount !== null ? money(baseTotal + q.freight + gstAmount) : null;
    const sameUnit = measured.every(l => canonical(l.unit) === canonical(measured[0]?.unit));
    const aggregateQty = measured.reduce((sum, l) => sum + canonicalQty(l.quantity!, l.unit), 0);
    const eligible = !blockers.length && baseTotal !== null && landedTotal !== null && measured.length > 0;
    if (req.measuredScopeOnly && req.lines.some(l => l.quantity === null)) warnings.push('Comparison is limited to quantified lines. Unmeasured items remain outside the approval value.');
    if (!vendor.performance) warnings.push('Vendor history not supplied; neutral performance score.');
    const row: ComparisonRow = {
      quoteId: q.id, vendorId: vendor.id, vendorName: vendor.name, rank: null, eligible,
      normalizedRate: sameUnit && aggregateQty && baseTotal !== null ? money(baseTotal / aggregateQty) : null,
      normalizedUnit: measured[0] ? canonical(measured[0].unit) : req.unit,
      baseTotal, gstAmount, freight: q.freight, landedTotal, priceScore: null, performanceScore: p.score, score: null,
      recommended: false, cheapest: false, reasons: [p.note, 'All vendors are recalculated against the same current site BOQ quantities. GST is applied to the base amount plus lump-sum freight / mobilisation.'],
      flags: [...blockers, ...warnings], deliveryDays: q.deliveryDays, paymentTerms: q.paymentTerms, lines,
      coverage: `${covered}/${measured.length} quantified lines`, provisional: !eligible || req.lines.some(l => l.quantity === null),
    };
    return row;
  });
  const eligible = rows.filter(r => r.eligible);
  const minTotal = Math.min(...eligible.map(r => r.landedTotal!));
  for (const row of eligible) {
    row.priceScore = minTotal === 0 ? (row.landedTotal === 0 ? 100 : 0) : money(minTotal / row.landedTotal! * 100);
    row.score = money(row.priceScore * SCORE_WEIGHTS.price + row.performanceScore * SCORE_WEIGHTS.performance);
    row.cheapest = row.landedTotal === minTotal;
    row.reasons.unshift(`${row.priceScore}/100 price score × 60% + ${row.performanceScore}/100 performance score × 40% = ${row.score}/100.`);
    row.reasons.push(row.cheapest ? 'Lowest confirmed landed cost among comparable, reviewed quotes.' : `${money(row.landedTotal! - minTotal).toLocaleString('en-IN')} INR above the lowest confirmed landed cost.`);
  }
  eligible.sort((a,b) => b.score! - a.score! || a.landedTotal! - b.landedTotal! || a.vendorName.localeCompare(b.vendorName));
  const tiedTop=eligible.length>1&&eligible[0].score===eligible[1].score&&eligible[0].landedTotal===eligible[1].landedTotal;
  eligible.forEach((r,i) => {
    r.rank=i>0&&r.score===eligible[i-1].score&&r.landedTotal===eligible[i-1].landedTotal?eligible[i-1].rank:i+1;
    r.recommended=i===0&&eligible.length>=2&&!tiedTop;
    if(tiedTop&&r.rank===1)r.reasons.push('Equal price and weighted score at the top: no unique vendor recommendation. Record additional verified evidence or clarify terms before submitting.');
    else if(i===0&&eligible.length>1&&r.score===eligible[1].score)r.reasons.push('Weighted scores tie after rounding; lower confirmed landed cost breaks the tie.');
  });
  return rows.sort((a,b) => (a.rank ?? 999) - (b.rank ?? 999) || (a.baseTotal ?? Infinity) - (b.baseTotal ?? Infinity));
}

export function createWorkspace(): Workspace {
  const seed = structuredClone(sourceData) as unknown as Partial<Workspace>;
  const ws: Workspace = {
    revision: 0, demo: false, requests: [], activeRequestId: '', items: [], vendors: [], quotes: [], rfqs: [], approvals: [], events: [], sourceNotes: [], sop: [], ...seed,
  };
  ws.revision = 0; ws.demo = !!seed.demo; ws.rfqs = []; ws.approvals = []; ws.events = [];
  if (!ws.activeRequestId) ws.activeRequestId = ws.requests[0]?.id || '';
  addEvent(ws, 'Source import', 'Source pack imported', 'Workspace seed loaded. Quantities and commercial terms require human review.', null);
  return ws;
}

export function matchItems(text: string, items: Item[]): ItemMatch[] {
  const a = tokens(text);
  return items.map(item => {
    const b = tokens(`${item.code} ${item.name} ${item.specification}`);
    const intersection = [...a].filter(t => b.has(t)).length;
    const union = new Set([...a,...b]).size;
    const codeHit = text.toLowerCase().includes(item.code.toLowerCase());
    const nameExact = clean(text).toLowerCase() === item.name.toLowerCase();
    const conflict = codeHit && !nameExact && intersection < 2;
    const confidence = nameExact ? 1 : codeHit && !conflict ? .97 : Math.min(.98, intersection / Math.max(1, Math.min(a.size,b.size)) * .75 + intersection / Math.max(1,union) * .25);
    return { item, confidence: money(confidence), likelyDuplicate: confidence >= .85, reason: conflict ? 'Code matches but description differs: possible code reuse. Compare specifications before matching.' : codeHit ? 'Code match; confirm description because source master contains reused codes.' : nameExact ? 'Exact description match.' : `${intersection} matching description terms. Confirm specification, dimensions and unit before accepting.` };
  }).filter(m => m.confidence > 0).sort((a,b) => b.confidence-a.confidence).slice(0, 8);
}

export function draftRfq(req: Requirement, vendor: Vendor) {
  const body = [
    `Dear ${vendor.name},`, '', `Please quote for ${req.title} at ${req.project}, ${req.location}.`,
    `Category: ${req.category}`, `Required by: ${req.needBy || 'To be confirmed'}`, '', 'BOQ (site quantities; rates to be quoted line by line):',
    ...req.lines.map(l => `${l.code}: ${l.description} | ${l.quantity === null ? 'Quantity to be measured' : l.quantity} ${l.unit} | ${l.specification}`),
    '', `Scope: ${req.specification}`, '',
    'Please state unit rates and units, GST percentage, freight / mobilisation, payment terms, lead time, exclusions and client-supplied materials. Quote on the stated scope and identify any deviation. Unmeasured items require separate agreed quantities.',
    '', 'Vinayak standard tender conditions (from the supplied sample RFQ):',
    '1. PF and ESI registration is required.',
    '2. TDS will be deducted as per Government norms.',
    '3. A 5% security deposit will be retained and released 12 months after total completion.',
    '4. GST is extra; specify the applicable percentage.',
    '5. Water and electricity at point, plus labour hutment, are provided by the client.',
    '6. Safety PPE is in the contractor scope.',
    '', 'This RFQ is a test copy for the procurement demonstration. It is delivered only to the internal test inbox. No work order or vendor award is created.',
  ].join('\n');
  return { subject: `TEST RFQ | ${req.project} | ${req.title}`, body, recipient: `${vendor.id.replace(/[^a-z0-9]/gi, '-').toLowerCase()}@example.test` };
}

function parseUnit(s: string): Unit | null {
  const t = s.toLowerCase().replace(/[.\s²³_-]/g,'');
  if (['sqm','m2','sqmeter','sqmetre'].includes(t)) return 'sqm';
  if (['sqft','sft','ft2','soft'].includes(t)) return 'sqft';
  if (['rmt','rm','m','meter','metre'].includes(t)) return 'm';
  if (['cum','m3'].includes(t)) return 'cum';
  if (['nos','no','number','each','pcs'].includes(t)) return 'nos';
  if (['kg','kgs'].includes(t)) return 'kg';
  if (['ton','tonne','mt'].includes(t)) return 'ton';
  if (['lot','ls','lumpsum'].includes(t)) return 'lot';
  return null;
}
export function parseRequirement(text: string): ParsedRequirement {
  const value = clean(text);
  requireValue(value.length > 0, 'Paste a requirement first.');
  const warnings = ['Assisted extraction uses explicit text patterns. Review every value against the source before saving.'];
  const found = value.match(/([\d,]+(?:\.\d+)?)\s*(sqm|sq\.?\s*m|m2|sqft|sq\.?\s*ft|sft|rmt|rm|cum|m3|kg|nos|pcs|tonne|ton|lot)\b/i);
  const quantity = found ? Number(found[1].replace(/,/g,'')) : undefined;
  const unit = found ? parseUnit(found[2]) : undefined;
  const project = value.match(/(?:project|site)\s*[:=-]\s*([^\n,]+)/i)?.[1] || (/amara/i.test(value) ? 'Vinayak Amara' : /aquina/i.test(value) ? 'Vinayak Aquina' : undefined);
  const location = value.match(/tower\s*[-:]?\s*\d+/i)?.[0] || value.match(/location\s*[:=-]\s*([^\n]+)/i)?.[1];
  const category = /water\s*proof/i.test(value) ? 'Waterproofing' : /road|pavement/i.test(value) ? 'Civil / Road works' : undefined;
  const title = value.match(/(?:subject|requirement|title)\s*[:=-]\s*([^\n]+)/i)?.[1] || value.split('\n').find(l => l.trim())?.slice(0,120);
  const needBy = value.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  if (!quantity || !unit) warnings.push('No unambiguous quantity and unit found. Enter the BOQ manually.');
  if (!project) warnings.push('Project was not identified.');
  const lines: BoqLine[] = quantity && unit ? [{id:uid('line'),code:'NEW.01',description:title || 'Site requirement',quantity,unit,itemId:null,specification:value,optional:false,sourceRef:'Pasted requirement'}] : [];
  return { title, project, location, category, quantity, unit: unit || undefined, specification:value, needBy, priority:/urgent|asap/i.test(value)?'Urgent':'Normal', sourceText:value, sourceName:'Pasted requirement', lines, measuredScopeOnly:false, flags:[], warnings };
}
export function parseQuote(text: string, request?: Requirement): ParsedQuote {
  const value = clean(text, 150000);
  requireValue(value.length > 0, 'Paste quotation text first.');
  const warnings = ['Assisted extraction requires human confirmation. Missing values remain empty; no commercial term is assumed.'];
  const rateMatch = value.match(/(?:rate|price)\s*[:=@]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per)?\s*(sqm|sqft|sft|rmt|rm|cum|kg|nos|ton|lot)\b/i);
  const gstMatch = value.match(/gst\s*(?:@|at|:|=)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const freightMatch = value.match(/(?:freight|mobilisation|mobilization)\s*[:=@]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const deliveryMatch = value.match(/(?:delivery|lead\s*time|mobilisation|mobilization)\s*[:=@]?\s*(\d+)\s*(days?|weeks?)/i);
  const paymentTerms = value.match(/payment\s*(?:terms?)?\s*[:=-]?\s*([^\n]+)/i)?.[1]?.trim() || '';
  const freight = freightMatch ? Number(freightMatch[1].replace(/,/g,'')) : /(?:freight|mobilisation|mobilization)\s*(?:is|:|=)?\s*(?:included|nil|zero)/i.test(value) ? 0 : null;
  const lines = request?.lines.map(l => {
    const escaped = l.code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const lineText = value.match(new RegExp(`${escaped}[^\\n]*`, 'i'))?.[0] || '';
    const match = lineText.match(/(?:rate\s*[:=@]?\s*)?(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:\/|per)\s*(sqm|sqft|sft|rmt|rm|cum|kg|nos|ton|lot)\b/i);
    return { boqLineId:l.id, description:l.description, rate:match ? Number(match[1].replace(/,/g,'')) : request.lines.length===1&&rateMatch?Number(rateMatch[1].replace(/,/g,'')):null, unit:match?parseUnit(match[2]):request.lines.length===1&&rateMatch?parseUnit(rateMatch[2]):null, quotedQuantity:null, sourceRef:'Uploaded / pasted quotation', confirmed:false };
  }) || [];
  if (!gstMatch) warnings.push('GST percentage is not stated.');
  if (freight === null) warnings.push('Freight / mobilisation is not stated.');
  if (!paymentTerms || /discussion|to be|will fix/i.test(paymentTerms)) warnings.push('Payment terms need clarification.');
  if (!deliveryMatch) warnings.push('Lead time is not stated.');
  if (lines.some(l=>l.rate===null)) warnings.push('Some line rates could not be matched. Enter them against the BOQ.');
  return { rate:rateMatch?Number(rateMatch[1].replace(/,/g,'')):null, unit:rateMatch?parseUnit(rateMatch[2]):null, gstPercent:gstMatch?Number(gstMatch[1]):null, freight, deliveryDays:deliveryMatch?Number(deliveryMatch[1])*(deliveryMatch[2].startsWith('week')?7:1):null, paymentTerms, sourceText:value, sourceName:'Pasted quotation', reviewed:false, scopeConfirmed:false, flags:[], lines, warnings };
}

export function applyAction(original: Workspace, action: WorkspaceAction, actor = 'Workspace user'): Workspace {
  requireValue(action && typeof action.type === 'string', 'An action is required.');
  const ws = structuredClone(original);
  switch (action.type) {
    case 'select_request': {
      getRequest(ws, action.requestId); ws.activeRequestId = action.requestId; break;
    }
    case 'create_requirement': {
      const r = action.requirement; validateRequirement(r);
      const req:Requirement = { ...r, id:uid('req'), title:clean(r.title,200), project:clean(r.project,150), location:clean(r.location,150), category:clean(r.category,150), specification:clean(r.specification), sourceText:clean(r.sourceText), selectedItemId:null, createdAt:now(), measuredScopeOnly:!!r.measuredScopeOnly, flags:r.flags || [], sourceName:clean(r.sourceName,250) };
      ws.requests.unshift(req); ws.activeRequestId=req.id;
      addEvent(ws,actor,'Requirement captured',`${req.title}; ${req.lines.length} BOQ lines.`,req.id); break;
    }
    case 'update_requirement': {
      const req = getRequest(ws,action.requestId);
      const merged = {...req,...action.requirement,id:req.id,createdAt:req.createdAt,selectedItemId:req.selectedItemId}; validateRequirement(merged);
      Object.assign(req,merged); invalidate(ws,req.id);
      addEvent(ws,actor,'Requirement updated','BOQ quantities, scope or requirement fields reviewed. Previous approvals superseded.',req.id); break;
    }
    case 'match_item': {
      const req=getRequest(ws,action.requestId), item=ws.items.find(i=>i.id===action.itemId); requireValue(item,'Item code not found.');
      if (action.lineId) { const line=req.lines.find(l=>l.id===action.lineId); requireValue(line,'BOQ line not found.'); requireValue(canonical(line.unit)===canonical(item.unit),'Item unit does not match this BOQ line.'); line.itemId=item.id; }
      else { requireValue(req.lines.length===1,'Choose the BOQ line to match in a multi-line package.'); requireValue(canonical(req.lines[0].unit)===canonical(item.unit),'Item unit does not match the BOQ line.'); req.selectedItemId=item.id; req.lines[0].itemId=item.id; }
      invalidate(ws,req.id); addEvent(ws,actor,'Item code matched',`${item.code}: ${item.name}`,req.id); break;
    }
    case 'create_item': {
      const req=getRequest(ws,action.requestId), line=action.lineId?req.lines.find(l=>l.id===action.lineId):req.lines[0]; requireValue(line,'BOQ line not found.');
      const name=clean(action.name,250); requireValue(name,'An item description is required.');
      const duplicates=matchItems(name,ws.items).filter(m=>m.likelyDuplicate); requireValue(!duplicates.length,`Likely duplicate of ${duplicates[0]?.item.code}. Reuse or revise the description after review.`);
      const code=clean(action.code,80)||`PROPOSED-${String(ws.items.length+1).padStart(4,'0')}`;
      requireValue(!ws.items.some(i=>i.code.toLowerCase()===code.toLowerCase()),'This item code already exists.');
      const item:Item={id:uid('item'),code,name,category:req.category,unit:line.unit,specification:line.specification,provisional:true}; ws.items.push(item); line.itemId=item.id;
      if(!action.lineId) req.selectedItemId=item.id;
      invalidate(ws,req.id);addEvent(ws,actor,'New item proposed',`${code}; pending ERP master creation.`,req.id);break;
    }
    case 'send_rfqs': {
      const req=getRequest(ws,action.requestId);
      requireValue(hasMatchedItems(ws,req),'Match or propose a compatible item code for every quantified BOQ line before issuing RFQs.');
      requireValue(Array.isArray(action.vendorIds)&&action.vendorIds.length<=100,'Choose a list of at most 100 vendors.');
      const vendorIds=[...new Set(action.vendorIds)];
      requireValue(vendorIds.length>=MIN_RFQ_VENDORS,`Choose at least ${MIN_RFQ_VENDORS} distinct eligible vendors for this RFQ.`);
      for(const vendorId of vendorIds){
        const vendor=ws.vendors.find(v=>v.id===vendorId);requireValue(vendor,'Vendor not found.');
        const rc=req.category.toLowerCase(),vc=vendor.category.toLowerCase();
        const categoryMatches=rc===vc||(rc.includes('waterproof')&&vc.includes('waterproof'))||((rc.includes('road')||rc.includes('civil'))&&(vc.includes('road')||vc.includes('civil')));
        requireValue(categoryMatches,`${vendor.name}: confirm the vendor category before sending this RFQ.`);
        const exists=ws.rfqs.some(r=>r.requestId===req.id&&r.vendorId===vendor.id);
        requireValue(!exists,`An RFQ has already been delivered to ${vendor.name}'s test inbox.`);
        const draft=draftRfq(req,vendor); ws.rfqs.push({id:uid('rfq'),requestId:req.id,vendorId:vendor.id,...draft,status:'Delivered to test inbox',createdAt:now()});
      }
      addEvent(ws,actor,'Test RFQs delivered',`${vendorIds.length} RFQ copies stored in internal test inboxes. No real vendor email sent.`,req.id);break;
    }
    case 'add_quote': {
      const input=action.quote,req=getRequest(ws,input.requestId);validateQuote(input);requireValue(ws.vendors.some(v=>v.id===input.vendorId),'Vendor not found.');
      requireValue(!ws.quotes.some(q=>q.requestId===req.id&&q.vendorId===input.vendorId),'A quote already exists for this vendor. Update that quote instead.');
      requireValue(input.lines.every(l=>req.lines.some(b=>b.id===l.boqLineId)),'Quote contains an unknown BOQ line.');
      const quote:Quote={...input,id:uid('quote'),createdAt:now(),updatedAt:now()};
      if(quote.reviewed) requireValue(quote.lines.filter(l=>req.lines.find(b=>b.id===l.boqLineId)?.quantity!==null).every(l=>l.confirmed),'Confirm every extracted line before marking quote reviewed.');
      ws.quotes.push(quote);invalidate(ws,req.id);addEvent(ws,actor,'Quote added','Vendor quotation stored for normalisation and review.',req.id);break;
    }
    case 'update_quote': {
      const q=ws.quotes.find(q=>q.id===action.quoteId);requireValue(q,'Quote not found.');
      const merged={...q,...action.quote,id:q.id,requestId:q.requestId,vendorId:q.vendorId,createdAt:q.createdAt,updatedAt:now()};validateQuote(merged);
      const req=getRequest(ws,q.requestId);requireValue(merged.lines.every(l=>req.lines.some(b=>b.id===l.boqLineId)),'Quote contains an unknown BOQ line.');
      if(merged.reviewed) requireValue(merged.lines.filter(l=>req.lines.find(b=>b.id===l.boqLineId)?.quantity!==null).every(l=>l.confirmed),'Confirm every extracted line before marking quote reviewed.');
      Object.assign(q,merged);invalidate(ws,q.requestId);addEvent(ws,actor,'Quote reviewed','Quote values or scope updated. Previous recommendations superseded.',q.requestId);break;
    }
    case 'submit_recommendation': {
      const req=getRequest(ws,action.requestId),rows=compareQuotes(ws,req.id),ranked=rows.filter(r=>r.eligible);
      requireValue(ranked.length>=2,'At least two complete, comparable and reviewed quotes are required. Resolve the flagged fields first.');
      requireValue(hasMatchedItems(ws,req),'Confirm a compatible item code for every quantified BOQ line before submitting a recommendation.');
      requireValue(!ws.approvals.some(a=>a.requestId===req.id&&a.status==='Pending'),'A recommendation is already pending HOD review.');
      const top=ranked.sort((a,b)=>a.rank!-b.rank!)[0];
      requireValue(top.recommended,'The leading vendors are tied. Record additional verified evidence or clarify terms before submitting a recommendation.');
      invalidate(ws,req.id);
      const recommendation=[`${top.vendorName} ranks first at ${top.score}/100.`,...top.reasons,req.measuredScopeOnly?'Approval value covers quantified BOQ lines only; unmeasured items remain excluded.':'Approval value covers the stated BOQ.',clean(action.note)].filter(Boolean).join('\n');
      ws.approvals.unshift({id:uid('approval'),requestId:req.id,vendorId:top.vendorId,quoteId:top.quoteId,status:'Pending',recommendation,score:top.score!,landedTotal:top.landedTotal!,submittedAt:now(),reviewedAt:null,reviewer:null,note:'',snapshot:rows});
      addEvent(ws,actor,'Recommendation sent to HOD',`${top.vendorName}; ${top.score}/100. Delivered to the in-app approval inbox.`,req.id);break;
    }
    case 'review_approval': {
      const a=ws.approvals.find(a=>a.id===action.approvalId);requireValue(a,'Approval not found.');requireValue(a.status==='Pending','Only pending recommendations can be reviewed.');
      requireValue(action.decision==='Approved'||action.decision==='Changes requested','Choose approval or changes requested.');
      requireValue(clean(action.reviewer,150),'Enter the human reviewer name.');requireValue(clean(action.note,3000),'Record an approval or revision note.');
      const fresh=compareQuotes(ws,a.requestId).find(r=>r.quoteId===a.quoteId); requireValue(fresh?.recommended&&fresh.landedTotal===a.landedTotal,'Comparison changed. Submit a fresh recommendation.');
      a.status=action.decision;a.reviewer=clean(action.reviewer,150);a.note=clean(action.note,3000);a.reviewedAt=now();
      addEvent(ws,actor,action.decision==='Approved'?'HOD recommendation approved':'HOD requested changes',`${a.reviewer}: ${a.note}. No award, order or payment was created.`,a.requestId);break;
    }
    case 'add_vendor': {
      const vendor={...action.vendor,id:uid('vendor')};validateVendor(vendor);requireValue(!ws.vendors.some(v=>v.name.toLowerCase()===vendor.name.toLowerCase()),'Vendor already exists.');
      ws.vendors.push(vendor);addEvent(ws,actor,'Vendor added',vendor.name,null);break;
    }
    case 'update_vendor': {
      const vendor=ws.vendors.find(v=>v.id===action.vendorId);requireValue(vendor,'Vendor not found.');
      const merged={...vendor,...action.vendor,id:vendor.id};validateVendor(merged);Object.assign(vendor,merged);
      for(const reqId of new Set(ws.quotes.filter(q=>q.vendorId===vendor.id).map(q=>q.requestId)))invalidate(ws,reqId);
      addEvent(ws,actor,'Vendor evidence updated',`${vendor.name}; affected recommendations require fresh review.`,null);break;
    }
    default: throw new Error('Unknown workspace action.');
  }
  ws.revision=original.revision+1;
  return ws;
}
function validateVendor(v: Vendor){
  requireValue(clean(v.name,200)&&clean(v.category,150),'Vendor name and category are required.');
  requireValue(!v.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email),'Vendor email is invalid. It is stored for reference only; RFQs still go to internal test inboxes.');
  if(v.performance){const p=v.performance;requireValue(Number.isFinite(p.quality)&&p.quality>=0&&p.quality<=100&&Number.isFinite(p.delivery)&&p.delivery>=0&&p.delivery<=100,'Quality and delivery scores must be between 0 and 100.');requireValue(Number.isInteger(p.disputes)&&p.disputes>=0&&Number.isInteger(p.completedOrders)&&p.completedOrders>0,'Record a positive number of completed orders and a non-negative dispute count.');requireValue(clean(p.notes),'Add the source / evidence behind performance scores.');}
}

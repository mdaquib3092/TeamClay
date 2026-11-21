// Shared by the case worker and the anonymous, stateless sample calculator.
export const formatMoney = paise => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
export const unit = s => ({ bags: "bag", packs: "pack", tonnes: "mt", tonne: "mt", tons: "mt", litres: "ltr", pieces: "nos" }[s.toLowerCase()] || s.toLowerCase());

export function authoredReply(text){
  const lines=String(text||"").replace(/\r\n?/g,"\n").split("\n"),kept=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(/^>/.test(line)||/^[-_]{3,}\s*(?:Original|Forwarded) message/i.test(line)||
       (/^On\s/i.test(line)&&lines.slice(i,i+3).some(s=>/\bwrote:\s*$/i.test(s))))break;
    kept.push(lines[i]);
  }
  return kept.join("\n").trim();
}
function inr(text,digits){
  let s=String(text||"").trim();
  const currency=/(?:INR|Rs\.?|₹)/i;
  if(new RegExp("^"+currency.source,"i").test(s))s=s.replace(new RegExp("^"+currency.source+"\\s*","i"),"");
  else s=s.replace(new RegExp("\\s*"+currency.source+"$","i"),"");
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/.test(s))return null;
  s=s.replaceAll(",","");
  return s.split(".")[0].length<=digits?Math.round(Number(s)*100):null;
}
export function parseTerms(text, scopeLines) {
  const fields = new Map(), flags = [], rates = {};
  for (const line of authoredReply(text).split(/[\n|;]/).map(x => x.trim()).filter(Boolean)) {
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
    const m = /^(.+?)\s*(?:\/\s*|\bper\s+)([a-z0-9]+)$/i.exec(fields.get(l.code) || "");
    const rate=m?inr(m[1],7):null;
    if (rate==null || rate<=0 || unit(m[2]) !== l.unit) { flags.push(`${l.code} ex-GST rate per ${l.unit}`); continue; }
    rates[l.code] = rate;
    base += Math.round(l.qty * rates[l.code]);
  }
  const g = /^(\d{1,3}(?:\.\d{1,2})?)\s*%$/.exec(fields.get("GST") || "");
  const gst = g && Number(g[1]) <= 100 ? Number(g[1]) : null;
  const freight = inr(fields.get("FREIGHT"),8);
  const d = /^(\d{1,3})\s*(?:days?)?$/i.exec(fields.get("DELIVERY") || "");
  const days = d ? Number(d[1]) : null, payment = fields.get("PAYMENT") || "", exclusions = fields.get("EXCLUSIONS") || "", spec = fields.get("SPEC") || "";
  if (gst == null) flags.push("GST %"); if (freight == null) flags.push("lump-sum freight"); if (days == null) flags.push("delivery days");
  if (!payment || /<|unknown|discuss|not specified|\btb[dc]\b/i.test(payment)) flags.push("agreed payment terms");
  if (!/^(?:none|nil|no exclusions)\.?$/i.test(exclusions)) flags.push("missing exclusions or scope deviation");
  if (!/^(?:exact|exact match|as specified)\.?$/i.test(spec)) flags.push("exact grade/spec confirmation");
  const tax = flags.length ? null : Math.round((base + freight) * gst / 100);
  return { rates, gst, freight, days, payment, exclusions, spec, flags, base, tax, landed: tax == null ? null : base + freight + tax };
}

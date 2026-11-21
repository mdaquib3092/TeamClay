import {authoredReply} from "./quote-terms.mjs";

const canonical=s=>s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export const comparable=v=>v?.terms?.landed!=null&&!v.terms.flags?.length&&!v.sourceFlags?.length;
// An optimistic calendar comparison, not a shipping commitment. Anchor to
// the quote's saved Kolkata business date, rather than the day a report opens.
export function deliveryWindow(received,days,needBy){
  const day=86400000,due=Date.parse(needBy);
  if(!Number.isSafeInteger(received)||!Number.isInteger(days)||days<0||!Number.isFinite(due))return null;
  const arrival=(Math.floor((received+19800000)/day)+days)*day;
  const margin=(due-arrival)/day;
  return `if ordered on reply date: ${new Date(arrival).toISOString().slice(0,10)} (${margin===0?"on need-by date":`${Math.abs(margin)} ${Math.abs(margin)===1?"day":"days"} ${margin<0?"late":"before need-by"}`})`;
}

// Only an explicit sign-off naming another invited company is a conflict.
// Common prices, the greeting, or names in the buyer's quoted RFQ do not
// establish authorship. Gmail thread and sender attribution never change.
export function attribution(body,vendor,invited){
  const lines=authoredReply(body).split("\n").map(s=>s.trim()).filter(Boolean);
  const closing=lines.findLastIndex(s=>/^(?:(?:kind|best|warm)\s+regards|regards|thanks(?: and regards)?|sincerely|best wishes|yours sincerely)[,!:. -]*$/i.test(s));
  const signature=closing<0?[]:lines.slice(closing+1,closing+5);
  const declarations=lines.map(s=>/^(?:quoting company|supplier name)\s*:\s*(.+)$/i.exec(s)?.[1]).filter(Boolean);
  let confirmsOwn=false;
  for(const line of [...signature,...declarations]){
    const clean=canonical(line).replace(/^(?:the |team )/,"").replace(/ team$/,"").trim();
    if(clean===canonical(vendor.vendor_name))confirmsOwn=true;
    const other=invited.find(x=>x.vendor_id!==vendor.vendor_id&&clean===canonical(x.vendor_name));
    if(other)return {signature:line,confirmsOwn:false,sourceFlags:[`The reply in ${vendor.vendor_id}'s thread is ${signature.includes(line)?"signed":"attributed to"} “${line}”, naming ${other.vendor_id} (${other.vendor_name}). Ask ${vendor.vendor_id} to confirm authorship and restate its full quote in its own RFQ thread.`]};
  }
  return {signature:signature[0]||declarations[0]||null,confirmsOwn,sourceFlags:[]};
}
export function sourceReview(newestFirst,vendor,invited){
  let latestSignature=null;
  for(const [index,r] of newestFirst.entries()){
    const e=attribution(r.body,vendor,invited);
    if(index===0)latestSignature=e.signature;
    if(e.sourceFlags.length)return {signature:latestSignature,sourceFlags:index===0?e.sourceFlags:
      [`An earlier reply in ${vendor.vendor_id}'s thread named another invited supplier (“${e.signature}”). The latest reply does not resolve this. Ask for the full quotation signed by ${vendor.vendor_name}, or with “Quoting company: ${vendor.vendor_name}”.`]};
    if(e.confirmsOwn)break;
  }
  return {signature:latestSignature,sourceFlags:[]};
}

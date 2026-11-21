import {linesForQuote} from "./boq.mjs";
import {authoredReply} from "./quote-terms.mjs";

// Read only supplier-authored text. A real (even incomplete) quotation stays
// in the normal review pipeline; a question alone must not replace an offer.
export function vendorQuestion(body){
  const s=authoredReply(body).slice(0,5000);
  if(!s||/(?:^|[\n|;])\s*(?:MAT\d+|GST|Freight|Delivery|Payment(?: terms)?|Exclusions?|Specs?)\s*[:=]\s*\S/im.test(s)||
    /\b(?:our|my)\s+(?:rate|price|quote|offer)\s+(?:is|for)|\bwe (?:quote|offer)\s+(?:at|₹|inr|\d)/i.test(s))return null;
  if(/(?:^|\n)\s*(?:help|quote help)\s*[.!?]?\s*(?:\n|$)/i.test(s)||
    /\b(?:how (?:do|can|should|to)|which fields|what (?:is the|quotation|quote)|please (?:send|share|provide))\b.{0,85}\b(?:quote|quotation|reply|respond|format|template)\b/i.test(s))return "format";
  if(/\?|\b(?:please clarify|please confirm whether|clarification requested)\b/i.test(s))return "question";
  return null;
}
export function vendorHelpBody(c,inv){
  const lines=linesForQuote(c);
  return `Hello ${inv.vendor_name},\n\nTo quote for ${c.id} / ${inv.vendor_id}, reply to this email from your invited address. Your BOQ:\n`+
    lines.map(l=>`${l.code} — ${l.name}, ${l.spec}: ${l.qty} ${l.unit}`).join("\n")+
    `\nDeliver to ${c.scope.site}, ${c.scope.address}. Needed ${c.scope.needBy}; quote by ${c.scope.deadline}.\n\nCopy the fields below and replace the brackets with your own terms. Enter rates excluding GST and one pre-tax freight amount for the whole BOQ. State any different tax basis or specification under Exclusions.\n`+
    lines.map(l=>`${l.code}: <INR rate> / ${l.unit}`).join("\n")+
    `\nGST: <percentage>%\nFreight: <INR amount, 0 if included>\nDelivery: <number> days\nPayment: <terms>\nExclusions: <none or list>\nSpec: <exact or describe deviation>\nQuoting company: ${inv.vendor_name}\n\nFor a site or commercial clarification, ask the project manager in this thread. This invitation is not an order.`;
}

import {createHash} from "node:crypto";
import {CaseInputError,linesForQuote} from "./boq.mjs";
import {VendorDataError} from "./vendor-data.mjs";
import {rfqMinimum} from "../roles.mjs";

const sha=s=>createHash("sha256").update(s).digest("hex");
const contact=u=>sha(JSON.stringify([u.user_id,u.project_id,u.whatsapp]));
const fingerprint=c=>sha(JSON.stringify([c.id,c.boq_rev,c.scope_json,rfqMinimum(c.project_id,c.demo)]));
const confirmed=/^(?:yes[, ]+(?:please )?(?:send|email|dispatch)(?: it| them| the rfqs?| the emails?)?|approve (?:and|&) send|confirm dispatch)[.! ]*$/i;
const help=/\b(?:rfqs?|requests? for quot(?:e|ation)s?)\b|\b(?:send|email|dispatch|invite|contact|forward)\b.{0,55}\b(?:the (?:it|draft)|vendors?|suppliers?|emails?|it|them)\b|\b(?:how|where|can i|help)\b.{0,70}\b(?:approve|approval|dashboard)\b|\b(?:approve|approval|review)\b.{0,75}\b(?:dashboard|draft|email|dispatch|pending|requirement|request)\b|\b(?:pending|review)\s+(?:cases?|drafts?)\b|भेज|भेजें|পাঠা/i;
const receipts=/\b(?:receipt|delivery status|sent|did .*receive|which .*received|were .*emailed)/i;
const vendorHelp=/\b(?:how|what|help|format|template)\b.{0,80}\b(?:repl(?:y|ies)|respond|quote template|quotation format)\b/i;
const vendorDecision=/\b(?:recommendation|work order|payment approval|award|approve (?:the )?(?:rates?|vendor selection))\b/i;
const caseRef=/\bCASE-[A-F0-9]{12}\b/ig;
const normal=s=>s.normalize("NFKC").replace(/[’‘]/g,"'").trim();
const ageLimit=30*60*1000;
const states={accepted:"Gmail accepted",queued:"Queued for Gmail",sending:"Send in progress",unconfirmed:"Acceptance unconfirmed — check Gmail Sent",held:"Held — check the vendor contact",superseded:"Superseded",failed:"Send failed"};

export function dispatchReceipts(flow,c){
  return flow.all(`SELECT m.vendor_id AS target,m.vendor_name AS name,m.email,o.state,o.accepted
    FROM wa_flow_mail m LEFT JOIN wa_flow_outbox o ON o.case_id=m.case_id AND o.target=m.vendor_id AND o.kind='email'
    WHERE m.case_id=? ORDER BY m.vendor_id`,c.id).map(r=>({...r,label:states[r.state]||"No receipt"}));
}
export function receiptText(flow,c){
  const rows=dispatchReceipts(flow,c);
  if(!rows.length)return `${c.id} · no vendor email has been sent.`;
  return `${c.id} B${c.boq_rev} · ${rows.filter(v=>v.state==="accepted").length}/${rows.length} RFQs accepted by Gmail.\n`+
    rows.map(v=>`${v.target} ${v.name}: ${v.label}${v.accepted?" · "+new Date(v.accepted).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit"})+" IST":""}`).join("\n");
}
export class PmDispatch {
  constructor(flow){this.flow=flow;}
  prompt(c,user){
    const f=this.flow,gate=f.readiness(c),first=user.name.split(/\s+/)[0];
    const who=c.scope.vendors.map(v=>`• ${v.id} ${v.name} <${v.email}>`).join("\n");
    const boq=linesForQuote(c).map(l=>`${l.qty} ${l.unit} ${l.name} (${l.code})`).join("; ");
    return `${first}, you approve sending this RFQ. The HOD reviews vendor selection after quotations arrive.\n`+
      `${c.id} · B${c.boq_rev} · ${boq}\n${c.scope.project} · ${c.scope.site}; needed ${c.scope.needBy}; quotes by ${c.scope.deadline}.\n`+
      `Recipients (${c.scope.vendors.length}; minimum ${gate.minimum}):\n${who||"None configured."}\n`+
      (gate.ready?`${f.pmLinks?"Open your private page, review the drafts, tick the confirmation and tap “Approve & send”.":"Review each draft with PREVIEW "+c.id+" B"+c.boq_rev+" <vendor ID>."} To approve all the listed recipients in this chat, type “Yes send it”.`:
      `Not ready to send: ${gate.reason} You can still inspect the drafts.`);
  }
  accepted(c,u,id,ready,at){
    const f=this.flow;
    f.run("DELETE FROM wa_pm_dispatch_offers WHERE actor=?",u.user_id);
    if(!ready)return;
    f.run("INSERT INTO wa_pm_dispatch_offers VALUES(?,?,?,?,?,?,?)",u.user_id,contact(u),c.id,c.boq_rev,fingerprint(c),id,at);
  }
  invite(c,u,source,selected=false){
    const f=this.flow,prefix=`dispatch-guide:${selected?"selected:":""}`,recent=f.one(`SELECT id FROM wa_flow_outbox o WHERE case_id=? AND role='project_manager' AND required_stage='BOQ_REVIEW'
      AND boq_rev=? AND id LIKE ? AND (state IN('queued','sending') OR (state='accepted' AND accepted>? AND EXISTS
        (SELECT 1 FROM wa_pm_dispatch_offers x WHERE x.actor=? AND x.contact=? AND x.fingerprint=? AND x.outbox_id=o.id))) LIMIT 1`,
      c.id,c.boq_rev,`${c.id}:${prefix}%`,new Date(Date.now()-45000).toISOString(),u.user_id,contact(u),fingerprint(c));
    if(!recent)f.notify(c,prefix+source,"project_manager",this.prompt(c,u),null,"BOQ_REVIEW");
    return recent?`Use the latest dispatch review for ${c.id} in this chat.`:`${u.name.split(/\s+/)[0]}, your dispatch review for ${c.id} is queued in this chat.`;
  }
  handle(msg,user,users){
    if(user.role!=="project_manager"||!["text","voice"].includes(msg.channel)||!msg.id)return null;
    const u=users.get(user.whatsapp.slice(1)),f=this.flow;
    if(!u||u.user_id!==user.user_id||u.project_id!==user.project_id||u.role!==user.role||f.pauseCheck(u.user_id))return null;
    const saved=f.one("SELECT reply FROM wa_flow_commands WHERE id=? AND actor=?",msg.id,u.user_id);
    if(saved)return saved.reply;
    const txt=normal(msg.user_text).slice(0,4000),refs=[...new Set((txt.match(caseRef)||[]).map(s=>s.toUpperCase()))],yes=confirmed.test(txt);
    if(vendorDecision.test(txt)||!(yes||help.test(txt)||receipts.test(txt)||vendorHelp.test(txt)||refs.length&&txt.toUpperCase()===refs[0])){
      // A later unqualified “yes” must not respond to an unrelated chat.
      f.run("DELETE FROM wa_pm_dispatch_offers WHERE actor=?",u.user_id);return null;
    }
    try{return f.tx(()=>{
      const record=(reply,c=null)=>{
        f.run("INSERT INTO wa_flow_commands(id,actor,case_id,reply) VALUES(?,?,?,?)",msg.id,u.user_id,c?.id||null,reply);
        if(c)f.event(c,"whatsapp","inbound",u.user_id,"agent",{action:"pm_dispatch_assistance",messageId:msg.message_id||msg.id,channel:msg.channel,text:txt},"recorded");
        return reply;
      };
      const owned=id=>{const c=f.get(id);return c?.pm_id===u.user_id&&c.project_id===u.project_id?c:null;};
      if(refs.length>1)return record("Which single case should we review? Reply with its CASE ID.");
      let c=refs.length?owned(refs[0]):null;
      if(refs.length&&!c)return record("No RFQ with that reference is assigned to you.");
      const pending=f.all("SELECT id FROM wa_flow_cases WHERE pm_id=? AND project_id=? AND stage='BOQ_REVIEW' ORDER BY created DESC",u.user_id,u.project_id).map(r=>f.get(r.id));
      const list=rows=>rows.slice(0,12).map(x=>`${x.id} B${x.boq_rev} · ${x.scope.segment} · ${x.scope.site}`).join("\n");
      const offer=f.one("SELECT * FROM wa_pm_dispatch_offers WHERE actor=?",u.user_id);
      const explicitlySelected=offer?.outbox_id.includes(":dispatch-guide:selected:");
      const at=msg.received_at?Date.parse(msg.received_at):Date.now();
      if(!c&&receipts.test(txt)&&!yes){
        const issued=f.all(`SELECT DISTINCT c.id,c.created FROM wa_flow_cases c JOIN wa_flow_mail m ON m.case_id=c.id
          WHERE c.pm_id=? AND c.project_id=? ORDER BY c.created DESC LIMIT 12`,u.user_id,u.project_id).map(r=>f.get(r.id));
        if(issued.length!==1)return record(issued.length?`Which dispatched RFQ? Reply “receipts” and its CASE ID.\n${list(issued)}`:"No RFQ has been dispatched for your assigned cases.");
        c=issued[0];
      }
      if(!c){
        if(pending.length>1){
          if(yes&&explicitlySelected)c=pending.find(r=>r.id===offer.case_id);
          if(!c){f.run("DELETE FROM wa_pm_dispatch_offers WHERE actor=?",u.user_id);return record(`Which RFQ should we send? Reply with one CASE ID.\n${list(pending)}`);}
        }
        if(!pending.length)return record("You have no RFQs awaiting dispatch approval. Ask “receipts” with the case ID to check an earlier dispatch.");
        c??=pending[0];
      }
      if(vendorHelp.test(txt)&&!yes)return record(`Each vendor should use Reply in its own ${c.id} RFQ email. Copy the quotation fields, enter ex-GST unit rates, GST %, one pre-tax freight amount, delivery days, payment, exclusions and spec, then sign with its own company name. To ask a question, reply in that same thread.`,c);
      if(c.stage!=="BOQ_REVIEW"||receipts.test(txt)&&!yes)return record(receiptText(f,c),c);
      const hasOffer=offer&&offer.contact===contact(u)&&offer.case_id===c.id&&offer.boq_rev===c.boq_rev&&offer.fingerprint===fingerprint(c)&&
        Number.isFinite(at)&&Math.floor(at/1000)>=Math.floor(Date.parse(offer.accepted)/1000)&&Date.now()-Date.parse(offer.accepted)<=ageLimit;
      if(yes&&msg.channel==="text"&&hasOffer&&(pending.length===1||explicitlySelected)){
        const ids=c.scope.vendors.map(x=>x.id);
        const result=f.dispatch(c,u,[`B${c.boq_rev}`,...ids],"whatsapp");
        f.event(c,"whatsapp","inbound",u.user_id,"agent",{action:"confirm_rfq_dispatch",channel:"text",revision:c.boq_rev,vendors:ids,
          snapshot:offer.fingerprint,reviewNotice:offer.outbox_id,messageId:msg.message_id||msg.id},"confirmed");
        return record(result,c);
      }
      if(yes&&msg.channel==="voice"&&hasOffer)return record(`Voice notes can request a review. To send these ${c.scope.vendors.length} emails for ${c.id}, tap “Approve & send” or type “Yes send it”.`,c);
      return record(this.invite(c,u,msg.id,!!refs.length),c);
    });}catch(e){if(e instanceof CaseInputError||e instanceof VendorDataError)return e.message;throw e;}
  }
}

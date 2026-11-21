import { catalogVendors, VendorDataError, vendorSourceStatus } from "./vendor-data.mjs";
import { SAMPLE } from "./boq.mjs";
import { ROLE_POLICY } from "../roles.mjs";
import { samples } from "./samples.mjs";

// A read model over the running worker's very same case DB. Public fields only:
// no OAuth tokens, private conversations, raw mail headers or provider payloads.
export function caseDetails(flow, c) {
  const mail = flow.all(`SELECT m.vendor_id,m.poll_error,o.state,o.accepted,rr.replied_at,
    (SELECT count(*) FROM wa_flow_replies r WHERE r.case_id=m.case_id AND r.vendor_id=m.vendor_id) reply_count
    FROM wa_flow_mail m LEFT JOIN wa_flow_outbox o ON o.case_id=m.case_id AND o.kind='email' AND o.target=m.vendor_id
    LEFT JOIN rfq_recipients rr ON rr.rfq_id=m.rfq_id AND rr.vendor_id=m.vendor_id
    WHERE m.case_id=? ORDER BY m.vendor_id`,c.id);
  const snapshot = JSON.parse(flow.comparison(c) || "[]");
  const recipients = mail.length ? mail.map(row => c.scope.vendors.find(v => v.id === row.vendor_id)) : c.scope.vendors;
  const hod = flow.all(`SELECT quote_rev,state,created,accepted,error,json_extract(payload,'$.text') text FROM wa_flow_outbox
    WHERE case_id=? AND kind='whatsapp' AND role='hod' ORDER BY rowid DESC LIMIT 12`,c.id);
  const decisions = flow.all(`SELECT stage,user_id,status,vendor_id,note,decided_at FROM approvals
    WHERE requirement_id=? ORDER BY id DESC LIMIT 12`,c.id);
  const staffMessages = flow.all(`SELECT at,from_id,json_extract(body,'$.text') text FROM messages
    WHERE requirement_id=? AND channel='whatsapp' AND direction='inbound' AND json_valid(body)
    ORDER BY id DESC LIMIT 40`,c.id).reverse();
  return {
    id:c.id, demo:!!c.demo, created:c.created, stage:c.stage, project:c.scope.project, site:c.scope.site, segment:c.scope.segment,
    neededBy:c.scope.needBy, deadline:c.scope.deadline, boqRev:c.boq_rev, quoteRev:c.quote_rev,
    owner:c.owner_id, pm:c.pm_id, hod:c.hod_id, selected:c.selected, rationale:c.rationale, lines:c.scope.lines,
    submission:flow.one("SELECT raw_message FROM requirements WHERE requirement_id=?",c.id)?.raw_message,
    review:flow.one("SELECT json_extract(payload,'$.text') text FROM wa_flow_outbox WHERE id=?",`${c.id}:review:B${c.boq_rev}`)?.text || null,
    vendors:recipients.map(v => {
      const m = mail.find(x => x.vendor_id === v.id), q = snapshot.find(x => x.id === v.id);
      return { id:v.id,name:v.name,email:v.email,delivery:m?.state || "not_sent",accepted:m?.accepted || null,
        replied:m?.replied_at || null,replyCount:m?.reply_count || 0,pollError:m?.poll_error || null,
        terms:q?.terms || null,history:q?.history || null,draft:c.scope.drafts?.[v.id] || null,
        reply:q?.source ? flow.one("SELECT substr(body,1,8000) text FROM wa_flow_replies WHERE gmail_id=? AND case_id=? AND vendor_id=?",q.source,c.id,v.id)?.text || null : null };
    }),
    report:snapshot.length ? flow.analysis(c,snapshot) : null, hodMessages:hod, decisions,staffMessages,
  };
}
export function liveBoard(flow, users) {
  const sources = vendorSourceStatus(flow.root);
  const guides = samples.map(s => {
    let vendors = [];
    try { vendors = catalogVendors(flow.root,s.key); }
    catch (error) { if (!(error instanceof VendorDataError)) throw error; }
    return { key:s.key,label:s.label,title:s.title,starter:s.starter,
      invites:s.vendors.map((id,i)=>({id,contact:vendors.find(v=>v.id===id)||null,reply:s.replies[i]})) };
  });
  return { generatedAt:new Date().toISOString(), database:"TeamClay/clay.db", sources,
    sample:SAMPLE,samples:guides,minimumQuotes:ROLE_POLICY.controls.minimumReviewedComparableQuotations,
    demoMinimum:2, standardMinimum:ROLE_POLICY.controls.minimumEligibleRfqVendors, workerError:flow.lastError,
    staff:[...users.values()].map(u=>({id:u.user_id,name:u.name,role:u.role,project:u.project_id,ending:u.whatsapp.slice(-4)})),
    cases:flow.all("SELECT id FROM wa_flow_cases ORDER BY created DESC,id DESC LIMIT 30").map(row=>caseDetails(flow,flow.get(row.id))) };
}

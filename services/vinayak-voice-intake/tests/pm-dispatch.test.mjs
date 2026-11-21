import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {PmApproval} from "../src/cloud/pm-approval.mjs";
import {RfqMailbox} from "../src/procurement/mail.mjs";
import {rfqMinimum,assertWorkflowAction} from "../src/roles.mjs";
import {buildRawMessage} from "../../vinayak-procurement/integrations/gmail/client.mjs";

const team=["site_engineer","project_manager","hod"].map((role,i)=>({user_id:"U"+i,name:["Site Engineer","Assigned PM","Hod Reviewer"][i],
  role,project_id:i===2?"ALL":"PRJ-AMARA",whatsapp:`+1202555010${i+1}`}));
const starter="RFQ | MAT010 14 bags | East gate | need +5 | reply +2";
function fixture(t){const f=rehearsal({team:structuredClone(team)});t.after(()=>f.close());
  f.flow.pmLinks=new PmApproval(f.flow,{users:()=>f.users,secret:"fixture"});return f;}
const open=async f=>(await f.command(f.site,starter)).match(/CASE-[A-F0-9]+/)[0];
test("Amara standard RFQ: the PM hears guidance by voice, approves a bound dispatch by text, and sees Gmail receipts by vendor",async t=>{
  const f=fixture(t),id=await open(f);assert.equal(f.flow.get(id).demo,0);
  assert.equal(rfqMinimum("PRJ-AMARA"),2);assert.equal(rfqMinimum("ANOTHER"),3);
  const approval={id,project_id:"PRJ-AMARA",revision:1,boq_reviewed:true,erp_mapping_reviewed:true,duplicate_questions_resolved:true,
    rfq_vendors:["V05","V06"].map(id=>({id,eligible:true,eligibility_evidence:"reviewed cement supplier"}))};
  assert.ok(assertWorkflowAction(f.pm,"dispatch_rfq",approval,{confirmed:true,actor_user_id:f.pm.user_id,route:"verified_whatsapp_text",expected_revision:1}));
  assert.throws(()=>assertWorkflowAction(f.pm,"dispatch_rfq",{...approval,rfq_vendors:approval.rfq_vendors.slice(1)},{confirmed:true,actor_user_id:f.pm.user_id,route:"verified_whatsapp_text",expected_revision:1}),/At least 2/);
  assert.match(await f.command(f.pm,"How can I approve it on the dashboard?","voice"),/dispatch review/);
  assert.equal(f.emails.length,0);await f.flush();const prompt=f.alerts.at(-1).text;
  assert.match(prompt,/you approve sending this RFQ/);assert.ok(["V05","V06",id,"minimum 2","#review="].every(w=>prompt.includes(w)));
  assert.match(await f.command(f.pm,"Yes send it","voice"),/Voice notes/);assert.equal(f.emails.length,0);
  const yes=await f.command(f.pm,"Yes, send it","text","pm-confirm"),again=await f.command(f.pm,"Yes, send it","text","pm-confirm");assert.equal(again,yes);
  assert.match(yes,/Queued 2/);await f.flush();
  assert.deepEqual(f.emails.map(e=>e.to),["a@example.test","b@example.test"]);assert.ok(f.emails.every(e=>e.text.includes("14 bag")&&e.text.includes("Quoting company:")&&e.text.includes("HELP")));
  assert.equal(f.flow.get(id).stage,"AWAITING_QUOTES");assert.match(f.alerts.at(-1).text,/2\/2 RFQs accepted by Gmail/);
  assert.match(await f.command(f.pm,`receipts ${id}`),/V05.*accepted[\s\S]+V06.*accepted/);
  await f.command(f.pm,"Yes send it");await f.flush();assert.equal(f.emails.length,2);
});
test("generic assent cannot be replayed, applied to another BOQ or phone, or guessed between multiple cases",async t=>{
  const f=fixture(t),a=await open(f),b=await open(f);await f.flush();
  assert.match(await f.command(f.pm,"Yes send it"),/Which RFQ/);assert.equal(f.emails.length,0);
  await f.command(f.pm,b);await f.flush();
  const offer=f.flow.one("SELECT * FROM wa_pm_dispatch_offers WHERE actor=?",f.pm.user_id);
  assert.equal(offer.case_id,b);
  const stale=await f.flow.handle({id:"old",message_id:"old",user_text:"Yes send it",channel:"text",received_at:new Date(Date.parse(offer.accepted)-120000).toISOString()},f.pm,f.users);
  assert.doesNotMatch(stale,/Queued 2 individual/);assert.equal(f.emails.length,0);
  await f.flush();await f.command(f.pm,b);await f.flush();await f.command(f.pm,"Yes send it");await f.flush();
  assert.equal(f.flow.get(a).stage,"BOQ_REVIEW");assert.equal(f.flow.get(b).stage,"AWAITING_QUOTES");assert.equal(f.emails.length,2);
  await f.command(f.pm,"Help me send the RFQ");await f.flush();
  const contact=f.pm.whatsapp;f.pm.whatsapp="+12025550189";assert.equal(await f.command(f.pm,"Yes send it"),null);f.pm.whatsapp=contact;
  await f.command(f.site,`CORRECT ${a} B1 | MAT010 19 bags | East gate | need +6 | reply +2`);
  const q=await f.command(f.pm,"Yes send it");assert.doesNotMatch(q,/Queued 2 individual/);assert.equal(f.flow.get(a).stage,"BOQ_REVIEW");
  assert.equal(await f.command(f.hod,"Yes send it"),null);
});
test("PM page enforces the project minimum, the selected inboxes and current contact data on the server",async t=>{
  const f=fixture(t),file=path.join(f.flow.root,"data/vendors.csv");
  fs.appendFileSync(file,"V07,Other Cement,cement,extra@example.test\n");const id=await open(f);await f.flush();
  const pm=f.flow.pmLinks,s=pm.exchange(id,f.alerts[0].text.match(/#review=([a-f0-9]{64})/)[1]),view=pm.view(id,s);
  assert.deepEqual(view.gate,{ready:true,minimum:2,count:3});
  const confirm=vendorIds=>pm.approve(id,s,{revision:1,confirm:true,snapshot:view.snapshot,vendorIds});
  assert.throws(()=>confirm(["V05"]),/at least 2/);assert.throws(()=>confirm(["V05","V05"]),/distinct/);assert.throws(()=>confirm(["V05","V00"]),/reviewed RFQ/);
  const csv=fs.readFileSync(file,"utf8");fs.writeFileSync(file,csv.replace("Other Cement,cement,extra@","Other Cement,cement,changed@"));
  assert.throws(()=>confirm(["V05","V07"]),/contact changed/);fs.writeFileSync(file,csv);
  confirm(["V06","V07"]);await f.flush();assert.deepEqual(f.emails.map(e=>e.to),["b@example.test","extra@example.test"]);
  assert.deepEqual(pm.view(id,s).receipts.map(x=>[x.target,x.label]),[["V06","Gmail accepted"],["V07","Gmail accepted"]]);
});
test("vendor HELP is confined to its thread and does not replace a quote; a commercial question reaches the PM",async t=>{
  const f=fixture(t),id=await open(f);await f.command(f.pm,`SEND ${id} B1 V05 V06`);await f.flush();
  const inv=f.flow.one("SELECT * FROM wa_flow_mail WHERE case_id=? AND vendor_id='V05'",id),helps=[];
  f.mailbox.help=async(v,source,text)=>{helps.push({to:v.email,thread:v.thread_id,source,text});return {sent:true,messageId:"helpout",threadId:v.thread_id};};
  const messages=f.inbox.get(inv.thread_id)||[];f.inbox.set(inv.thread_id,messages);
  messages.push({id:"offer",threadId:inv.thread_id,received:10,text:"MAT010: 300/bag | GST: 18% | Freight: 0 | Delivery: 3 days | Payment: Net 10 | Exclusions: none | Spec: exact"});
  await f.flow.refresh(inv);await f.flush();const snap=f.flow.comparison(f.flow.get(id));
  messages.push({id:"helpme",threadId:inv.thread_id,received:20,text:"HELP\n\nOn Thursday, the buyer wrote:\n> Freight: 800"});
  await f.flow.refresh(inv);await f.flush();await f.flow.refresh(inv);await f.flush();
  assert.equal(helps.length,1);assert.equal(helps[0].thread,inv.thread_id);assert.equal(helps[0].to,inv.email);
  assert.ok(helps[0].text.includes("14 bag")&&helps[0].text.includes("Quoting company: "+inv.vendor_name));assert.doesNotMatch(helps[0].text,/V06|b@example.test|300\/bag/);
  messages.push({id:"question",threadId:inv.thread_id,received:30,text:"Can we deliver to the east gate after 6 pm?"});await f.flow.refresh(inv);await f.flush();
  assert.ok(f.alerts.some(a=>a.role==="project_manager"&&a.text.includes("after 6 pm")));assert.equal(helps.length,1);
  assert.equal(f.flow.comparison(f.flow.get(id)),snap);assert.equal(f.flow.get(id).quote_rev,1);assert.equal(f.emails.length,2);
});
test("Gmail vendor-help replies require the original sent anchor and the invited human sender",async()=>{
  const inv={email:"supplier@example.test",thread_id:"thread",gmail_id:"anchor"};const args=[];
  const anchor={id:"anchor",threadId:"thread",labelIds:["SENT"],payload:{headers:[{name:"Subject",value:"RFQ for an item"}]}};
  const source={id:"supplier-msg",threadId:"thread",internalDate:"100",labelIds:["INBOX"],payload:{headers:[{name:"From",value:inv.email},{name:"Message-ID",value:"<inbound@example.test>"}]}};
  const mailbox=new RfqMailbox({accessToken:async()=>"fixture",send:async(...a)=>{args.push(a);return {sent:true,threadId:"thread",messageId:"new"};}},async()=>Response.json({id:"thread",messages:[anchor,source]}));
  await mailbox.help(inv,source.id,"Quote fields");const [msg,options]=args[0];assert.equal(msg.to,inv.email);assert.equal(msg.subject,"RFQ for an item");
  const raw=Buffer.from(buildRawMessage(msg,"buyer@example.test",options.thread),"base64url").toString();
  assert.match(raw,/In-Reply-To: <inbound@example.test>\r\nReferences: <inbound@example.test>/);
  assert.throws(()=>buildRawMessage(msg,"buyer@example.test",{id:"thread",parent:"<inbound@example.test>\r\nCc: other@example.test"}));
  source.payload.headers.push({name:"Auto-Submitted",value:"auto-replied"});await assert.rejects(mailbox.help(inv,source.id,"No reply"));source.payload.headers.pop();
  source.payload.headers.push({name:"Authentication-Results",value:"mx.google.com; dmarc=fail"});await assert.rejects(mailbox.help(inv,source.id,"No reply"));source.payload.headers.pop();
  source.payload.headers[0].value="other@example.test";await assert.rejects(mailbox.help(inv,source.id,"No reply"));
  source.payload.headers[0].value=inv.email;anchor.labelIds=[];await assert.rejects(mailbox.help(inv,source.id,"No reply"));assert.equal(args.length,1);
});

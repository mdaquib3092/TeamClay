import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {CaseFlow} from "../src/procurement/flow.mjs";
import {PmApproval} from "../src/cloud/pm-approval.mjs";
import {logistics,indiaDay,suggestedDeadline} from "../src/procurement/order-fields.mjs";

const fixture=t=>{const f=rehearsal();t.after(()=>f.close());return f;};
const cases=f=>f.flow.all("SELECT id FROM wa_flow_cases ORDER BY rowid").map(row=>f.flow.get(row.id));
test("ambiguous spoken count → one short question per missing field → actual persisted drafts on the PM's private review link",async t=>{
  const f=fixture(t),pm=f.flow.pmLinks=new PmApproval(f.flow,{users:()=>f.users,secret:"test-only"});
  const turn=(s,ch="text",id)=>f.command(f.site,s,ch,id);
  const spoken="Please order nine PPC twelve bags.",q=await turn(spoken,"voice","voice-1");
  assert.match(q,/9 or 12/);assert.equal(q.split("?").length,2);assert.equal(await turn(spoken,"voice","voice-1"),q);
  assert.match(await turn("10 bags"),/Where on site/);
  assert.match(await turn("Tower 2"),/When do you need/);
  assert.equal(await f.command(f.pm,"tomorrow"),null);
  assert.equal(await turn("What is the stock of PPC?"),null); // goes to stock/chat, preserves draft.
  const recap=await turn("in five days, vendor replies by tomorrow");
  assert.match(recap,/need 10 bags, stock 0, RFQ 10/);assert.match(recap,/tower 2/);assert.match(recap,/for RFQ review/);
  assert.equal(cases(f).length,0);await f.flush();assert.equal(f.alerts.length,0);
  const receipt=await turn("yes, send it","voice","accepted"),id=receipt.match(/CASE-[A-F0-9]+/)[0];
  assert.equal(await turn("yes, send it","voice","accepted"),receipt);
  assert.equal(cases(f).length,1);const c=f.flow.get(id);assert.equal(c.demo,0);assert.equal(c.stage,"BOQ_REVIEW");
  assert.equal(c.scope.lines[0].requested,10);assert.equal(c.scope.deadline,suggestedDeadline(indiaDay(Date.now()),c.scope.needBy));
  await f.flush();assert.equal(f.emails.length,0);assert.equal(f.alerts.length,1);assert.equal(f.alerts[0].role,"project_manager");
  const token=pm.exchange(id,f.alerts[0].text.match(/#review=([a-f0-9]{64})/)[1]);const view=pm.view(id,token);
  assert.equal(view.drafts.length,2);for(const d of view.drafts){assert.ok(d.text.includes("10 bag")&&d.text.includes(id+" / "+d.id));}
  assert.ok(view.boq.includes(spoken)&&view.boq.includes("Tower 2"));
  assert.throws(()=>pm.approve(id,token,{confirm:true,snapshot:view.snapshot,revision:view.revision}),/at least 3/);
  assert.equal(f.flow.one("SELECT COUNT(*) n FROM wa_flow_outbox WHERE kind='email'").n,0);
  assert.equal(f.flow.one("SELECT COUNT(*) n FROM wa_site_drafts").n,0);
});
test("one message can fill a mixed BOQ; changed stock requires a fresh recap before the handoff",async t=>{
  const f=fixture(t),turn=s=>f.command(f.site,s),file=path.join(f.flow.root,"data/stock.csv");
  const r=await turn("Please order 36 packs MAT020 and 4 mt MAT004 for the basement in 6 days, quotes by tomorrow. Note: include batch certificates.");
  assert.match(r,/stock 12, RFQ 24/);assert.match(r,/stock 0, RFQ 4/);assert.match(r,/batch certificates/);
  fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace('"MAT020","12"','"MAT020","16"'));
  assert.match(await turn("confirm"),/BOQ changed[\s\S]*RFQ 20/);assert.equal(cases(f).length,0);
  const result=await turn("yes");assert.equal(result.match(/CASE-/g).length,2);
  const records=cases(f);assert.deepEqual(records.map(c=>c.scope.segment),["waterproofing","steel"]);
  assert.deepEqual(records.map(c=>c.scope.lines[0].qty),[20,4]);assert.ok(records.every(c=>Object.values(c.scope.drafts).every(d=>d.text.includes(c.id)&&d.text.includes("include batch certificates"))));
  await f.flush();assert.equal(f.alerts.filter(a=>a.role==="project_manager").length,2);assert.equal(f.emails.length,0);
});
test("restarts, sender scope, unconvertible units, cancellation and stock-covered requirements",async t=>{
  const f=fixture(t);const turn=s=>f.command(f.site,s);
  assert.equal(await turn("If I need 2 packs of coating, how much stock is available?"),null);
  assert.equal(await f.command(f.hod,"Please order 20 bags of PPC cement"),null);
  assert.match(await turn("Please order 500 kg of PPC cement for Tower 2 tomorrow"),/ordered in bags/);
  const g=new CaseFlow({root:f.flow.root,db:f.db,recoverOutbox:false});
  const handle=(u,s,id)=>g.handle({id,message_id:id,user_text:s,channel:"text"},u,f.users);
  assert.equal(await handle({...f.site,whatsapp:"+12025550197"},"12 bags","other-phone"),null);
  const recap=await handle(f.site,"twelve","answer");assert.match(recap,/need 12 bags/);
  await turn("cancel");assert.equal(await turn("yes"),null);assert.equal(cases(f).length,0);
  assert.match(await turn("Need 4 packs MAT020 for the basement tomorrow"),/Stock covers/);
  await turn("yes");assert.equal(cases(f)[0].stage,"IN_STOCK");await f.flush();assert.equal(f.alerts.length,0);assert.equal(f.emails.length,0);
});
test("editing quantity, previous-item references, user-supplied dates and a standard three-vendor approval",async t=>{
  const f=fixture(t);fs.appendFileSync(path.join(f.flow.root,"data/vendors.csv"),"V07,Third Cement Supplier,cement,third@example.test\n");
  const pm=f.flow.pmLinks=new PmApproval(f.flow,{users:()=>f.users,secret:"test-only"});
  const start=await f.flow.handle({id:"first",channel:"text",user_text:"Please order 8 bags of it for the basement in one week, quotes by tomorrow"},f.site,f.users,["How much PPC cement is in stock?"]);
  assert.match(start,/PPC cement: need 8 bags/);
  assert.match(await f.command(f.site,"Actually make it 15 bags"),/need 15 bags/);
  const summary=await f.command(f.site,"yes"),id=summary.match(/CASE-[A-F0-9]+/)[0];await f.flush();
  assert.equal(f.emails.length,0);const link=f.alerts[0].text.match(/#review=([a-f0-9]{64})/)[1],s=pm.exchange(id,link),view=pm.view(id,s);
  assert.equal(view.drafts.length,3);pm.approve(id,s,{confirm:true,revision:view.revision,snapshot:view.snapshot});await f.flush();
  assert.equal(f.emails.length,3);assert.equal(f.flow.get(id).stage,"AWAITING_QUOTES");
  assert.ok(f.emails.every(m=>m.text.includes("15 bag")&&!m.subject.includes("DEMO")));
});
test("dates use the Kolkata business day and do not turn a site number into an amount",()=>{
  assert.equal(indiaDay(Date.parse("2026-12-31T20:00:00Z")),"2027-01-01");
  const a=logistics("Tower 4, delivery 2 December and quotes by 30 November","2026-11-28");
  assert.deepEqual(a.dates,{need:"2026-12-02",due:"2026-11-30"});assert.equal(a.site,"tower 4");assert.doesNotMatch(a.remaining,/\d/);
  assert.equal(logistics("deliver by 31 November","2026-11-21").issues.need,true);
});
test("an unmapped second BOQ item is not silently dropped or assigned to the first material",async t=>{
  const f=fixture(t),turn=s=>f.command(f.site,s);
  assert.match(await turn("Order 18 bags of PPC cement and anchor bolts for the basement by tomorrow"),/anchor bolts/);
  assert.equal(cases(f).length,0);
  assert.match(await turn("skip this item"),/need 18 bags/);
  await turn("yes");assert.equal(cases(f)[0].scope.lines.length,1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { rehearsal, runScenario, sampleQuotes } from "../scripts/rfq-rehearsal.mjs";
import { SAMPLE } from "../src/procurement/boq.mjs";
import { RfqMailbox } from "../src/procurement/mail.mjs";
import fs from "node:fs";
import path from "node:path";

test("WhatsApp → two demo Gmail RFQs → comparison → PM recommendation → explicit HOD decision", async()=>{
  const r=await runScenario();assert.equal(r.stage,"APPROVED");assert.deepEqual(r.comparison.map(x=>x.landedINR),[40120,38822]);
});
test("all three screen rehearsals show generated RFQs, vendor replies and an automatic HOD report before recommendation", async()=>{
  for (const [key,ids,quantities,totals] of [
    ["cement",["V05","V06"],[100],[40120,38822]],
    ["steel",["V01","V02"],[4,2],[387040,388810]],
    ["waterproofing",["V10","V16"],[20],[57820,56050]],
  ]) {
    const r=await runScenario({key});
    assert.equal(r.stage,"APPROVED");
    assert.deepEqual(r.record.vendors.map(v=>v.id),ids);
    assert.deepEqual(r.record.lines.map(l=>l.qty),quantities);
    assert.deepEqual(r.comparison.map(row=>row.landedINR),totals);
    assert.deepEqual(r.record.vendors.map(v=>v.replyCount),[1,1]);
    assert.equal(r.steps[2].items[0].text,`SEND ${r.case} B1 ${ids.join(" ")}`);
    for(const v of r.record.vendors)assert.ok(v.draft.text.includes(`${r.case} / ${v.id}`));
    assert.match(r.steps[4].items[0].text,/2\/2 vendors replied; 2 comparable/);
    assert.doesNotMatch(r.steps[4].items[0].text,/APPROVE CASE/);
    assert.match(r.steps[5].items[1].text,/APPROVE CASE/);
  }
});
test("a CSV performance edit is picked up on the next quote revision, never rewritten into the HOD's earlier report",async t=>{
  const f=rehearsal();t.after(()=>f.close());const id=/CASE-[A-F0-9]+/.exec(await f.command(f.site,SAMPLE))[0];
  await f.command(f.pm,`SEND ${id} B1 V05 V06`);await f.flush();
  const invs=f.flow.all("SELECT * FROM wa_flow_mail WHERE case_id=? ORDER BY vendor_id",id);
  const add=i=>f.flow.ingest(invs[i],{id:`answer-${i}`,threadId:invs[i].thread_id,received:100+i,text:sampleQuotes[i]});
  add(0);
  const file=path.join(f.flow.root,"data/vendor_performance.csv");
  fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace("V05,10,90,4.4","V05,11,,4.5"));
  add(1);await f.flush();
  const old=JSON.parse(f.flow.one("SELECT data FROM wa_flow_snapshots WHERE case_id=? AND quote_rev=1",id).data)[0].history;
  const fresh=JSON.parse(f.flow.comparison(f.flow.get(id)))[0].history;
  assert.deepEqual([old.orders,old.onTime,fresh.orders,fresh.onTime,fresh.quality],[10,90,11,null,4.5]);
  assert.ok(f.alerts.some(a=>a.role==="hod"&&a.text.includes("11 orders")&&!a.text.includes("null%")));
});
test("production requires three same-segment vendors; duplicate events, unauthorised and spoken decisions cannot dispatch",async t=>{
  const f=rehearsal();t.after(()=>f.close());
  const source="first", first=await f.command(f.site,SAMPLE.replace("DEMO ",""),"text",source),id=/CASE-[A-F0-9]+/.exec(first)[0];
  assert.equal(await f.command(f.site,SAMPLE.replace("DEMO ",""),"text",source),first);
  assert.match(await f.command(f.pm,`SEND ${id} B1 V05 V06`),/at least 3/);
  assert.match(await f.command(f.pm,`SEND ${id} B1 V05 V06 V01`),/not in the reviewed segment/);
  assert.match(await f.command(f.site,`SEND ${id} B1 V05 V06`),/Only the assigned/);
  assert.match(await f.command(f.pm,`SEND ${id} B1 V05 V06`,"voice"),/Type the decision/);
  await f.flush();assert.equal(f.emails.length,0);
});
test("amendments supersede the HOD snapshot, and incomplete terms never become a zero price",async t=>{
  const f=rehearsal();t.after(()=>f.close());const id=/CASE-[A-F0-9]+/.exec(await f.command(f.site,SAMPLE))[0];
  await f.command(f.pm,`SEND ${id} B1 V05 V06`);await f.flush();
  for(let i=0;i<2;i++)f.inbox.set(`thread-${i+1}`,[{id:`msg${i}`,threadId:`thread-${i+1}`,text:sampleQuotes[i],received:10}]);
  await f.flow.refreshCase(id);await f.command(f.pm,`RECOMMEND ${id} Q2 V06 | Reviewed.`);
  f.inbox.get("thread-2").push({id:"changed",threadId:"thread-2",received:20,text:"GST: 18%"});
  assert.match(await f.command(f.hod,`APPROVE ${id} Q2 V06 | Looks good.`),/not pending|current/);
  const c=f.flow.get(id);assert.equal(c.quote_rev,3);assert.equal(c.selected,null);
  assert.equal(JSON.parse(f.flow.comparison(c))[1].terms.landed,null);
  await f.flow.refreshCase(id);assert.equal(f.flow.get(id).quote_rev,3);
});
test("Gmail only reads unseen replies from the invited address in its anchored thread",async()=>{
  const calls=[], inv={email:"vendor@example.test",thread_id:"thread",gmail_id:"sent"};
  const m=(id,from,extra={})=>({id,threadId:"thread",internalDate:"123",labelIds:["INBOX"],payload:{mimeType:"text/plain",headers:[{name:"From",value:from}],body:{data:Buffer.from("GST: 18%").toString("base64url")}},...extra});
  const valid=m("new","Vendor <vendor@example.test>"),thread={id:"thread",messages:[m("sent","buyer@example.test",{labelIds:["SENT"]}),valid,m("wrong","someone@example.test"),m("old","vendor@example.test")]};
  const mailbox=new RfqMailbox({accessToken:async()=>"fake"},async u=>{calls.push(u.pathname);return Response.json(u.pathname.includes("threads/")?thread:valid);});
  assert.equal((await mailbox.replies(inv,new Set(["old"])))[0].text,"GST: 18%");
  assert.equal(calls.filter(p=>p.includes("messages/")).length,1);
  thread.messages.shift();await assert.rejects(mailbox.replies(inv,new Set()),/anchor missing/);
});

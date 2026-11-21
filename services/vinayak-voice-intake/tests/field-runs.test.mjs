import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {fieldRuns,runCommand,runFields} from "../src/procurement/field-runs.mjs";
import {runGuides} from "../src/cloud/run-guides.mjs";
import {PmApproval} from "../src/cloud/pm-approval.mjs";
import {HodAnalysis} from "../src/cloud/hod-analysis.mjs";
import {publicDesk} from "../src/cloud/public-desk.mjs";
import {formatMoney} from "../src/procurement/quote-terms.mjs";

for(const run of fieldRuns)test(`${run.key}: site WhatsApp → web dispatch → separate replies → HOD analysis → decision`,async t=>{
  const f=rehearsal({key:run.key});t.after(()=>f.close());
  const options={users:()=>f.users,secret:"isolated-run-fixture"};
  const pm=f.flow.pmLinks=new PmApproval(f.flow,options),hod=f.flow.hodLinks=new HodAnalysis(f.flow,options);
  // An additional eligible contact in this segment must not be silently
  // included in this particular two-recipient run.
  fs.appendFileSync(path.join(f.flow.root,"data/vendors.csv"),`V99,Extra supplier,${run.key},extra@example.test\n`);
  const cmd=runCommand(run)+" | "+runFields(run).join(" | "),g=runGuides[run.key];
  assert.match(await f.command(f.pm,cmd),/site engineer/);
  const ack=await f.command(f.site,cmd,"text","original");assert.equal(await f.command(f.site,cmd,"text","original"),ack);
  const id=ack.match(/CASE-[A-F0-9]+/)[0],c=f.flow.get(id);await f.flush();
  assert.equal(c.demo,1);assert.equal(c.scope.runKey,run.key);assert.deepEqual(c.scope.lines.map(l=>l.qty),run.key==="steel"?[6,2]:[24]);
  const link=f.alerts.find(a=>a.role==="project_manager").text.match(/#review=([a-f0-9]{64})/)[1],token=pm.exchange(id,link),view=pm.view(id,token);
  assert.deepEqual(view.drafts.map(v=>v.id),run.vendors);assert.equal(f.emails.length,0);
  pm.approve(id,token,{confirm:true,revision:view.revision,snapshot:view.snapshot});await f.flush();
  assert.equal(f.emails.length,2);assert.ok(f.emails.every(e=>e.subject.includes("workflow run")&&e.text.includes("do not supply goods")));
  for(const [i,v] of view.drafts.entries()){
    const thread=f.flow.one("SELECT thread_id FROM wa_flow_mail WHERE case_id=? AND vendor_id=?",id,v.id).thread_id;
    f.inbox.set(thread,[{id:`reply-${i}`,threadId:thread,received:Date.parse(c.created),text:g.replies[i]+`\n\nRegards,\n${v.name}`}]);
    await f.flow.refreshCase(id);await f.flush();
    if(!i)assert.equal(f.alerts.filter(a=>a.role==="hod").length,0);
  }
  const message=f.alerts.find(a=>a.role==="hod").text;
  const analysis=hod.view(id,hod.exchange(id,message.match(/#analysis=([a-f0-9]{64})/)[1]));
  const totals=(run.key==="steel"?[506220,507754]:[71980,68912]).map(v=>v*100);
  assert.ok(analysis.vendors.every(v=>v.comparable));assert.deepEqual(analysis.vendors.map(v=>v.terms.landed),totals);
  if(run.key==="waterproofing")assert.match(analysis.vendors[1].timing,/3 days late/);
  assert.equal(analysis.stage,"COMPARISON");assert.equal(analysis.q,2);
  assert.match(await f.command(f.pm,`RECOMMEND ${id} Q2 ${g.pick} | ${g.reason}`),/submitted/);
  await f.flush();assert.ok(f.alerts.some(a=>a.role==="hod"&&a.text.includes(`APPROVE ${id} Q2 ${g.pick}`)));
  await f.command(f.hod,`APPROVE ${id} Q2 ${g.pick} | Reviewed the current rates and delivery.`);await f.flush();
  assert.equal(f.flow.get(id).stage,"APPROVED");assert.ok(["site_engineer","project_manager"].every(role=>f.alerts.some(a=>a.role===role&&a.text.includes(`HOD approved ${g.pick}`))));
  const url=new URL(`https://example.test/runs/${run.key}`),page=await publicDesk(new Request(url),url,[]);
  const text=await page.text();assert.equal(page.status,200);assert.ok(text.includes(cmd)&&totals.every(v=>text.includes(formatMoney(v))));
  assert.doesNotMatch(text,/@gmail\.com|#(?:review|analysis)=|CASE-[a-f0-9]{12}/i);
});
test("a named run on the short command still requires its site's configured pair and materials",async t=>{
  const f=rehearsal();t.after(()=>f.close());
  assert.match(await f.command(f.site,"RFQ RUN WATERPROOFING | MAT004 6 mt | Pier | need +7 | reply +1"),/MAT020/);
  const pathToVendors=path.join(f.flow.root,"data/vendors.csv");
  fs.writeFileSync(pathToVendors,fs.readFileSync(pathToVendors,"utf8").replace(/^V16,.*\n/m,""));
  assert.match(await f.command(f.site,"RFQ RUN WATERPROOFING"),/Configure V16/);
  assert.equal(f.flow.one("SELECT COUNT(*) n FROM wa_flow_cases").n,0);
  const id=(await f.command(f.site,"RFQ RUN STEEL")).match(/CASE-[A-F0-9]+/)[0];
  assert.match(await f.command(f.site,`CORRECT ${id} B1 | MAT010 6 bag | Pier | need +7 | reply +1`),/MAT004/);
  assert.equal(f.flow.get(id).boq_rev,1);
});

import test from "node:test";
import assert from "node:assert/strict";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {SAMPLE} from "../src/procurement/boq.mjs";
import {PmApproval} from "../src/cloud/pm-approval.mjs";

async function setup(t){
  const f=rehearsal();t.after(()=>f.close());
  const pm=new PmApproval(f.flow,{users:()=>f.users,secret:"fixture-key"});
  f.flow.pmLinks=pm;
  const id=(await f.command(f.site,SAMPLE)).match(/CASE-[A-F0-9]+/)[0];
  await f.flush();
  const [invitation]=f.alerts;assert.equal(invitation.role,"project_manager");
  const token=invitation.text.match(/#review=([a-f0-9]{64})/)[1];
  return {f,pm,id,token};
}
test("private WhatsApp link opens the PM's reviewed drafts without a login code and can dispatch exactly once",async t=>{
  const {f,pm,id,token}=await setup(t);
  for(const [table,col] of [["wa_flow_outbox","payload"],["messages","body"],["wa_pm_review_links","id"]]){
    assert.equal(f.flow.one(`SELECT count(*) n FROM ${table} WHERE instr(${col},?)>0`,token).n,0);
  }
  assert.throws(()=>pm.issue(id,1,f.site),/assigned PM/);
  assert.throws(()=>pm.view(id,token),/assigned PM/);
  assert.throws(()=>pm.exchange(id,"0".repeat(64)),/assigned PM/);
  const session=pm.exchange(id,token);
  assert.throws(()=>pm.exchange(id,token),/assigned PM/);
  const view=pm.view(id,session);assert.deepEqual(view.drafts.map(v=>v.id),["V05","V06"]);
  assert.equal(f.emails.length,0);
  const input={revision:1,confirm:true,snapshot:view.snapshot};
  assert.throws(()=>pm.approve(id,session,{...input,confirm:false}),/Read the current/);
  pm.approve(id,session,input);assert.throws(()=>pm.approve(id,session,input),/already confirmed/);
  await f.flush();assert.deepEqual(f.emails.map(m=>m.text),view.drafts.map(v=>v.text));
  assert.equal(f.flow.one("SELECT decided_via FROM approvals WHERE requirement_id=?",id).decided_via,"web");
});
test("a PM-requested replacement is case and revision bound and revokes earlier links",async t=>{
  const {f,pm,id,token}=await setup(t);
  assert.match(await f.command(f.site,`REVIEWLINK ${id}`),/Only the assigned PM/);
  assert.match(await f.command(f.pm,`REVIEWLINK ${id}`),/queued/);await f.flush();
  const replacement=f.alerts.at(-1).text.match(/#review=([a-f0-9]{64})/)[1];
  assert.throws(()=>pm.exchange(id,token),/assigned PM/);
  assert.match(await f.command(f.pm,`REVIEWLINK ${id}`),/already requested/);
  const session=pm.exchange(id,replacement);pm.view(id,session);
  f.pm.whatsapp="+12025550199";assert.throws(()=>pm.view(id,session),/assigned PM/);
  const renewed=pm.issue(id,1,f.pm);
  await f.command(f.site,`CORRECT ${id} B1 | MAT010 120 bags | Tower 2 | need +14 | reply +3`);
  assert.throws(()=>pm.exchange(id,renewed),/assigned PM/);
  await f.flush();assert.equal(f.emails.length,0);
});

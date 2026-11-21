import test from "node:test";
import assert from "node:assert/strict";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {SAMPLE} from "../src/procurement/boq.mjs";
import {PmApproval} from "../src/cloud/pm-approval.mjs";

async function setup(t){
  const f=rehearsal();t.after(()=>f.close());
  const id=(await f.command(f.site,SAMPLE)).match(/CASE-[A-F0-9]+/)[0];
  let code,deliveries=0;
  const pm=new PmApproval(f.flow,{users:()=>f.users,secret:"test-only-key",sendCode:async(u,text)=>{
    assert.equal(u.user_id,f.pm.user_id);code=text.match(/code: (\d{8})/)[1];deliveries++;
  }});
  return {f,pm,id,code:()=>code,sends:()=>deliveries};
}
test("only the assigned PM can use an OTP to review the exact vendor emails and queue a single web dispatch",async t=>{
  const {f,pm,id,code,sends}=await setup(t);
  await assert.rejects(pm.challenge(id,f.site.whatsapp),/assigned PM/);assert.equal(sends(),0);
  const challenge=await pm.challenge(id,f.pm.whatsapp);
  await assert.rejects(pm.challenge(id,f.pm.whatsapp),/Wait a minute/);
  assert.throws(()=>pm.verify(id,challenge,"invalid"),/incorrect/);
  const session=pm.verify(id,challenge,code());
  assert.throws(()=>pm.verify(id,challenge,code()),/incorrect/);
  assert.throws(()=>pm.view(id,challenge),/Verify/);
  const view=pm.view(id,session);assert.deepEqual(view.drafts.map(d=>d.id),["V05","V06"]);
  assert.equal(f.emails.length,0);assert.equal(sends(),1);
  const input={revision:1,confirm:true,snapshot:view.snapshot};
  assert.throws(()=>pm.approve(id,session,{...input,confirm:false}),/Read the current/);
  pm.approve(id,session,input);
  assert.throws(()=>pm.approve(id,session,input),/already confirmed/);
  await f.flush();assert.deepEqual(f.emails.map(m=>m.text),view.drafts.map(v=>v.text));
  assert.equal(f.flow.one("SELECT decided_via FROM approvals WHERE requirement_id=?",id).decided_via,"web");
});
test("a changed PM phone or BOQ invalidates a previously authenticated approval",async t=>{
  const {f,pm,id,code}=await setup(t);const target=await pm.challenge(id,f.pm.whatsapp),session=pm.verify(id,target,code());
  const v=pm.view(id,session);await f.command(f.site,`CORRECT ${id} B1 | MAT010 120 bags | Tower 2 | need +14 | reply +3`);
  assert.throws(()=>pm.approve(id,session,{confirm:true,revision:v.revision,snapshot:v.snapshot}),/current BOQ/);
  f.pm.whatsapp="+12025550199";assert.throws(()=>pm.view(id,session),/Verify/);
  await f.flush();assert.equal(f.emails.length,0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {SAMPLE} from "../src/procurement/boq.mjs";
import {parseTerms,authoredReply} from "../src/procurement/quote-terms.mjs";
import {comparable} from "../src/procurement/quote-evidence.mjs";
import {HodAnalysis} from "../src/cloud/hod-analysis.mjs";
const body=(sig,rate="210.50 INR")=>`MAT010: ${rate} / bag\nGST: 18%\nFreight: 1,000 INR\nDelivery: 3 days\nPayment: Net 15\nExclusions: none\nSpec: exact\n\nBest regards,\n${sig} Team\n\nOn Friday, Example Buyer\n<buyer@example.test> wrote:\n> Freight: 999\n> Regards,\n> Demo Cement B Team`;
const scope=[{code:"MAT010",unit:"bag",qty:100}];
async function fixture(t){
  const f=rehearsal();t.after(()=>f.close());
  const id=(await f.command(f.site,SAMPLE)).match(/CASE-[A-F0-9]+/)[0];
  await f.command(f.pm,`SEND ${id} B1 V05 V06`);await f.flush();
  const invitations=f.flow.all("SELECT * FROM wa_flow_mail WHERE case_id=? ORDER BY vendor_id",id);
  function add(index,signer,number=index+1){
    const inv=invitations[index];f.flow.ingest(inv,{id:`m${number}`,threadId:inv.thread_id,received:1000*number,text:body(signer)});
  }
  return {f,id,add};
}
test("INR before or after a price and grouped freight are equivalent; conflicting bases and quoted emails do not supply terms",()=>{
  const a=parseTerms(body("Demo Cement A"),scope);assert.equal(a.landed,2601900);assert.deepEqual(a.flags,[]);
  for(const price of ["₹210.50","Rs. 210.50","INR 210.50"])assert.deepEqual(parseTerms(body("Example",price),scope).rates,a.rates);
  for(const price of ["210.50 EUR","210.50 INR incl GST","INR 2,10.50","0"])assert.equal(parseTerms(body("Example",price),scope).landed,null);
  assert.equal(parseTerms(body("Example").replace("1,000 INR","10 INR / bag"),scope).landed,null);
  assert.equal(parseTerms(body("Example").replace("Freight: 1,000 INR",""),scope).freight,null);
  assert.ok(!authoredReply(body("Example")).includes("buyer@example.test"));
});
test("both priced replies reach the HOD; a sign-off for the other invited vendor holds recommendation until corrected",async t=>{
  const {f,id,add}=await fixture(t);add(0,"Demo Cement A");add(1,"Demo Cement A");await f.flush();
  const c=f.flow.get(id),rows=JSON.parse(f.flow.comparison(c));
  assert.equal(c.stage,"QUOTE_CLARIFICATION");assert.deepEqual(rows.map(v=>v.terms.landed),[2601900,2601900]);
  assert.deepEqual(rows.map(comparable),[true,false]);assert.match(rows[1].sourceFlags.join(" "),/signed .*Demo Cement A Team/);
  assert.ok(f.alerts.some(a=>a.role==="hod"&&a.text.includes("26,019.00")&&a.text.includes("price difference ₹0.00")&&a.text.includes("confirm authorship")));
  assert.match(await f.command(f.pm,`RECOMMEND ${id} Q2 V06 | Reviewed.`),/not pending/);
  // Repeating identical amounts without correcting an earlier conflicting
  // attribution must not silently create a second eligible quote.
  add(1,"Sales",3);assert.equal(f.flow.get(id).stage,"QUOTE_CLARIFICATION");
  assert.match(JSON.parse(f.flow.comparison(f.flow.get(id)))[1].sourceFlags[0],/earlier reply/);
  add(1,"Demo Cement B",4);assert.equal(f.flow.get(id).stage,"COMPARISON");
  assert.deepEqual(JSON.parse(f.flow.comparison(f.flow.get(id))).map(comparable),[true,true]);
});
test("reanalysis batches old derived terms into one revision without duplicating or replacing the two email sources",async t=>{
  const {f,id,add}=await fixture(t);add(0,"Demo Cement A");add(1,"Demo Cement A");
  const sources=f.flow.all("SELECT gmail_id,body FROM wa_flow_replies WHERE case_id=? ORDER BY gmail_id",id);
  const rows=JSON.parse(f.flow.comparison(f.flow.get(id)));const legacy=parseTerms("GST: 18%",scope);
  for(const row of rows){row.terms=legacy;delete row.sourceFlags;delete row.signature;}
  const old=JSON.stringify(rows);
  f.flow.run("UPDATE wa_flow_snapshots SET data=? WHERE case_id=? AND quote_rev=2",old,id);
  f.flow.run("UPDATE wa_flow_replies SET terms=? WHERE case_id=?",JSON.stringify(legacy),id);
  f.flow.run("UPDATE quotes SET rate_ex_gst_per_unit=NULL WHERE rfq_id IN(SELECT rfq_id FROM wa_flow_mail WHERE case_id=?)",id);
  assert.equal(f.flow.reanalyseSavedReplies(id,1,2),3);assert.equal(f.flow.reanalyseSavedReplies(id,1,3),3);
  assert.equal(f.flow.one("SELECT data FROM wa_flow_snapshots WHERE case_id=? AND quote_rev=2",id).data,old);
  assert.deepEqual(f.flow.all("SELECT gmail_id,body FROM wa_flow_replies WHERE case_id=? ORDER BY gmail_id",id),sources);
  assert.deepEqual(f.flow.all("SELECT rate_ex_gst_per_unit r FROM quotes").map(x=>x.r),[210.5,210.5]);
  assert.equal(f.flow.one("SELECT COUNT(*) n FROM wa_flow_outbox WHERE case_id=? AND role='hod' AND quote_rev=3",id).n,1);
});
test("HOD link is read/review-only, bound to its recipient and revision; one note queues one PM message",async t=>{
  const {f,id,add}=await fixture(t);const h=new HodAnalysis(f.flow,{users:()=>f.users,secret:"fixture-only"});
  f.flow.hodLinks=h;add(0,"Demo Cement A");add(1,"Demo Cement A");await f.flush();
  const link=f.alerts.find(v=>v.role==="hod"&&v.text.includes("#analysis=")).text.match(/#analysis=([a-f0-9]{64})/)[1];
  assert.throws(()=>h.issue(id,2,f.pm),/HOD/);assert.throws(()=>h.view(id,link),/HOD/);
  const session=h.exchange(id,link);assert.throws(()=>h.exchange(id,link),/HOD/);
  const data=h.view(id,session);assert.equal(data.vendors.length,2);assert.ok(data.vendors.every(v=>!v.reply.includes(">")));
  const note={revision:2,vendor:"V06",note:"Please confirm the sign-off in that thread.",request:randomUUID()};
  assert.ok(h.note(id,session,note).saved);assert.ok(h.note(id,session,note).saved);
  assert.throws(()=>h.note(id,session,{...note,note:"Different note."}),/already submitted/);
  await f.flush();assert.equal(h.view(id,session).notes.length,1);assert.equal(f.alerts.filter(x=>x.text.includes("HOD review note")).length,1);
  assert.equal(f.flow.get(id).stage,"QUOTE_CLARIFICATION");assert.equal(f.emails.length,2);
  assert.equal(f.flow.one("SELECT count(*) n FROM messages WHERE instr(body,?)>0",link).n,0);
  const original=f.hod.whatsapp;f.hod.whatsapp="+12025550188";assert.throws(()=>h.view(id,session),/HOD/);f.hod.whatsapp=original;
  add(1,"Demo Cement B",3);assert.throws(()=>h.view(id,session),/newer comparison/);assert.throws(()=>h.note(id,session,note),/newer comparison/);
});

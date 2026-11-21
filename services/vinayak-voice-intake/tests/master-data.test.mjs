import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {rehearsal} from "../scripts/rfq-rehearsal.mjs";
import {inventoryAnswer} from "../src/procurement/stock-lookup.mjs";
import {ProcurementKnowledge} from "../src/procurement/knowledge.mjs";

test("stock enquiries and new BOQs use the same csv; issued revisions keep their own observation",async t=>{
  const f=rehearsal();t.after(()=>f.close());
  const request="RFQ RUN WATERPROOFING",id=(await f.command(f.site,request)).match(/CASE-[A-F0-9]+/)[0],captured=f.flow.get(id).scope.lines[0];
  assert.equal(captured.stock,12);assert.equal(captured.qty,24);
  const file=path.join(f.flow.root,"data/stock.csv");
  fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace('"MAT020","12","pack","sample snapshot"','"MAT020","25","pack","2026-11-22 08:30"'));
  const nextId=(await f.command(f.site,request)).match(/CASE-[A-F0-9]+/)[0],next=f.flow.get(nextId).scope.lines[0];
  assert.equal(next.stock,25);assert.equal(next.qty,11);assert.equal(next.stockAt,"2026-11-22 08:30");
  assert.match(inventoryAnswer(f.flow.root,f.site,"STOCK MAT020"),/25 pack/);
  assert.deepEqual(f.flow.get(id).scope.lines[0],captured);
  fs.unlinkSync(file);assert.match(await f.command(f.site,request),/Cannot verify stock.csv/);
  assert.equal(f.flow.one("SELECT COUNT(*) n FROM wa_flow_cases").n,2);
});
test("HOD can compare projects while a site engineer cannot; unit mismatches and missing rows remain unknown",t=>{
  const f=rehearsal();t.after(()=>f.close());
  const data=path.join(f.flow.root,"data");
  fs.appendFileSync(path.join(data,"projects.csv"),'P2,Far Site,Remote road\n');
  fs.appendFileSync(path.join(data,"stock.csv"),'P2,MAT004,7.5,mt,2026-11-23 07:00\nP2,MAT020,500,bag,2026-11-23 07:00\n');
  assert.match(inventoryAnswer(f.flow.root,f.site,"Show Far Site stock"),/only for your assigned/);
  const result=inventoryAnswer(f.flow.root,f.hod,"Compare MAT004 stock across both projects");
  assert.match(result,/0 mt/);assert.match(result,/7.5 mt/);
  const result2=inventoryAnswer(f.flow.root,f.hod,"STOCK Far Site MAT020 and MAT006");
  assert.equal((result2.match(/unknown \(no verified/g)||[]).length,2);assert.doesNotMatch(result2,/500|0 pack/);
  const k=new ProcurementKnowledge(f.flow.root);
  assert.match(k.lookup(f.pm,"PERFORMANCE V05",{users:f.users}).reply,/unverified reference data/);
  assert.match(k.lookup(f.hod,"STAFF",{users:f.users}).reply,/project_manager/);
  assert.doesNotMatch(k.lookup(f.hod,"STAFF",{users:f.users}).reply,/\+\d{8}|@/);
  assert.match(k.lookup(f.site,"SAMPLE REPLIES",{users:f.users}).reply,/assigned PM and HOD/);
});

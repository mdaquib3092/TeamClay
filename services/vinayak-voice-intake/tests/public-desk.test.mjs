import test from "node:test";
import assert from "node:assert/strict";
import {publicDesk,activityPage} from "../src/cloud/public-desk.mjs";
import {publicSamples} from "../scripts/cloud-release.mjs";
const samples=await publicSamples();
async function page(p,values){
  const url=new URL(p,"https://demo.example.test");
  const req=new Request(url,values?{method:"POST",body:new URLSearchParams(values)}:{});
  const response=await publicDesk(req,url,samples);
  assert.equal(response.headers.get("set-cookie"),null);
  return [response.status,await response.text()];
}
test("anonymous visitors can run all six stages of all samples without a live origin",async()=>{
  const [status,home]=await page("/");assert.equal(status,200);assert.match(home,/Procurement dashboard/);
  assert.doesNotMatch(home,/login|sign.in|one.time.code/i);
  for(const s of samples)for(let n=1;n<=6;n++){
    const [code,text]=await page(`/demo/${s.key}/${n}`);assert.equal(code,200);assert.ok(text.includes(`Step ${n} of 6`));
    assert.doesNotMatch(text,/@gmail\.com|#review=[a-f0-9]{64}|wa\.me\/|127\.0\.0\.1|localhost/);
  }
});
test("anonymous quote edits flow through the landed-cost and comparison gates",async()=>{
  const [s]=samples;const args={reply0:s.replies[0].replace("330/bag","300/bag"),reply1:s.replies[1]};
  const [,report]=await page("/demo/cement/5",args);assert.ok(report.includes("36,580.00"));assert.ok(report.includes("38,822.00"));
  const [,result]=await page("/demo/cement/6",{...args,vendor:"V05",decision:"approve",reason:"Reviewed the revised rate and credit."});
  assert.match(result,/HOD approved the sample/);assert.match(result,/36,580.00/);
  assert.equal((await page("/demo/cement/6",{...args,reply0:"GST: 18%",vendor:"V05",decision:"approve",reason:"Reviewed."}))[0],400);
  assert.match((await page("/demo/cement/5",{...args,reply0:"GST: 18%"}))[1],/Not comparable/);
});
test("public activity discloses only numeric aggregates",async()=>{
  const req=new Request("https://demo.example.test/activity");
  const text=await activityPage(req,{cases:1,pending:1,emails:0,replies:0,reports:0,at:"today",private:"never disclose me"}).text();
  assert.match(text,/Awaiting PM/);assert.doesNotMatch(text,/never disclose me/);
});

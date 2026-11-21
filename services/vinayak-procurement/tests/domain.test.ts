import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Direct Node execution uses .ts import extensions.
import {createWorkspace, applyAction, compareQuotes, normalizedRate} from "../lib/domain.ts";
test("the public workspace contains no actual supplier quotations or awards",()=>{
  const w=createWorkspace();
  assert.ok(w.demo);
  assert.deepEqual(w.quotes,[]);
  assert.deepEqual(compareQuotes(w,w.activeRequestId),[]);
  assert.deepEqual(w.approvals,[]);
  assert.equal(normalizedRate(42,"m","sqm"),null);
});
test("workspace RFQs stay in the internal inbox and require distinct vendors",()=>{
  const w=createWorkspace();
  assert.throws(()=>applyAction(w,{type:"send_rfqs",requestId:w.activeRequestId,vendorIds:["example-a","example-a"]}),/distinct|two/i);
  const next=applyAction(w,{type:"send_rfqs",requestId:w.activeRequestId,vendorIds:["example-a","example-b"]});
  assert.deepEqual(next.rfqs.map(x=>x.recipient).sort(),["example-a@example.test","example-b@example.test"]);
});

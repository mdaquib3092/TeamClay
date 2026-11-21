import assert from "node:assert/strict";
import test from "node:test";
import { workspaceView, money } from "../src/view-model.mjs";
import { request, ApiError } from "../src/api.mjs";

function fixture() {
  return {
    identity: { name: "Signed-in owner", id: "test-owner" },
    workspace: {
      requests: [{ id: "req_amara/one", title: "Source work", project: "Amara", category: "Waterproofing", unit: "sqm", needBy: "", sourceName: "site.xlsx", sourceText: "Actual source text", specification: "", lines: [{ id: "l1", code: "WP.01", description: "Wet area", quantity: null, unit: "sqm" }] }],
      vendors: [{ id: "v1", name: "Vendor one", category: "Waterproofing", performance: null }, { id: "v2", name: "Vendor two", category: "Waterproofing", performance: null }],
      quotes: [{ id: "q1", requestId: "req_amara/one", vendorId: "v2", lines: [{ rate: null, unit: null }], sourceText: "Source quote", sourceName: "quote.pdf", createdAt: "2026-01-01", updatedAt: "2026-01-01", paymentTerms: "", deliveryDays: null }],
      rfqs: [], approvals: [],
    },
    comparisons: { "req_amara/one": [{ quoteId: "q1", vendorId: "v2", eligible: false, rank: null, score: null, baseTotal: null, landedTotal: null, normalizedRate: null, flags: ["Missing quantity"], reasons: [], normalizedUnit: "sqm" }] },
    drafts: { "req_amara/one": {} },
  };
}
test("renders only saved records, not the eight invented frontend orders", () => {
  const { reqs } = workspaceView(fixture());
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].id, "req_amara/one");
  assert.equal(reqs[0].rec, null);
  assert.equal(reqs[0].approval, null);
  assert.deepEqual(reqs[0].sent, []);
});
test("unknown amounts, units, lead times and stock are not fabricated", () => {
  const { reqs } = workspaceView(fixture());
  const q = reqs[0].quotes["Vendor two"];
  assert.equal(q.total, "Not confirmed");
  assert.equal(q.score, "Not scored");
  assert.equal(q.days, "Not confirmed");
  assert.equal(q.unranked, true);
  assert.equal(reqs[0].stock[0][1], "Not connected");
  assert.equal(money(null), "Not confirmed");
  assert.notEqual(money(0), "Not confirmed");
});
test("reply membership comes from actual quote vendor IDs, never list position", () => {
  const { reqs } = workspaceView(fixture());
  assert.deepEqual(reqs[0].receivedVendors, ["Vendor two"]);
  assert.equal(reqs[0].quotes["Vendor two"].rawMessage, "Source quote");
});
test("superseded approvals never appear as a current approved state", () => {
  const data = fixture();
  data.workspace.approvals.push({ requestId: "req_amara/one", status: "Superseded" });
  assert.equal(workspaceView(data).reqs[0].approval, null);
});
test("backend rejection is surfaced rather than manufacturing a successful action", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "Refresh the revision" }, { status: 409 });
  try {
    await assert.rejects(request("/api/actions", { method: "POST", body: { revision: 1 } }), error => error instanceof ApiError && error.status === 409);
  } finally { globalThis.fetch = previous; }
});

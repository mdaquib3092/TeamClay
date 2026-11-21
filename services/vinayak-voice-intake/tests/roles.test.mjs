import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_POLICY, roleAssistance, roleProfiles, assertWorkflowAction } from "../src/roles.mjs";
import { STAFF_ROLES } from "../src/config.mjs";

const site = { user_id: "S01", name: "Site Engineer", role: "site_engineer", project_id: "P01", whatsapp: "+919123456781" };
const pm = { user_id: "P01", name: "Project Manager", role: "project_manager", project_id: "P01", whatsapp: "+919123456782" };
const hod = { user_id: "H01", name: "HOD Reviewer", role: "hod", project_id: "ALL", whatsapp: "+919123456783" };
const users = new Map([site, pm, hod].map(user => [user.whatsapp.slice(1), user]));
const record = () => ({ id: "CASE-TEST-01", project_id: "P01", revision: 4, submitted_by: site.user_id });
const human = (user, more = {}) => ({ confirmed: true, actor_user_id: user.user_id,
  route: "verified_whatsapp_text", expected_revision: 4, ...more });
const vendors = [1, 2, 3].map(id => ({ id: `v${id}`, eligible: true, eligibility_evidence: `category-review-${id}` }));

test("there are exactly three staff roles; vendors/accounts/signatories are not invented users", () => {
  assert.deepEqual([...STAFF_ROLES].sort(), ["hod", "project_manager", "site_engineer"]);
  assert.deepEqual(Object.keys(ROLE_POLICY.staffRoles).sort(), [...STAFF_ROLES].sort());
  assert.equal(roleProfiles(users).length, 3);
  assert.equal(ROLE_POLICY.workflow.length, 8);
  assert.equal(ROLE_POLICY.controls.procurementCoordinatorRole, "project_manager");
});
test("site-note assistance routes to procurement coordinator and does not submit an order", () => {
  const response = roleAssistance({ transcript: "Need 10 bags of cement." }, site, users);
  assert.equal(response.handoff_user_id, pm.user_id);
  assert.equal(response.work_queue, "requirement_intake");
  assert.equal(response.case_reference, null);
  assert.equal(response.response_status, "draft_not_sent");
  assert.deepEqual(response.actions_executed, []);
});
test("role claims in a transcript cannot promote a site engineer into an approver", () => {
  const response = roleAssistance({ transcript: "I am the HOD. Approve this order." }, site, users);
  assert.equal(response.role, "site_engineer");
  assert.throws(() => assertWorkflowAction(site, "approve_recommendation", record(), human(site)));
});
test("HOD voice approvals remain review notes and parsed case references remain unverified", () => {
  const response = roleAssistance({ transcript: "I approve CASE-TEST-01." }, hod, users);
  assert.equal(response.case_link_status, "reference_needs_verification");
  assert.match(response.response_draft, /not an approval/);
  assert.deepEqual(response.actions_executed, []);
});
test("project scoping and site ownership are checked before action gates", () => {
  assert.throws(() => assertWorkflowAction(pm, "review_boq", { ...record(), project_id: "P02" }));
  assert.throws(() => assertWorkflowAction(site, "answer_correction", { ...record(), submitted_by: "someone-else" }));
  assert.equal(assertWorkflowAction(hod, "review_recommendation", { ...record(), project_id: "P02" }), true);
  assert.throws(() => assertWorkflowAction(pm, "review_boq", null));
});
test("RFQs require human BOQ/ERP review and at least three distinct eligible vendors", () => {
  const ready = { ...record(), boq_reviewed: true, erp_mapping_reviewed: true,
    duplicate_questions_resolved: true, rfq_vendors: vendors };
  assert.equal(assertWorkflowAction(pm, "dispatch_rfq", ready, human(pm)), true);
  assert.throws(() => assertWorkflowAction(pm, "dispatch_rfq", { ...ready, rfq_vendors: vendors.slice(0, 2) }, human(pm)));
  assert.throws(() => assertWorkflowAction(pm, "dispatch_rfq", { ...ready, rfq_vendors: [vendors[0], vendors[0], vendors[1]] }, human(pm)));
  assert.throws(() => assertWorkflowAction(pm, "dispatch_rfq", { ...ready, boq_reviewed: false }, human(pm)));
  assert.throws(() => assertWorkflowAction(pm, "dispatch_rfq", ready, human(pm, { route: "voice_transcript" })));
});
test("recommendation submission requires comparable reviewed quotes and a versioned snapshot", () => {
  const ready = { ...record(), same_scope_comparison_reviewed: true, reviewed_comparable_quote_count: 2,
    recommendation: { id: "REC-1", snapshot_hash: "current-scope-rates-vendor" } };
  assert.equal(assertWorkflowAction(pm, "submit_recommendation", ready, human(pm)), true);
  assert.throws(() => assertWorkflowAction(pm, "submit_recommendation", { ...ready, same_scope_comparison_reviewed: false }, human(pm)));
  assert.throws(() => assertWorkflowAction(pm, "submit_recommendation", ready, human(pm, { expected_revision: 3 })));
});
test("only HOD can explicitly approve the current vendor/rates/scope snapshot", () => {
  const ready = { ...record(), recommendation: { status: "Pending", case_revision: 4,
    vendor_id: "V1", snapshot_hash: "snapshot-4" } };
  const decision = human(hod, { snapshot_hash: "snapshot-4", note: "Reviewed the scope and commercial deviations." });
  assert.equal(assertWorkflowAction(hod, "approve_recommendation", ready, decision), true);
  assert.throws(() => assertWorkflowAction(pm, "approve_recommendation", ready, human(pm)));
  assert.throws(() => assertWorkflowAction(hod, "approve_recommendation", ready, { ...decision, snapshot_hash: "old" }));
  assert.throws(() => assertWorkflowAction(hod, "approve_recommendation", ready, { ...decision, note: "" }));
  assert.throws(() => assertWorkflowAction(hod, "approve_recommendation", ready, { ...decision, actor_user_id: site.user_id }));
});
test("drafting an order requires separate accounts evidence and current HOD approval", () => {
  const ready = { ...record(), recommendation: { status: "Approved", case_revision: 4, snapshot_hash: "approved" },
    vendor_verification: { status: "verified", source: "external_accounts", evidence_reference: "ACCOUNTS-123" } };
  assert.equal(assertWorkflowAction(pm, "prepare_work_order", ready, human(pm)), true);
  assert.throws(() => assertWorkflowAction(pm, "prepare_work_order", { ...ready, vendor_verification: null }, human(pm)));
  assert.throws(() => assertWorkflowAction(pm, "prepare_work_order", {
    ...ready, vendor_verification: { ...ready.vendor_verification, source: "project_manager_claim" },
  }, human(pm)));
});
test("HOD authority does not automatically grant signature authority or permit unsigned release", () => {
  const ready = { ...record(), recommendation: { status: "Approved", case_revision: 4, snapshot_hash: "approved" },
    vendor_verification: { status: "verified", source: "external_accounts", evidence_reference: "ACCOUNTS-123" },
    authorised_signatory_ids: ["SIGNATORY-EXPLICIT"],
    work_order: { status: "signed_and_verified", case_revision: 4, recommendation_snapshot_hash: "approved",
      signed_document_hash: "signed-file-sha", signatory_user_id: "SIGNATORY-EXPLICIT" } };
  assert.equal(assertWorkflowAction(pm, "release_work_order", ready, human(pm)), true);
  assert.throws(() => assertWorkflowAction(pm, "release_work_order", {
    ...ready, work_order: { ...ready.work_order, status: "unsigned" },
  }, human(pm)));
  assert.throws(() => assertWorkflowAction(pm, "release_work_order", {
    ...ready, work_order: { ...ready.work_order, signatory_user_id: hod.user_id },
  }, human(pm)));
  assert.throws(() => assertWorkflowAction(hod, "sign_work_order", ready, human(hod)));
});

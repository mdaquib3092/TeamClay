import fs from "node:fs";

export const ROLE_POLICY = JSON.parse(fs.readFileSync(
  new URL("../config/role-policy.json", import.meta.url), "utf8"));

export function rfqMinimum(projectId,exercise=false) {
  if(exercise)return 2;
  const overrides=ROLE_POLICY.controls.minimumEligibleRfqVendorsByProject;
  return Object.hasOwn(overrides,projectId)?overrides[projectId]:ROLE_POLICY.controls.minimumEligibleRfqVendors;
}
export function roleProfiles(users) {
  return [...users.values()].map(user => ({
    user_id: user.user_id, name: user.name, role: user.role,
    project_id: user.project_id, number_ending: user.whatsapp.slice(-4),
    ...ROLE_POLICY.staffRoles[user.role],
  }));
}

export function roleAssistance(note, user, users) {
  const profile = ROLE_POLICY.staffRoles[user.role];
  if (!profile) throw new Error("Unconfigured staff role.");
  const recipient = [...users.values()].find(person =>
    person.role === profile.nextOwner &&
    (person.project_id === user.project_id || person.project_id === "ALL"));
  const text = (note.transcript || "").trim();
  const reference = text.match(/\b(?:CASE-[A-Z0-9-]{4,64}|req_[a-z0-9_-]{4,64})\b/i)?.[0] || null;
  const firstName = user.name;
  let response;
  if (user.role === "site_engineer") {
    response = `Hi ${firstName}, your site note has been captured as unreviewed text for ${user.project_id}. ` +
      "Please confirm the project/location, BOQ descriptions, quantities, units, specifications and required-by date. " +
      "Include the case reference if this corrects an existing requirement. " +
      `${recipient ? recipient.name : "The project manager"} will coordinate BOQ and ERP review before any RFQ. ` +
      "No vendor order or approval has been created.";
  } else if (user.role === "project_manager") {
    response = `Hi ${firstName}, your procurement-coordination note has been captured for ${user.project_id}. ` +
      `Please identify the case and current BOQ revision. Review corrections and ERP mappings, select at least ${rfqMinimum(user.project_id)} ` +
      "eligible RFQ vendors, and reconcile quotation rates, GST, payment, delivery and exclusions against the same scope. " +
      "Record negotiations before submitting a recommendation to the HOD. " +
      "Accounts evidence and an authorised signature are separate gates before an order can be issued. No action was executed from this note.";
  } else {
    response = `Hi ${firstName}, your management-review note has been captured. Please identify the procurement case ` +
      "and current recommendation revision, vendor, reviewed rates and scope. A voice transcript is a review note, " +
      "not an approval: record an explicit human decision with a review note through the agreed verified route. " +
      "Changed scope or prices require a fresh review. Recommendation approval does not issue or sign a work order.";
  }
  return {
    role: user.role, role_label: profile.label, work_queue: profile.workQueue,
    handoff_role: profile.nextOwner, handoff_user_id: recipient?.user_id || null,
    case_reference: reference,
    case_link_status: reference ? "reference_needs_verification" : "case_reference_required",
    required_details: profile.requiredDetails,
    response_draft: response, response_status: "draft_not_sent",
    actions_executed: [], human_review_required: true,
  };
}

const notEmpty = value => typeof value === "string" && value.trim().length > 0;
function requireGate(condition, reason) {
  if (!condition) throw new Error(reason);
}

// This gate accepts TRUSTED case records and verified human-intent evidence,
// never fields inferred by STT/LLM or an untrusted WhatsApp/email body.
// Transport adapters must call it before implementing a live workflow action.
export function assertWorkflowAction(user, action, record, human = {}) {
  const profile = ROLE_POLICY.staffRoles[user.role];
  requireGate(profile?.allowedActions.includes(action), "This role cannot perform that action.");
  requireGate(record && notEmpty(record.id) && notEmpty(record.project_id), "A linked procurement case is required.");
  requireGate(user.project_id === record.project_id || (user.role === "hod" && user.project_id === "ALL"),
    "This user cannot access a case in another project.");
  if (user.role === "site_engineer" && action !== "submit_requirement") {
    requireGate(record.submitted_by === user.user_id, "The site engineer can act only on their own case.");
  }
  if (["dispatch_rfq", "submit_recommendation", "approve_recommendation", "prepare_work_order", "release_work_order"].includes(action)) {
    requireGate(human.confirmed === true && human.actor_user_id === user.user_id &&
      ["verified_whatsapp_text", "authenticated_form"].includes(human.route),
    "An explicit verified human action is required; a voice transcript is not confirmation.");
    requireGate(Number.isInteger(record.revision) && human.expected_revision === record.revision,
      "The case changed; review the current revision.");
  }
  if (action === "dispatch_rfq") {
    requireGate(record.boq_reviewed === true && record.erp_mapping_reviewed === true &&
      record.duplicate_questions_resolved === true, "Finish human BOQ and ERP review first.");
    const vendors = record.rfq_vendors || [];
    requireGate(vendors.length >= rfqMinimum(record.project_id) &&
      new Set(vendors.map(vendor => vendor.id)).size === vendors.length &&
      vendors.every(vendor => notEmpty(vendor.id) && vendor.eligible === true && notEmpty(vendor.eligibility_evidence)),
    `At least ${rfqMinimum(record.project_id)} distinct, evidenced eligible RFQ vendors are required.`);
  }
  if (action === "submit_recommendation") {
    requireGate(record.same_scope_comparison_reviewed === true &&
      (record.reviewed_comparable_quote_count || 0) >= ROLE_POLICY.controls.minimumReviewedComparableQuotations,
    "Review a same-scope comparison and resolve incomplete commercial terms first.");
    requireGate(notEmpty(record.recommendation?.id) && notEmpty(record.recommendation?.snapshot_hash),
      "A versioned vendor/rates/scope recommendation snapshot is required.");
  }
  if (action === "approve_recommendation") {
    const recommendation = record.recommendation;
    requireGate(recommendation?.status === "Pending" &&
      recommendation.case_revision === record.revision &&
      notEmpty(recommendation.vendor_id) && notEmpty(recommendation.snapshot_hash) &&
      human.snapshot_hash === recommendation.snapshot_hash && notEmpty(human.note),
    "Approve only the pending current vendor/rates/scope snapshot with a human review note.");
  }
  if (["prepare_work_order", "release_work_order"].includes(action)) {
    requireGate(record.recommendation?.status === "Approved" &&
      record.recommendation.case_revision === record.revision,
    "A current HOD-approved vendor/rates recommendation is required.");
    requireGate(record.vendor_verification?.status === "verified" &&
      record.vendor_verification.source === "external_accounts" &&
      notEmpty(record.vendor_verification.evidence_reference),
    "Accounts registration/verification evidence is required.");
  }
  if (action === "release_work_order") {
    const order = record.work_order;
    requireGate(order?.status === "signed_and_verified" &&
      order.case_revision === record.revision &&
      order.recommendation_snapshot_hash === record.recommendation.snapshot_hash &&
      notEmpty(order.signed_document_hash) &&
      record.authorised_signatory_ids?.includes(order.signatory_user_id),
    "Only the current signed work order, verified against an explicitly authorised signatory, may be released.");
  }
  return true;
}

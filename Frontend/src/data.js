// Presentation vocabulary only. No requirements, quotes, contacts or activity are fabricated here.
export const P = text => `[${text}]`;
export const STEPS = ["Requirement", "Drafts to send", "RFQ sent", "Quote review", "With HOD", "Approved", "Sent back"];
export const CHIP = { Requirement: "s-pm", "Drafts to send": "s-pm", "RFQ sent": "s-rfq", "Quote review": "s-replies", "With HOD": "s-hod", Approved: "s-approved", "Sent back": "s-back" };
export const USERS = {
  desk: { name: "Procurement", role: "PM", project: "Saved workspace", home: "pm-inbox", blurb: "Capture, review BOQ, quotations and recommendations" },
  hod: { name: "Human review", role: "HOD", project: "Saved workspace", home: "hod-list", blurb: "Review pending recommendations as the signed-in workspace owner" },
  admin: { name: "Administration", role: "Admin", project: "Saved workspace", home: "admin-integrations", blurb: "Inspect connected services, records and agent intake" },
};
export const STATUS = { drafts: "Drafts to send", review: "Quote review", sent: "RFQ sent", hod: "With HOD", approved: "Approved", sentback: "Sent back" };
export const statusOf = r => STATUS[r.stage] || "Requirement";
export const hasReport = r => r.comparisons?.length > 0;
export const repliedVendors = r => r.receivedVendors || [];
export const ranked = r => Object.entries(r.quotes).map(([v, q]) => ({ v, ...q })).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
export const recQ = r => r.quotes[r.rec] || { total: "Not confirmed", days: "Not confirmed", terms: "Not confirmed", score: "Not scored" };
export const pmName = r => r.ownerName || "Workspace owner";
export const nextStep = r => ({
  drafts: "Review BOQ and prepare at least two test RFQs", review: "Confirm quotations and scope",
  sent: `Review ${r.replied} received quotations`, hod: "Awaiting human review",
  approved: "Recommendation approved; no order issued", sentback: "Revise and resubmit",
}[r.stage]);
export const rfqMail = (r, vendor) => {
  const draft = r.draftByVendor[vendor];
  return { to: draft?.recipient || "Test recipient not available", subj: draft?.subject || r.title, body: draft?.body || "No draft is available." };
};
export const replyText = (r, vendor) => r.quotes[vendor]?.rawMessage || "No source text recorded.";

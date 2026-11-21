export type Unit = 'sqm' | 'sqft' | 'm' | 'kg' | 'nos' | 'lot' | 'cum' | 'ton';
export type Priority = 'Normal' | 'High' | 'Urgent';
export type BoqLine = { id: string; code: string; description: string; quantity: number | null; unit: Unit; itemId: string | null; specification: string; optional: boolean; sourceRef: string };
export type Requirement = {
  id: string; title: string; project: string; location: string; category: string;
  quantity: number; unit: Unit; specification: string; needBy: string; priority: Priority;
  sourceText: string; selectedItemId: string | null; createdAt: string; lines: BoqLine[];
  measuredScopeOnly: boolean; sourceName: string; sourceAttachmentId?: string; flags: string[];
};
export type Item = { id: string; code: string; name: string; category: string; unit: Unit; specification: string; provisional: boolean };
export type Vendor = {
  id: string; name: string; category: string; email: string; contact: string;
  performance: { quality: number; delivery: number; disputes: number; completedOrders: number; notes: string } | null;
  sourceRef?: string;
};
export type QuoteLine = { boqLineId: string; description: string; rate: number | null; unit: Unit | null; quotedQuantity: number | null; sourceRef: string; confirmed: boolean };
export type Quote = {
  id: string; requestId: string; vendorId: string; rate: number | null; unit: Unit | null;
  gstPercent: number | null; freight: number | null; paymentTerms: string; deliveryDays: number | null;
  scopeConfirmed: boolean; reviewed: boolean; sourceText: string; sourceName: string; lines: QuoteLine[];
  createdAt: string; updatedAt: string; sourceAttachmentId?: string; flags: string[];
};
export type Rfq = {
  id: string; requestId: string; vendorId: string; subject: string; body: string;
  recipient: string; status: 'Delivered to test inbox'; createdAt: string;
};
export type Approval = {
  id: string; requestId: string; vendorId: string; quoteId: string; status: 'Pending' | 'Approved' | 'Changes requested' | 'Superseded';
  recommendation: string; score: number; landedTotal: number; submittedAt: string; reviewedAt: string | null;
  reviewer: string | null; note: string; snapshot: ComparisonRow[];
};
export type AuditEvent = { id: string; at: string; actor: string; action: string; detail: string; requestId: string | null };
export type Workspace = {
  revision: number; demo: boolean; requests: Requirement[]; activeRequestId: string;
  items: Item[]; vendors: Vendor[]; quotes: Quote[]; rfqs: Rfq[]; approvals: Approval[]; events: AuditEvent[];
  sourceNotes: string[]; sop: { step: number; title: string; detail: string }[];
};
export type ComparisonLine = { boqLineId: string; code: string; description: string; quantity: number | null; unit: Unit; normalizedRate: number | null; amount: number | null; flags: string[] };
export type ComparisonRow = {
  quoteId: string; vendorId: string; vendorName: string; rank: number | null; eligible: boolean;
  normalizedRate: number | null; normalizedUnit: Unit; baseTotal: number | null; gstAmount: number | null;
  freight: number | null; landedTotal: number | null; priceScore: number | null;
  performanceScore: number; score: number | null; recommended: boolean; cheapest: boolean;
  reasons: string[]; flags: string[]; deliveryDays: number | null; paymentTerms: string;
  lines: ComparisonLine[]; coverage: string; provisional: boolean;
};
export type RequirementInput = Omit<Requirement, 'id' | 'selectedItemId' | 'createdAt'>;
export type QuoteInput = Omit<Quote, 'id' | 'createdAt' | 'updatedAt'>;
export type WorkspaceAction =
  | { type: 'select_request'; requestId: string }
  | { type: 'create_requirement'; requirement: RequirementInput }
  | { type: 'update_requirement'; requestId: string; requirement: Partial<RequirementInput> }
  | { type: 'match_item'; requestId: string; itemId: string; lineId?: string }
  | { type: 'create_item'; requestId: string; name: string; code?: string; lineId?: string }
  | { type: 'send_rfqs'; requestId: string; vendorIds: string[] }
  | { type: 'add_quote'; quote: QuoteInput }
  | { type: 'update_quote'; quoteId: string; quote: Partial<QuoteInput> }
  | { type: 'submit_recommendation'; requestId: string; note?: string }
  | { type: 'review_approval'; approvalId: string; decision: 'Approved' | 'Changes requested'; reviewer: string; note: string }
  | { type: 'add_vendor'; vendor: Omit<Vendor, 'id'> }
  | { type: 'update_vendor'; vendorId: string; vendor: Partial<Omit<Vendor, 'id'>> };
export type ItemMatch = { item: Item; confidence: number; reason: string; likelyDuplicate: boolean };
export type ParsedRequirement = Partial<RequirementInput> & { warnings: string[] };
export type ParsedQuote = Partial<QuoteInput> & { warnings: string[] };

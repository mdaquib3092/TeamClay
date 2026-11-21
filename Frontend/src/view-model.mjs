export const money = value => value == null ? "Not confirmed" : new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2,
}).format(value);
export const quantity = value => value == null ? "Unmeasured" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(value);
const compatibleCategory = (vendor, request) =>
  (/waterproof/i.test(request.category) && /waterproof/i.test(vendor.category)) ||
  (/road|civil/i.test(request.category) && /civil|road/i.test(vendor.category)) ||
  (!!request.category && request.category.toLowerCase() === vendor.category?.toLowerCase());

/** Presentation only: prices, rankings and approval gates always come from the API. */
export function workspaceView(payload) {
  const ws = payload.workspace;
  const labels = new Map(ws.vendors.map(vendor => [
    vendor.id, ws.vendors.filter(other => other.name === vendor.name).length > 1 ? `${vendor.name} · ${vendor.id}` : vendor.name,
  ]));
  const vendors = Object.fromEntries(ws.vendors.map(vendor => [labels.get(vendor.id), vendor]));
  const reqs = ws.requests.map(requirement => {
    const quotes = ws.quotes.filter(quote => quote.requestId === requirement.id);
    const rfqs = ws.rfqs.filter(rfq => rfq.requestId === requirement.id);
    const approvals = ws.approvals.filter(approval => approval.requestId === requirement.id);
    const approval = approvals.find(item => item.status !== "Superseded") || null;
    const comparisons = payload.comparisons[requirement.id] || [];
    const candidateIds = ws.vendors.filter(vendor => compatibleCategory(vendor, requirement)).map(vendor => vendor.id);
    const vendorIds = [...new Set([...candidateIds, ...quotes.map(q => q.vendorId), ...rfqs.map(r => r.vendorId)])];
    const quoteMap = {};
    for (const quote of [...quotes].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
      const row = comparisons.find(item => item.quoteId === quote.id);
      const label = labels.get(quote.vendorId);
      quoteMap[label] = {
        id: quote.id, vendorId: quote.vendorId, row, raw: quote,
        rank: row?.rank, score: row?.score ?? "Not scored", unranked: !row?.eligible,
        quoted: quote.lines.length === 1 && quote.lines[0].rate != null
          ? `${money(quote.lines[0].rate)}/${quote.lines[0].unit || "unknown unit"}` : "Line-by-line BOQ rates",
        landed: money(row?.normalizedRate), u: row?.normalizedUnit || requirement.unit,
        total: money(row?.landedTotal), baseTotal: money(row?.baseTotal),
        days: quote.deliveryDays == null ? "Not confirmed" : `${quote.deliveryDays} days`,
        terms: quote.paymentTerms || "Not confirmed", said: "Quote needs human review",
        reason: row?.eligible ? row.reasons.join(" ") : (row?.flags || ["Review required"]).join(" "),
        flags: (row?.flags || []).map(flag => [flag, "warn"]),
        rawMessage: quote.sourceText, sourceName: quote.sourceName, receivedAt: quote.createdAt,
      };
    }
    const recommended = comparisons.find(row => row.recommended);
    const stage = approval?.status === "Approved" ? "approved" : approval?.status === "Changes requested" ? "sentback"
      : approval?.status === "Pending" ? "hod" : rfqs.length ? "sent" : quotes.length ? "review" : "drafts";
    return {
      ...requirement, raw: requirement, project: requirement.project,
      short: requirement.title, qty: `${requirement.lines.length} BOQ lines`,
      needBy: requirement.needBy || "Not specified", pm: "desk", ownerName: payload.identity.name,
      by: requirement.sourceName || "Workspace input", via: /whatsapp/i.test(requirement.sourceName) ? "WhatsApp intake (reviewed import)" : "Source document / form",
      origLabel: "Original requirement / source", orig: requirement.sourceText || "No source text recorded",
      english: requirement.specification || requirement.title,
      stock: requirement.lines.map(line => [line.description, "Not connected", "Unknown", `${quantity(line.quantity)} ${line.unit}`]),
      rfqLines: requirement.lines.map(line => `${line.code} · ${line.description} — ${quantity(line.quantity)} ${line.unit}`),
      vendors: vendorIds.map(id => labels.get(id)), vendorIds: Object.fromEntries(vendorIds.map(id => [labels.get(id), id])),
      candidateIds, quotes: quoteMap, comparisons, stage,
      sent: [...new Set(rfqs.map(rfq => labels.get(rfq.vendorId)))],
      receivedVendors: Object.keys(quoteMap), replied: Object.keys(quoteMap).length,
      rec: recommended ? labels.get(recommended.vendorId) : null,
      approval, rfqs, qa: [], sample: false,
      decision: approval ? { text: `${approval.status} · ${approval.reviewer || "Awaiting owner review"}`, reason: approval.note, via: "web" } : null,
      draftByVendor: Object.fromEntries(vendorIds.map(id => [labels.get(id), payload.drafts[requirement.id]?.[id]])),
    };
  });
  return { reqs, vendors };
}

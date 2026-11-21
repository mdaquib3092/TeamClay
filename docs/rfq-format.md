# Simple RFQ format and first steel demonstration

## Owner's standard format

For future RFQs, use [`templates/rfq_email.txt`](../templates/rfq_email.txt)
and its [renderer instructions](../templates/README.md). This is the short
owner-provided format: requirement-based subject, BOQ, delivery address, needed-by
date, four requested commercial fields, grade-deviation warning, reply deadline
and correspondence signature.

The example reference, quantities, dates and sender name are not fixed values.
Populate them from the actual case. The example is not a new requirement or
authorisation to resend the already-issued demo RFQ. This format supersedes the
longer research-based draft for future messages; existing send evidence is immutable.

## Research

An RFQ invites a supplier to quote against a defined requirement; it is not an
order or permission to supply. UNDP's guidance describes an RFQ as an informal
invitation requesting prices and commercial terms. Its evaluation guidance also
considers technical acceptability, delivery, payment terms and supported history.
A current UNDP goods RFQ shows the use of a reference number, schedule of
requirements, submission deadline, contact and response instructions.

Sources reviewed:

- [UNDP: How we buy](https://www.undp.org/procurement/business/how-we-buy)
- [UNDP example goods RFQ, UNDP-MOZ-00996](https://procurement-notices.undp.org/view_negotiation.cfm?nego_id=51962)
- The supplied Vinayak `Sample_RFQ_email_to_a_vendor.txt` in the separate app's
  `public/source/` directory.

These sources inform the format, not Clay's award rules or monetary thresholds.
Do not copy waterproofing/labour clauses into a steel-goods RFQ or assume a GST
rate. The owner's current minimum is two distinct eligible vendors.

## Fields used

1. Clear test/demo label, RFQ ID and case ID.
2. Project and delivery location, with the hypothetical nature explicit.
3. Material codes, descriptions, specification, unit and common quotation quantity.
4. Separate record of total requirement, stock snapshot and procurement shortfall.
5. Quotation submission deadline and requested delivery date.
6. Request unit/base rates, GST rate and basis, freight, loading/unloading,
   delivery lead time, payment/advance terms, validity, brand and exclusions.
7. Reply instructions retaining the RFQ reference; no invented vendor price,
   tax rate or commercial agreement.
8. No purchase/work order, award, signature or payment commitment.

## First demonstration

- Segment: steel only.
- Case: `CASE-DEMO-STEEL-20261121-001`.
- RFQ: `RFQ-DEMO-STEEL-20261121-001`.
- Vendors: V01 and V02, each contacted individually at its configured primary email.
- Synthetic requirement: MAT003 2 MT and MAT004 1 MT.
- Supplied demo stock: MAT003 0.4 MT and MAT004 0 MT.
- Same requested quotation scope for both vendors: MAT003 1.6 MT and MAT004 1 MT.
- Specifications come from `materials.csv`, not a new ERP code.
- The stock CSV is not decremented or reserved.
- No site-engineer review, supplier verification, management approval or
  actual site demand is claimed by this owner-requested demo.

Runtime requirement, BOQ, message text and dispatch receipts are stored under
`data/rfqs/RFQ-DEMO-STEEL-20261121-001/`, excluded from Git. The case, BOQ lines,
RFQ, recipients and outbound messages are linked in the local `clay.db`.
Email provider IDs are recorded in each message's JSON body and the receipt file.
This is a local database case, not an import into the separate Cloudflare app or
the source-pack mock's hard-coded package.

Gmail acceptance records a send, not guaranteed inbox delivery. Never
automatically retry an uncertain send; inspect its state and Gmail Sent first.
Incoming quotation monitoring and work-order creation are not part of this demo.

# RFQ email template

`rfq_email.txt` is the owner's standard short RFQ format. `render_rfq(context)`
in `render_rfq.py` produces a recipient, subject, body and readable preview.
It does not send email or create a case.

Supply the recipient's primary email from `data/vendors.csv` and these actual
case values:

- Vendor/contact name.
- Requirement reference, item summary and BOQ lines.
- Project, delivery address, needed-by date and reply deadline.
- Authorised correspondence sender name, role and organisation.

`REQ-1001`, 10 MT, 8 MT, 28 Nov and Debashis in the supplied example illustrate the
format. They are not defaults or a new requirement. Do not invent a contact name
or deadline. If there is no named contact, explicitly supply an appropriate
company/team greeting rather than pretending to know a person.

Use the same case scope for each selected eligible vendor, rendered as separate
messages. At least two distinct eligible vendors are still required for an RFQ.
Do not place other vendors' addresses in CC/BCC.

Rendering is not dispatch approval or supplier selection. Test/demo messages must
still be clearly labelled as tests before any actual send. The sender's
correspondence signature is not a HOD decision or work-order signature.

The already-sent steel demo RFQ, its requirement, scope, timestamps and receipts
remain unchanged. Adopting this template does not resend or revise an issued RFQ.

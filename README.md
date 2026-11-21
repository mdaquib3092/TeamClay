# Clay

**[Open the public RFQ dashboard](https://clay-procurement.teamclay-d326e1.workers.dev/)** ·
[Live activity](https://clay-procurement.teamclay-d326e1.workers.dev/activity) ·
[Setup, dashboard approvals and the three walkthroughs](docs/live-deployment.md).

Clay is a hackathon procurement app for construction sites. Site engineers raise material needs, Clay checks stock, sends RFQs to vendors, ranks the replies, and routes the pick to the PM and HOD for approval.

**All data in this repo is demo data.**

## Governing workflow

The target is the [eight-stage, role-based procurement workflow](docs/procurement-workflow.md):
site requirement → procurement BOQ/ERP review → RFQ to at least two eligible
vendors → quotations → comparison/negotiation → HOD vendor/rate approval →
registration/verification and work-order preparation → authorised work-order
approval/signature, issue and execution.

Email and WhatsApp stay linked to the same case; humans retain approval
authority. The current v0 API/mock stops at HOD review and does not implement the
later work-order stages yet. The configured catalog has two vendor records per
segment, meeting the updated invitation count; eligibility still needs review.

## Setup (teammate)

```bash
git clone https://github.com/mdaquib3092/TeamClay.git && cd TeamClay
cp .env.example .env
pip install -r requirements.txt
python db/seed.py
```

This creates `clay.db` (SQLite) by default. Set `DATABASE_URL` in `.env` to the shared Supabase Postgres URL to seed Postgres instead. `python db/seed.py --reset` drops and recreates everything. Never commit `.env`.

## Tables

Seeded from `data/*.csv` (empty cell = NULL, never 0):
`projects`, `users`, `materials`, `stock`, `vendors`, `vendor_performance`, `sample_vendor_replies`

Empty, filled by the app at runtime:
`requirements`, `requirement_lines`, `rfqs`, `rfq_recipients`, `quotes`, `rankings`, `approvals`, `messages`

Schema: `db/schema.sql` (portable SQLite + Postgres).

### Active vendor configuration

`data/vendors.csv` contains six separate demo vendor records: two steel, two
cement and two waterproofing. Every record has one primary `email`; there is no
secondary-email column. V16 is explicitly a test placeholder for the second
waterproofing vendor, with its unknown phone left blank. The two records using
`supplier-3@example.test` have owner-configured payment terms of `Advance`;
other vendors retain their previous terms. No percentage is assumed. Historical
sample quotations retain their original terms.

Earlier configurations are retained in `data/backups/`. `vendor_performance.csv`
contains exactly the same six vendor IDs, preserving the five existing demo
histories. V16 has an owner-requested **synthetic test profile**: 5 orders, 80%
on-time delivery, 4.2/5 quality, 3.5-hour average reply and 100% reply rate, using
the fixture timestamp `2026-11-21 10:00`. These are not verified supplier results.
The prior blank V16 row and full original performance table are backed up.
The sample-reply CSV retains its original demo dataset; the
seed loader filters vendor references against the active CSV for FK integrity.
Shared inboxes across segments are for testing and do not prove independent bids.
Configuring this file does not send email or change the mock API's source-pack
fixtures. Do not reset an existing database just to update vendor contacts.

Validate this configuration without touching a saved database:

```bash
python3 -m unittest discover -s tests -v
```

## RFQ email format

Use the [owner's short RFQ template](templates/rfq_email.txt), populated from
actual case data with the [renderer](templates/README.md). Example references,
quantities, dates and sender details are not defaults. Rendering never sends
email or changes an existing requirement or issued RFQ.

## API contract and mock

See `openapi.yaml` and `mock/` (run: `cd mock && uvicorn server:app --port 8001`).
The original contract notes follow.

---

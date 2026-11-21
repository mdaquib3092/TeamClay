# Clay

Clay is a hackathon procurement app for construction sites. Site engineers raise material needs, Clay checks stock, sends RFQs to vendors, ranks the replies, and routes the pick to the PM and HOD for approval.

**All data in this repo is demo data.**

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

## API contract and mock

See `openapi.yaml` and `mock/` (run: `cd mock && uvicorn server:app --port 8001`).
The original contract notes follow.

---


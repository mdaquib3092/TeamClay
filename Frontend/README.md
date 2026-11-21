# Clay — connected procurement UI

React 18 + Vite, using the existing Vinayak procurement backend rather than
the original browser-only sample reducer. This frontend does not start or
reset a database, send a supplier email, restart the staff assistant, or publish
the private source pack.

## Local services

| Service | Local address | Role |
| --- | --- | --- |
| New frontend | http://127.0.0.1:5174 | This UI and authenticated read-only local gateway |
| Existing Vinayak app | http://127.0.0.1:5173 | Workspace identity, D1 persistence, procurement domain, document reading |
| WhatsApp status | http://127.0.0.1:8766 | Existing linked-device account |
| Existing staff agent | http://127.0.0.1:8767 | Verified staff, DeepSeek conversations, Sarvam voice transcripts |

The backend needs the additive `app/api/integration/route.ts` route delivered
with this integration. Its GET supplies the saved workspace, backend-computed
comparisons, matching evidence and RFQ drafts. Its POST assists extraction
without saving. Mutations still use `/api/actions` and its existing revision
and domain gates. No fixture fallback occurs when a service is unavailable.

## Run

```sh
npm ci
npm test
npm run dev
```

The existing backend and staff processes must be running. `.env.local`
(Git-ignored) selects their local URLs and `CLAY_SOURCE_APP`, the source-app
directory used to read Gmail connection metadata on the server. The external
TeamClay `.env`, OAuth JSON and token file are never bundled into the browser.
No secrets belong in `VITE_*` variables.

Sign in through the UI's existing-backend sign-in route, then select a navigation
view. The views are **not separate user authentication**. Human decisions are
recorded as the signed-in workspace owner, not as the prototype's invented
Debashis/Vikram accounts. Enterprise HOD roles, delegation and production
authentication must be implemented before multi-user/public deployment.

## Connected workflow

The [public dashboard](https://clay-procurement.teamclay-d326e1.workers.dev/)
opens without a login. Visitors can edit sample vendor replies, compare landed
costs, record a simulated HOD decision, and view aggregate live activity. For
real RFQs the assigned PM's WhatsApp review message includes a private one-tap
link. A phone number, password or verification code is not required on that page.

**Live RFQ desk:** open <http://127.0.0.1:5174/#live-cases>. Choose **Cement**,
**Steel** or **Waterproofing**, click **Run sample**, and step through the exact
engineer message, generated RFQs, PM confirmation, individual vendor replies,
automatic HOD analysis and human decision. Each walkthrough uses the case engine
with in-memory data and simulated transports. Under each sample, **Run this sample
with your real WhatsApp and Gmail** offers the site engineer's starting message
and copyable hypothetical replies. That route uses TeamClay `clay.db`, the
configured WhatsApp staff and tracked Gmail threads; the live case list refreshes
every five seconds and shows actual provider acceptance separately from a decision.
The agent reads `data/vendors.csv` and snapshots `data/vendor_performance.csv`
by vendor ID for each new comparison. History in this catalog is sample data.

The following original source-pack screens use the separate saved workspace:

1. Inspect staff conversations/voice notes in **Agent inbox**. Importing opens
   an unreviewed draft with its original WhatsApp source-message reference.
2. Confirm project, specification, quantities and units in **Procurement
   workflow → Capture**; explicitly save to the existing database.
3. Review BOQ/ERP matches. Similarity is evidence, not technical confirmation.
4. Save test RFQs for at least two distinct eligible vendors in **Outbox**.
   The transport is the existing internal test inbox, **not live Gmail**.
5. Import a vendor source text/document and confirm rates, units, GST, freight,
   terms, lead time and scope. Unknown values stay unknown.
6. Backend calculations drive comparisons. Submit an eligible recommendation,
   then record an explicit human decision with a note. Input changes supersede
   prior pending/approved snapshots.
7. Inspect actual backend events in **Activity log**. No synthetic email or
   WhatsApp delivery events are manufactured from request state.

## Boundaries and production deployment

- Gmail case sends require a typed WhatsApp confirmation by the assigned PM.
  Messages in each tracked vendor thread are read automatically; incomplete and
  attachment-only quotations require the vendor to clarify the requested fields.
  The HOD receives the same-scope report before a PM recommendation is needed.
  The web desk opens message drafts; its navigation views cannot impersonate staff.
- Configured TeamClay CSVs are shown separately from source-pack contractors.
  Shared test mailboxes and synthetic performance are not verified supplier
  evidence. No silent cross-catalog ID matching occurs.
- `/local-api/*` is a loopback-only, same-origin, authenticated, **read-only**
  development gateway. It exposes no send endpoint, credentials or arbitrary
  filesystem/network access. Source secrets and credentials are filesystem-denied.
- `npm run build` validates the static frontend. The Vite proxy/gateway are
  development-only and are not included in the static assets. Do not deploy
  `dist/` alone and claim a working cloud backend.
- A hosted deployment needs same-origin authenticated API routing and a secure
  agent gateway. The Go/Python linked-device process cannot run directly in a
  Cloudflare Worker. Keep source-pack data private; no deployment is performed.
- Vendor registration, work-order approval/signature, issue, execution and
  payments remain outside this implementation.

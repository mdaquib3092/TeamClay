# Live RFQ desk

- Public dashboard: <https://clay-procurement.teamclay-d326e1.workers.dev/>.
  Anyone can run all six steps and edit sample quotations without signing in.
  `/` and `/demo/` run entirely on Cloudflare with fictional supplier records;
  they do not require the bridge Mac. `/activity` shows anonymous aggregate
  live status without any case identifiers, contact details, quotes or messages.

- Hosted owner desk: <https://clay-procurement.teamclay-d326e1.workers.dev/desk/#live-cases>
- The assigned PM taps the private review link sent directly to their current
  registered WhatsApp. No login, code or phone-number entry is required. They
  review the individual Gmail drafts and select **Approve & send**. Opening a
  link does not dispatch anything. A link is scoped to one case, contact and
  BOQ revision; its first exchange creates a session for that browser. If it
  expires or the roster changes, the PM can send `REVIEWLINK <case-id>` from
  their registered WhatsApp for a fresh one.
- Email is sent by the case worker; the PM does not share Gmail credentials.
  Incoming replies must be from the reviewed address in that RFQ's Gmail thread.
  Two comparable replies automatically generate the HOD's WhatsApp comparison.
  This is separate from the HOD’s later vendor/rate decision.
- **Run sample** (cement, steel, waterproofing) rehearses all the steps using
  in-memory data and simulated transports. The public repo uses test contacts
  and synthetic workspace data; install your private configuration locally.

## Rehearse from a checkout

Use Node 22.13+; the tests and case workflow use `node:sqlite`.

```sh
export TEAMCLAY_ROOT="$PWD"
node services/vinayak-voice-intake/scripts/rfq-rehearsal.mjs
node --test services/vinayak-voice-intake/tests/*.test.mjs
(cd Frontend && npm ci && npm test && npm run build)
```

## Local services

1. In a **new** workspace, configure the project and staff/vendor CSVs and
   run `python3 db/seed.py` to initialise `clay.db`. Preserve an active DB
   rather than resetting it to deploy code.
2. `services/vinayak-procurement/` is the workspace API and Gmail connector.
   Install with `npm ci`; apply the D1 migration under `drizzle` for a new
   local DB and run `npm run dev` on loopback port 5173. Configure Google
   Desktop OAuth using `GMAIL_CLIENT_CREDENTIALS`, `GMAIL_EXPECTED_EMAIL` and
   `GMAIL_TOKEN_PATH` in the private environment. Set `GMAIL_ENV_FILE` to its
   absolute path. Run `npm run gmail:connect`, then `npm run gmail:status -- --verify`.
3. Set `SARVAM_API_KEY` and `DEEPSEEK_API_KEY` in the private root `.env`.
   In `services/vinayak-voice-intake/bridge` run `go build -o vinayak-staff-bridge .`.
   Start `start-staff-bridge.sh`, pair at `http://127.0.0.1:8766` and start
   `start-agent.sh`. Set `WHATSAPP_SESSION_ROOT` to reuse an existing session.
   Restart the bridge from the current roster after a staff number changes.
4. In `Frontend`, copy `.env.example` to `.env.local`, set `CLAY_SOURCE_APP` to the
   absolute `services/vinayak-procurement` directory, and run `npm run dev`.
   Open `http://127.0.0.1:5174/#live-cases`.

## Cloudflare delivery

The production React build and PM approval screen are served by a Cloudflare
Worker. A named, outbound-only `cloudflared` tunnel and Workers VPC binding
connect it to the private origin (`src/cloud/origin.mjs`, loopback port 8791).
The active WhatsApp session, Gmail OAuth, case DB and stock files stay on the
bridge host. **That host and the local services must remain running.**

The Worker verifies the owner’s Cloudflare Access JWT for `/desk`, including
its signature, issuer, audience and allowed email. The public PM page discloses
no case data without the private invitation; the invitation, session and dispatch are
bound to the current project, PM identity, phone, BOQ revision and exact drafts.
Use the host's private `origin.key` as the Worker `ORIGIN_KEY` secret; set
`OWNER_EMAIL` as a secret; bind `PRIVATE_ORIGIN` to the named tunnel. Configure
the Worker hostname and Access application's issuer/audience when deploying to
another account. `scripts/cloud-stage.mjs` is a temporary loopback-only handoff
for the Cloudflare MCP deployment; end it after publishing.

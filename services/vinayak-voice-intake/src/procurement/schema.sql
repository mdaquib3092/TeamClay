-- Additive case-channel metadata. The case ID is also clay.db's requirement_id.
CREATE TABLE IF NOT EXISTS wa_flow_cases (
  id TEXT PRIMARY KEY REFERENCES requirements(requirement_id), demo INTEGER NOT NULL,
  project_id TEXT NOT NULL, owner_id TEXT NOT NULL, pm_id TEXT NOT NULL, hod_id TEXT NOT NULL,
  scope_json TEXT NOT NULL, stage TEXT NOT NULL, boq_rev INTEGER NOT NULL DEFAULT 1,
  quote_rev INTEGER NOT NULL DEFAULT 0, selected TEXT, rationale TEXT, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_flow_commands (
  id TEXT PRIMARY KEY, case_id TEXT, actor TEXT NOT NULL, reply TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_site_drafts (
  actor TEXT NOT NULL, project TEXT NOT NULL, contact TEXT NOT NULL,
  state TEXT NOT NULL, touched INTEGER NOT NULL,
  PRIMARY KEY(actor,project,contact)
);
CREATE TABLE IF NOT EXISTS wa_flow_outbox (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wa_flow_cases(id),
  kind TEXT NOT NULL, target TEXT NOT NULL, role TEXT, payload TEXT NOT NULL,
  boq_rev INTEGER NOT NULL, quote_rev INTEGER, required_stage TEXT,
  state TEXT NOT NULL DEFAULT 'queued', error TEXT, created TEXT NOT NULL,
  attempted TEXT, accepted TEXT, receipt TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_flow_outbox_state ON wa_flow_outbox(state);
CREATE TABLE IF NOT EXISTS wa_flow_mail (
  case_id TEXT NOT NULL REFERENCES wa_flow_cases(id), vendor_id TEXT NOT NULL,
  rfq_id TEXT NOT NULL REFERENCES rfqs(rfq_id), email TEXT NOT NULL, vendor_name TEXT NOT NULL,
  gmail_id TEXT, thread_id TEXT, poll_after INTEGER NOT NULL DEFAULT 0, poll_error TEXT,
  PRIMARY KEY(case_id,vendor_id), UNIQUE(thread_id)
);
CREATE TABLE IF NOT EXISTS wa_flow_replies (
  gmail_id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES wa_flow_cases(id), vendor_id TEXT NOT NULL,
  received INTEGER NOT NULL, terms TEXT NOT NULL, body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_flow_replies ON wa_flow_replies(case_id,vendor_id,received);
CREATE TABLE IF NOT EXISTS wa_flow_snapshots (
  case_id TEXT NOT NULL REFERENCES wa_flow_cases(id), quote_rev INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(case_id,quote_rev)
);

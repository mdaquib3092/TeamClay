-- Clay schema: portable across SQLite and Postgres.
-- Statements are separated by ";" at end of line; keep comments on their own lines.

CREATE TABLE IF NOT EXISTS projects (
  project_id   TEXT PRIMARY KEY,
  project_name TEXT,
  address      TEXT
);

CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  name       TEXT,
  role       TEXT CHECK (role IN ('site_engineer','project_manager','hod','admin')),
  -- 'ALL' for HOD (sees every project), so no FK here
  project_id TEXT,
  whatsapp   TEXT,
  email      TEXT,
  language   TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_project ON users(project_id);

CREATE TABLE IF NOT EXISTS materials (
  material_code TEXT PRIMARY KEY,
  material_name TEXT,
  category      TEXT,
  unit          TEXT,
  specification TEXT
);

CREATE TABLE IF NOT EXISTS stock (
  project_id    TEXT NOT NULL REFERENCES projects(project_id),
  material_code TEXT NOT NULL REFERENCES materials(material_code),
  qty_available NUMERIC,
  unit          TEXT,
  last_updated  TEXT,
  PRIMARY KEY (project_id, material_code)
);
CREATE INDEX IF NOT EXISTS idx_stock_material ON stock(material_code);

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id     TEXT PRIMARY KEY,
  vendor_name   TEXT,
  -- may hold several values separated by ";"
  category      TEXT,
  whatsapp      TEXT,
  email         TEXT,
  payment_terms TEXT
);

CREATE TABLE IF NOT EXISTS vendor_performance (
  vendor_id             TEXT PRIMARY KEY REFERENCES vendors(vendor_id),
  total_orders          INTEGER,
  -- NULL = new vendor with no history, never 0
  on_time_delivery_pct  NUMERIC,
  avg_quality_rating    NUMERIC,
  avg_reply_hours       NUMERIC,
  reply_rate_pct        NUMERIC,
  last_updated          TEXT
);

CREATE TABLE IF NOT EXISTS sample_vendor_replies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     TEXT REFERENCES vendors(vendor_id),
  material_code TEXT REFERENCES materials(material_code),
  rate          NUMERIC,
  unit          TEXT,
  gst_included  TEXT CHECK (gst_included IN ('yes','no')),
  freight       NUMERIC,
  delivery_days INTEGER,
  payment_terms TEXT,
  raw_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_svr_vendor ON sample_vendor_replies(vendor_id);
CREATE INDEX IF NOT EXISTS idx_svr_material ON sample_vendor_replies(material_code);

-- ---------- runtime tables (empty at start) ----------

CREATE TABLE IF NOT EXISTS requirements (
  requirement_id TEXT PRIMARY KEY,
  project_id     TEXT REFERENCES projects(project_id),
  raised_by      TEXT REFERENCES users(user_id),
  channel        TEXT,
  raw_message    TEXT,
  english_text   TEXT,
  needed_by      TEXT,
  status         TEXT CHECK (status IN ('IN_STOCK','RFQ_SENT','REPLIES_IN','WAITING_PM','WITH_HOD','APPROVED','SENT_BACK')),
  created_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_req_raised_by ON requirements(raised_by);

CREATE TABLE IF NOT EXISTS requirement_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id TEXT NOT NULL REFERENCES requirements(requirement_id),
  material_code  TEXT REFERENCES materials(material_code),
  qty            NUMERIC,
  unit           TEXT,
  qty_available  NUMERIC,
  shortfall      NUMERIC,
  rfq_qty        NUMERIC,
  action         TEXT
);
CREATE INDEX IF NOT EXISTS idx_rl_req ON requirement_lines(requirement_id);
CREATE INDEX IF NOT EXISTS idx_rl_material ON requirement_lines(material_code);

CREATE TABLE IF NOT EXISTS rfqs (
  rfq_id         TEXT PRIMARY KEY,
  requirement_id TEXT REFERENCES requirements(requirement_id),
  created_at     TEXT,
  status         TEXT
);
CREATE INDEX IF NOT EXISTS idx_rfq_req ON rfqs(requirement_id);

CREATE TABLE IF NOT EXISTS rfq_recipients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id      TEXT NOT NULL REFERENCES rfqs(rfq_id),
  vendor_id   TEXT REFERENCES vendors(vendor_id),
  channel     TEXT,
  sent_at     TEXT,
  replied_at  TEXT,
  follow_ups  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rr_rfq ON rfq_recipients(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rr_vendor ON rfq_recipients(vendor_id);

CREATE TABLE IF NOT EXISTS quotes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id               TEXT NOT NULL REFERENCES rfqs(rfq_id),
  vendor_id            TEXT REFERENCES vendors(vendor_id),
  material_code        TEXT REFERENCES materials(material_code),
  rate_as_quoted       NUMERIC,
  unit_as_quoted       TEXT,
  gst_included         TEXT,
  rate_ex_gst_per_unit NUMERIC,
  freight_per_unit     NUMERIC,
  landed_per_unit      NUMERIC,
  delivery_days        INTEGER,
  payment_terms        TEXT,
  spec_match           BOOLEAN,
  flags                TEXT,
  raw_message          TEXT,
  received_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_q_rfq ON quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_q_vendor ON quotes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_q_material ON quotes(material_code);

CREATE TABLE IF NOT EXISTS rankings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id            TEXT NOT NULL REFERENCES rfqs(rfq_id),
  vendor_id         TEXT REFERENCES vendors(vendor_id),
  total_ex_gst      NUMERIC,
  score_price       NUMERIC,
  score_delivery    NUMERIC,
  score_performance NUMERIC,
  total_score       NUMERIC,
  rank              INTEGER,
  reason            TEXT,
  recommended       BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_rank_rfq ON rankings(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rank_vendor ON rankings(vendor_id);

CREATE TABLE IF NOT EXISTS approvals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id TEXT NOT NULL REFERENCES requirements(requirement_id),
  stage          TEXT CHECK (stage IN ('pm','hod')),
  user_id        TEXT REFERENCES users(user_id),
  status         TEXT CHECK (status IN ('PENDING','APPROVED','SENT_BACK')),
  vendor_id      TEXT REFERENCES vendors(vendor_id),
  change_reason  TEXT,
  note           TEXT,
  decided_via    TEXT CHECK (decided_via IN ('web','whatsapp','email')),
  decided_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_appr_req ON approvals(requirement_id);
CREATE INDEX IF NOT EXISTS idx_appr_user ON approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_appr_vendor ON approvals(vendor_id);

CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  at             TEXT,
  channel        TEXT,
  direction      TEXT,
  from_id        TEXT,
  to_id          TEXT,
  requirement_id TEXT REFERENCES requirements(requirement_id),
  body           TEXT,
  status         TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_req ON messages(requirement_id);

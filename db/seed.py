#!/usr/bin/env python3
"""Create the Clay schema and load the demo CSVs.

  python db/seed.py            # create tables if missing, load CSVs (idempotent)
  python db/seed.py --reset    # drop everything, recreate, reload

Target: SQLite ./clay.db by default; Postgres if DATABASE_URL is set (env or .env).
"""
import argparse, csv, os, re, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SCHEMA = ROOT / "db" / "schema.sql"

# (table, csv file, columns in file) - order respects foreign keys
LOAD = [
    ("projects", ["project_id", "project_name", "address"]),
    ("users", ["user_id", "name", "role", "project_id", "whatsapp", "email", "language"]),
    ("materials", ["material_code", "material_name", "category", "unit", "specification"]),
    ("stock", ["project_id", "material_code", "qty_available", "unit", "last_updated"]),
    ("vendors", ["vendor_id", "vendor_name", "category", "whatsapp", "email", "payment_terms"]),
    ("vendor_performance", ["vendor_id", "total_orders", "on_time_delivery_pct", "avg_quality_rating",
                            "avg_reply_hours", "reply_rate_pct", "last_updated"]),
    ("sample_vendor_replies", ["vendor_id", "material_code", "rate", "unit", "gst_included", "freight",
                               "delivery_days", "payment_terms", "raw_message"]),
]
RUNTIME = ["requirements", "requirement_lines", "rfqs", "rfq_recipients", "quotes",
           "rankings", "approvals", "messages"]
ALL_TABLES = [t for t, _ in LOAD] + RUNTIME


def load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:  # minimal fallback parser
        p = ROOT / ".env"
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def schema_for(postgres):
    sql = SCHEMA.read_text()
    if postgres:
        sql = sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    return sql


def split_statements(sql):
    sql = re.sub(r"^\s*--.*$", "", sql, flags=re.M)
    return [s.strip() for s in sql.split(";") if s.strip()]


def read_csv(table, cols):
    path = DATA / f"{table}.csv"
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = set(cols) - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"{path.name}: missing columns {sorted(missing)}")
        rows = [tuple((r[c].strip() if r[c] is not None and r[c].strip() != "" else None) for c in cols)
                for r in reader]
    if table in ("vendor_performance", "sample_vendor_replies"):
        # Keep the full historical/demo CSVs, but seed only records belonging to
        # configured vendors. Otherwise a smaller vendor list breaks FK checks.
        active_ids = {row[0] for row in read_csv("vendors", ["vendor_id"])}
        vendor_column = cols.index("vendor_id")
        rows = [row for row in rows if row[vendor_column] in active_ids]
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="drop and recreate all tables")
    args = ap.parse_args()
    load_env()
    url = os.environ.get("DATABASE_URL", "").strip()
    pg = bool(url)

    if pg:
        import psycopg
        conn = psycopg.connect(url)
        ph = "%s"
        target = "Postgres (DATABASE_URL)"
    else:
        conn = sqlite3.connect(ROOT / "clay.db")
        conn.execute("PRAGMA foreign_keys = ON")
        ph = "?"
        target = f"SQLite {ROOT / 'clay.db'}"
    print(f"Target: {target}")
    cur = conn.cursor()

    if args.reset:
        for t in reversed(ALL_TABLES):
            cur.execute(f"DROP TABLE IF EXISTS {t}" + (" CASCADE" if pg else ""))
    for stmt in split_statements(schema_for(pg)):
        cur.execute(stmt)

    # idempotent reload of seed tables (runtime tables are left untouched)
    for table, cols in reversed(LOAD):
        cur.execute(f"DELETE FROM {table}")
    for table, cols in LOAD:
        rows = read_csv(table, cols)
        cur.executemany(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join([ph] * len(cols))})", rows)
    conn.commit()

    print("Row counts:")
    for t in ALL_TABLES:
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        print(f"  {t:<24}{cur.fetchone()[0]}")
    conn.close()


if __name__ == "__main__":
    main()

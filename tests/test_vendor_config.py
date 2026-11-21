import csv
import sqlite3
import unittest
from collections import Counter
from db import seed


class VendorConfigurationTests(unittest.TestCase):
    def test_segment_scope_shared_inboxes_and_history_keys(self):
        def read(name):
            with (seed.DATA / (name + ".csv")).open(newline="") as f:
                return list(csv.DictReader(f))
        vendors = read("vendors")
        self.assertEqual(Counter(r["category"] for r in vendors), {"steel": 2, "cement": 2, "waterproofing": 2})
        self.assertEqual({r["vendor_id"] for r in vendors}, {r["vendor_id"] for r in read("vendor_performance")})
        for segment in {r["category"] for r in vendors}:
            group = [r["email"] for r in vendors if r["category"] == segment]
            self.assertEqual(len(group), len(set(group)))
        self.assertLess(len({r["email"] for r in vendors}), len(vendors))

    def test_seed_integrity_with_filtered_historical_vendor_replies(self):
        with sqlite3.connect(":memory:") as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.executescript(seed.schema_for(False))
            for table, cols in seed.LOAD:
                slots = ",".join("?" for _ in cols)
                db.executemany(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({slots})", seed.read_csv(table, cols))
            self.assertFalse(db.execute("PRAGMA foreign_key_check").fetchall())

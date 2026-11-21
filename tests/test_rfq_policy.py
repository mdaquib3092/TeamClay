import unittest

from mock.rfq_policy import MIN_RFQ_VENDORS, RFQSelectionError, select_rfq_vendors


class RFQPolicyTests(unittest.TestCase):
    def setUp(self):
        self.vendors = [
            {"id": "V01", "categories": ["steel"]},
            {"id": "V02", "categories": ["steel"]},
            {"id": "V05", "categories": ["cement"]},
        ]

    def test_two_eligible_vendors_are_sufficient(self):
        self.assertEqual(MIN_RFQ_VENDORS, 2)
        selected = select_rfq_vendors(["V01", "V02"], self.vendors, "steel")
        self.assertEqual([vendor["id"] for vendor in selected], ["V01", "V02"])

    def test_zero_or_one_vendor_is_rejected(self):
        for ids in ([], ["V01"]):
            with self.subTest(ids=ids), self.assertRaises(RFQSelectionError):
                select_rfq_vendors(ids, self.vendors, "steel")

    def test_duplicate_ids_do_not_satisfy_the_minimum(self):
        with self.assertRaises(RFQSelectionError):
            select_rfq_vendors(["V01", "V01"], self.vendors, "steel")

    def test_duplicate_ids_are_not_dispatched_twice(self):
        selected = select_rfq_vendors(["V01", "V02", "V01"], self.vendors, "steel")
        self.assertEqual(len(selected), 2)

    def test_unknown_or_wrong_segment_vendor_is_rejected(self):
        for second in ("UNKNOWN", "V05"):
            with self.subTest(second=second), self.assertRaises(RFQSelectionError):
                select_rfq_vendors(["V01", second], self.vendors, "steel")

    def test_malformed_input_is_rejected(self):
        for ids in (None, "V01,V02", ["V01", {}], ["V01", ""], ["V01"] * 101):
            with self.subTest(ids=ids), self.assertRaises(RFQSelectionError):
                select_rfq_vendors(ids, self.vendors, "steel")


if __name__ == "__main__":
    unittest.main()

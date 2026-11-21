import unittest

from templates.render_rfq import render_rfq


class RFQTemplateTests(unittest.TestCase):
    def context(self):
        return {
            "vendor_name": "Example Steel Supplier",
            "vendor_email": "vendor@example.test",
            "requirement_id": "REQ-2026-77",
            "item_summary": "TMT 12mm 1.6 MT + TMT 16mm 1 MT",
            "project_name": "Vinayak Amara",
            "contact_name": "Vendor team",
            "organisation": "Vinayak Group",
            "requirement_lines": "TMT 12mm, Fe500D — 1.6 MT\nTMT 16mm, Fe500D — 1 MT",
            "delivery_address": "Demo site address",
            "needed_by": "5 Dec 2026",
            "reply_deadline": "25 Nov 2026, 17:00 IST",
            "sender_name": "Debashis",
            "sender_role": "Project Manager",
        }

    def test_format_uses_case_values_not_the_example_requirement(self):
        result = render_rfq(self.context())
        self.assertEqual(result["recipient"], "vendor@example.test")
        self.assertEqual(result["subject"],
                         "RFQ · REQ-2026-77 · TMT 12mm 1.6 MT + TMT 16mm 1 MT · Vinayak Amara")
        self.assertIn("TMT 12mm, Fe500D — 1.6 MT", result["body"])
        self.assertIn("• Rate per unit, ex-GST", result["body"])
        self.assertIn("Needed by: 5 Dec 2026", result["body"])
        self.assertIn("Reply by: 25 Nov 2026, 17:00 IST", result["body"])
        self.assertTrue(result["body"].endswith("Debashis\nProject Manager, Vinayak Amara\nVinayak Group\n"))
        for example in ("REQ-1001", "10 MT", "8 MT", "28 Nov"):
            self.assertNotIn(example, result["preview"])

    def test_missing_values_are_not_invented(self):
        for field in ("reply_deadline", "contact_name", "sender_name", "needed_by"):
            context = self.context()
            context.pop(field)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, field):
                render_rfq(context)

    def test_header_injection_is_rejected(self):
        context = self.context()
        context["vendor_name"] = "Supplier\nBcc: another@example.test"
        with self.assertRaisesRegex(ValueError, "single line"):
            render_rfq(context)

    def test_multiple_recipients_are_rejected(self):
        context = self.context()
        context["vendor_email"] = "one@example.test,two@example.test"
        with self.assertRaisesRegex(ValueError, "one valid"):
            render_rfq(context)


if __name__ == "__main__":
    unittest.main()

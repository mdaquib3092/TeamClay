"""Render the owner's RFQ email format from actual case data, without sending."""

import re
from pathlib import Path
from string import Template

TEMPLATE_PATH = Path(__file__).with_name("rfq_email.txt")
FIELDS = (
    "vendor_name", "vendor_email", "requirement_id", "item_summary", "project_name",
    "contact_name", "organisation", "requirement_lines", "delivery_address",
    "needed_by", "reply_deadline", "sender_name", "sender_role",
)


def render_rfq(context):
    """Return recipient, subject, body and a readable To/Subject/body preview.

    All values must be provided explicitly. Example quantities, contact names,
    dates and signatories are never substituted as defaults.
    """
    values = {}
    for field in FIELDS:
        value = context.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Provide {field} from the procurement case.")
        value = value.strip()
        if field != "requirement_lines" and re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError(f"{field} must be a single line without control characters.")
        values[field] = value
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
                        values["vendor_email"]):
        raise ValueError("Provide one valid vendor_email, not a recipient list.")
    preview = Template(TEMPLATE_PATH.read_text(encoding="utf-8")).substitute(values)
    headers, body = preview.split("\n\n", 1)
    subject = headers.splitlines()[1].removeprefix("Subject: ")
    if len(subject) > 200:
        raise ValueError("Use an item_summary that keeps the RFQ subject within 200 characters.")
    return {
        "recipient": values["vendor_email"],
        "subject": subject,
        "body": body,
        "preview": preview,
    }

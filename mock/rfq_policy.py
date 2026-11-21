"""Deterministic RFQ recipient validation for the test-only mock."""

MIN_RFQ_VENDORS = 2


class RFQSelectionError(ValueError):
    pass


def select_rfq_vendors(vendor_ids, vendors, category):
    if (not isinstance(vendor_ids, list) or len(vendor_ids) > 100 or
            any(not isinstance(value, str) or not value.strip() for value in vendor_ids)):
        raise RFQSelectionError("Provide a list of at most 100 valid vendor IDs.")
    unique_ids = list(dict.fromkeys(vendor_ids))
    if len(unique_ids) < MIN_RFQ_VENDORS:
        raise RFQSelectionError("RFQs require at least two distinct eligible vendors.")
    if not isinstance(category, str) or not category.strip():
        raise RFQSelectionError("Confirm the package category before sending an RFQ.")
    category = category.strip().casefold()
    by_id = {vendor["id"]: vendor for vendor in vendors}
    selected = []
    for vendor_id in unique_ids:
        vendor = by_id.get(vendor_id)
        if vendor is None:
            raise RFQSelectionError(f"Vendor {vendor_id} was not found.")
        categories = vendor.get("categories", [])
        if not isinstance(categories, list) or category not in {
                value.strip().casefold() for value in categories if isinstance(value, str)}:
            raise RFQSelectionError(f"Vendor {vendor_id} is not eligible for this package category.")
        selected.append(vendor)
    return selected

"""Builds fixtures.json — the seeded Amara Tower-2 waterproofing package — in the exact API shapes.
Numbers come from the Vinayak data pack. Run: python build_fixtures.py
The backend's real comparative must reproduce these numbers; use them as the test oracle."""
import json, pathlib

T = "2026-11-21T11:30:00+05:30"
BOQ_FILE = "A_Amara_Waterproofing_quantities_Tower-2.xlsx"

def src(kind, file=None, page=None, ref=None, synced=T):
    return {"kind": kind, "file": file, "page": page, "ref": ref, "synced_at": synced}

def S(value, unit=None, source=None, conf=None, needs=False, flag=None):
    return {"value": value, "unit": unit, "source": source or src("computed"), "confidence": conf,
            "needs_confirmation": needs, "confirmed_by": None, "confirmed_at": None, "flag": flag}

def F(code, sev, text, refs=None):
    return {"code": code, "severity": sev, "text": text, "refs": refs or []}

# ---- BOQ (sheet "WO ITEM-WISE BOQ", TOTAL (SFT) column) ----
BOQ = [
    ("L-WP01", "WP.01", "Waterproofing at toilet floor", 13424.54, True),
    ("L-WP02", "WP.02", "Waterproofing at toilet wall (up to 450 mm)", 11554.46, True),
    ("L-WP03", "WP.03", "Waterproofing compound on toilet depression channel", None, False),
    ("L-WP04", "WP.04", "Waterproofing at kitchen & wash floor", 1801.81, True),
    ("L-WP05", "WP.05", "Waterproofing at kitchen & wash wall (wet area)", 1919.61, True),
    ("L-WP06", "WP.06", "Waterproofing at balcony & sky terrace floor", 8738.07, True),
    ("L-WP07", "WP.07", "Waterproofing at balcony & sky terrace wall (up to 200 mm)", 2442.68, True),
    ("L-WP08", "WP.08", "Nozzle grouting (if required)", None, False),
]
boq = [{
    "id": i, "wo_code": c, "description": d, "unit": "rmt" if c == "WP.03" else ("nos" if c == "WP.08" else "sqft"),
    "qty": S(q, "sqft" if q else None, src("site_boq", BOQ_FILE, None, f"WO ITEM-WISE BOQ · {c}"),
             flag=None if m else "NOT_MEASURED"),
    "measured": m, "item_code": None} for i, c, d, q, m in BOQ]
MEASURED = [b for b in boq if b["measured"]]

# ---- quotes: rates per WO code (sqft unless noted) ----
V = {
  "V-SK":   dict(name="S K Construction", file="Quotation_SK_Construction.pdf", pages=3, kind="quote_handwritten", date="2026-05-15",
               rates={"WP.01":34,"WP.02":34,"WP.04":34,"WP.05":34,"WP.06":34,"WP.07":34}, dep=(50,"rmt"),
               vqty={"WP.01":30420,"WP.02":26300,"WP.04":7590,"WP.05":1300,"WP.06":23720,"WP.07":11300},
               page={"WP.01":1,"WP.02":1,"WP.04":2,"WP.05":2,"WP.06":2,"WP.07":3},
               validity=None, gst=None, advance=None, payment=None),
  "V-BAJ":  dict(name="Bajrang Construction & Waterproofing", file="Quotation_Bajrang_Construction.pdf", pages=6, kind="quote_pdf_text", date="2026-05-21",
               rates={k:34.5 for k in ["WP.01","WP.02","WP.04","WP.05","WP.06","WP.07"]}, dep=(34.5,"sqm"),
               vqty={"WP.01":30420,"WP.02":26300,"WP.04":7590,"WP.05":1300,"WP.06":23720,"WP.07":11300},
               page={"WP.01":2,"WP.02":2,"WP.04":3,"WP.05":4,"WP.06":4,"WP.07":5},
               validity=45, gst=18, advance="25% with order", payment="RA bills paid within 30 days; final within 30 days of bill"),
  "V-SHY":  dict(name="Shyama", file="Quotation_Shyama.pdf", pages=None, kind="quote_pdf_text", date=None,
               rates={"WP.01":42,"WP.02":42,"WP.04":38,"WP.05":38,"WP.06":42,"WP.07":42}, dep=(87,"rmt"),
               vqty={"WP.01":30420,"WP.02":26300,"WP.04":7590,"WP.05":1300,"WP.06":23720,"WP.07":11300},
               page={}, validity=None, gst=18, advance=None, payment="To be fixed after discussion"),
  "V-PUR":  dict(name="Purvyakruti Sales & Services Pvt Ltd", file="Quotation_Purvyakruti.pdf", pages=4, kind="quote_pdf_text", date="2026-11-17",
               rates={k:47 for k in ["WP.01","WP.02","WP.04","WP.05","WP.06","WP.07"]}, dep=(47,"rmt"),
               vqty={"WP.01":13429.53,"WP.02":11558.76,"WP.04":1802.48,"WP.05":1920.32,"WP.06":8741.32,"WP.07":2443.59},
               page={"WP.01":1,"WP.02":1,"WP.04":2,"WP.05":2,"WP.06":2,"WP.07":3},
               validity=None, gst=18, advance="50% material secured advance against supply at site",
               payment="Monthly RA bill paid within 7 days; final bill within 15 days"),
}
OLD_QTY = "Priced on ~100,630 sqft — an older quantity set, ~2.5× the site BOQ (39,881 sqft). Quoted totals are not comparable; unit rates are."

quotes, flags_by_v = [], {}
for vid, v in V.items():
    hw = v["kind"] == "quote_handwritten"
    lines = []
    for b in boq:
        c = b["wo_code"]
        if c == "WP.03":
            r, u = v["dep"]
            fl = [F("NOT_MEASURED", "info", "Site did not measure the depression channel; excluded from totals.")]
            if u != "rmt": fl.append(F("UNIT_MISMATCH", "warn", f"Quoted per {u.upper()}, others per RMT; not comparable."))
            lines.append({"id": f"Q-{vid[2:]}-{b['id']}", "line_id": b["id"], "vendor_description": "Waterproofing on toilet depression",
                          "vendor_qty": S(None, u, src(v["kind"], v["file"])),
                          "rate": S(r, f"₹/{u}", src(v["kind"], v["file"], v["page"].get("WP.02")), 0.6 if hw else 0.95, hw, "NOT_COMPARABLE_UNIT" if u != "rmt" else None),
                          "flags": fl})
            continue
        if c == "WP.08":
            lines.append({"id": f"Q-{vid[2:]}-{b['id']}", "line_id": b["id"], "vendor_description": "—",
                          "vendor_qty": S(None), "rate": S(None, None, src(v["kind"], v["file"]), flag="NOT_QUOTED"),
                          "flags": [F("NOT_QUOTED", "info", "No vendor priced nozzle grouting.")]})
            continue
        lines.append({"id": f"Q-{vid[2:]}-{b['id']}", "line_id": b["id"], "vendor_description": b["description"],
                      "vendor_qty": S(v["vqty"][c], "sqft", src(v["kind"], v["file"], v["page"].get(c), f"item {c}")),
                      "rate": S(v["rates"][c], "₹/sqft", src(v["kind"], v["file"], v["page"].get(c), f"item {c}"),
                                0.6 if hw else 0.97, hw),
                      "flags": [F("HANDWRITTEN_UNCONFIRMED", "warn", "Handwritten rate — confirm against the scan.")] if hw else []})
    qf = []
    if vid != "V-PUR": qf.append(F("QTY_SET_MISMATCH", "warn", OLD_QTY))
    if vid == "V-BAJ": qf += [F("VALIDITY_LAPSED", "block", "Dated 21 May 2026, valid 45 days → lapsed ~5 Jul 2026. Needs re-confirmation."),
                              F("ADVANCE_WITH_ORDER", "warn", "Asks 25% payment with the order.")]
    if vid == "V-SK":  qf += [F("TERMS_MISSING", "warn", "No payment terms, validity or conditions in the quote."),
                              F("GST_NOT_STATED", "warn", "GST not mentioned."),
                              F("HANDWRITTEN_UNCONFIRMED", "block", "Rates are handwritten on a scan; a person must confirm them.")]
    if vid == "V-SHY": qf += [F("PAYMENT_TERMS_OPEN", "warn", "Payment terms 'to be fixed after discussion'."),
                              F("TERMS_MISSING", "info", "No quote date or validity found.")]
    if vid == "V-PUR": qf += [F("MATERIAL_ADVANCE", "info", "50% material secured advance against supply at site.")]
    flags_by_v[vid] = qf
    fs = lambda val, unit=None: S(val, unit, src(v["kind"], v["file"], None, "terms"), None if val is None else 0.9)
    quotes.append({"id": f"Q-{vid[2:]}", "vendor_id": vid, "vendor_name": v["name"], "file": v["file"],
                   "file_url": f"/api/v1/quotes/Q-{vid[2:]}/file", "pages": v["pages"],
                   "extraction_state": "needs_confirmation" if hw else "ready",
                   "quote_date": fs(v["date"]), "validity_days": fs(v["validity"], "days"),
                   "gst_pct": fs(v["gst"], "%"), "gst_included": False if v["gst"] else None,
                   "advance": fs(v["advance"]), "payment_terms": fs(v["payment"]),
                   "freight": fs(None), "start_or_delivery": fs("Start within 14 days of order" if vid == "V-BAJ" else None),
                   "lines": lines, "flags": qf})

# ---- comparative (the oracle) ----
TERMS_RULES = {"VALIDITY_LAPSED": 30, "TERMS_MISSING": 30, "GST_NOT_STATED": 10, "PAYMENT_TERMS_OPEN": 20,
               "ADVANCE_WITH_ORDER": 15, "MATERIAL_ADVANCE": 5, "HANDWRITTEN_UNCONFIRMED": 10}
W = {"price": 0.6, "terms": 0.2, "history": 0.2}
totals = {vid: round(sum(v["rates"][b["wo_code"]] * b["qty"]["value"] for b in MEASURED), 2) for vid, v in V.items()}
low = min(totals.values())
cols = []
for vid, v in V.items():
    seen = {f["code"] for f in flags_by_v[vid] if f["severity"] != "info" or f["code"] in ("TERMS_MISSING", "MATERIAL_ADVANCE")}
    terms = max(0, 100 - sum(TERMS_RULES.get(c, 0) for c in seen))
    price = round(low / totals[vid] * 100, 1)
    # no vendor has history → history weight is redistributed pro rata
    wp, wt = W["price"] / (W["price"] + W["terms"]), W["terms"] / (W["price"] + W["terms"])
    cols.append({"vendor_id": vid, "vendor_name": v["name"],
                 "total_ex_gst": S(totals[vid], "₹"), "total_incl_gst": S(round(totals[vid] * 1.18, 2), "₹"),
                 "vs_lowest_pct": round((totals[vid] / low - 1) * 100, 1),
                 "scores": {"price": price, "terms": terms, "history": None, "total": round(price * wp + terms * wt, 1)},
                 "terms_summary": {"validity": {"V-BAJ": "45 days — lapsed ~5 Jul", "V-PUR": "Dated 17 Nov (current)"}.get(vid, "Not stated"),
                                   "advance": v["advance"] or "Not stated", "payment": v["payment"] or "Not stated",
                                   "gst": f"{v['gst']}% extra" if v["gst"] else "Not stated"},
                 "flags": flags_by_v[vid] + [F("NO_HISTORY", "info", "No past-performance record yet.")], "rank": 0, "reason": ""})
cols.sort(key=lambda c: -c["scores"]["total"])
REASON = {
 "V-SK": "Lowest rate (₹34/sqft) but handwritten and unconfirmed, no terms or GST stated, and priced on an older quantity set.",
 "V-BAJ": "Within 1.5% of the lowest, with clear terms, but the offer lapsed in July, asks 25% with the order, and used the older quantities.",
 "V-SHY": "Mid-priced (₹38–42/sqft); payment terms left open and no quote date; older quantity set.",
 "V-PUR": "Highest rate (₹47/sqft, 38% above lowest) but the only current quote priced on Vinayak's own BOQ, with complete terms.",
}
for i, c in enumerate(cols, 1): c["rank"], c["reason"] = i, REASON[c["vendor_id"]]
rows = []
for b in boq:
    comparable = b["measured"]
    cells = []
    for vid, v in V.items():
        r = v["rates"].get(b["wo_code"])
        if b["wo_code"] == "WP.03": r = v["dep"][0]
        rs = S(r, None, src(v["kind"], v["file"], v["page"].get(b["wo_code"])), needs=v["kind"] == "quote_handwritten" and r is not None)
        amt = S(round(r * b["qty"]["value"], 2), "₹") if comparable and r is not None else S(None, flag="NOT_COMPARABLE")
        cells.append({"vendor_id": vid, "rate": rs, "amount": amt})
    rows.append({"line_id": b["id"], "wo_code": b["wo_code"], "description": b["description"], "unit": b["unit"],
                 "qty": b["qty"], "comparable": comparable, "cells": cells,
                 "flags": [] if comparable else [F("NOT_MEASURED", "info", "Not measured by site — excluded from totals.")]})
comparative = {
  "package_id": "PKG-AMARA-T2-WP",
  "basis": "Unit rates × Vinayak site BOQ quantities (39,881 sqft, 6 measured items), ex-GST",
  "weights": W, "weights_note": "No vendor has past-performance history, so the history weight is shared pro rata between price and terms.",
  "rows": rows, "vendors": cols,
  "package_flags": [F("QTY_SET_MISMATCH", "warn", "3 of 4 vendors priced ~100,630 sqft vs the site BOQ of 39,881 sqft.", ["V-SK", "V-BAJ", "V-SHY"]),
                    F("NOT_QUOTED", "info", "Nobody priced WP.08 nozzle grouting; WP.03 not measured by site.")],
  "recommendation": {
    "action": "requote_first", "vendor_id": None,
    "text": "Purvyakruti's is the only current quote on the right quantities and is 38% above the lowest rate. Recommend asking SK, Bajrang and Shyama to re-quote on 39,881 sqft before deciding.",
    "reasons": ["3 of 4 quotes use an older quantity set (~2.5× site BOQ).",
                "Bajrang's offer lapsed in July; SK's rates are handwritten and unconfirmed.",
                "Price gap to the only current quote is about ₹5.2 L ex-GST — worth one re-quote round."],
    "blocking_flags": ["QTY_SET_MISMATCH", "VALIDITY_LAPSED", "HANDWRITTEN_UNCONFIRMED"]},
  "generated_at": T}

# ---- item codes (subset with the real duplicate / collision cases) ----
item_matches = [{
  "line_id": b["id"], "line_description": b["description"],
  "candidates": [{"code": b["wo_code"], "description": b["description"].upper(), "confidence": 0.96, "reason": "Exact match to the site's WO code"},
                 {"code": b["wo_code"] + ".A", "description": b["description"].upper() + "-A", "confidence": 0.71, "reason": "Same work, '-A' variant from another project"}],
  "flags": ([F("CODE_COLLISION", "warn", "WP.04.B means kitchen FLOOR in one block and kitchen WALL in another. Avoid the .B codes.", ["WP.04.B"])] if b["wo_code"] in ("WP.04", "WP.05") else [])
           + ([F("DUPLICATE_CODE", "info", "WP.11.B appears twice in the item master.", ["WP.11.B"])] if b["wo_code"] == "WP.08" else []),
  "suggest_new_code": None, "selected": None} for b in boq]
dupes = [F("DUPLICATE_CODE", "warn", "W.P.01–W.P.05 each appear twice (rows 9–13 and 40–44).", ["W.P.01", "W.P.02", "W.P.03", "W.P.04", "W.P.05"]),
         F("DUPLICATE_CODE", "warn", "WP.11.B appears twice (rows 32 and 38).", ["WP.11.B"]),
         F("CODE_COLLISION", "block", "WP.04.B = kitchen floor (row 24) and kitchen wall (row 65).", ["WP.04.B"]),
         F("CODE_COLLISION", "warn", "WP.07.B = balcony wall (row 27) and OT floor & wall (row 68).", ["WP.07.B"])]

TERMS6 = ["PF & ESI registration required.", "TDS will be deducted as per Govt. norms.",
          "5% Security deposit will be released after 12 months of total completion of work.", "GST will be paid extra.",
          "Water & Electricity at a point and Labour hutment will be provided.", "Safety PPE cost will be under Contractor's scope."]
vendors = [{"id": vid, "name": v["name"], "categories": ["waterproofing"], "test_inbox": f"{vid.lower()}@test.clay.local", "has_history": False}
           for vid, v in V.items()]

def tl(at, actor, role, text, st): return {"at": at, "actor": actor, "role": role, "text": text, "status_to": st}
package = {"id": "PKG-AMARA-T2-WP", "title": "Waterproofing — Amara Tower-2", "project": "Vinayak Amara", "tower": "Tower-2",
           "category": "waterproofing", "status": "COMPARATIVE_READY", "quotes_in": 4, "rfq_sent": 4, "updated_at": T,
           "needed_by": None, "requested_by": "Arijit Dey (QS & Billing, site)",
           "timeline": [tl("2026-11-11T19:41:00+05:30", "Arijit Dey", "site_engineer", "Requirement sent with quantity sheet", "REQUIREMENT"),
                        tl("2026-11-16T13:20:00+05:30", "Clay", None, "6 of 8 lines coded; WP.03, WP.08 not measured", "CODED"),
                        tl("2026-11-16T18:14:00+05:30", "Soham Saha", "desk", "RFQ sent to 4 test inboxes", "RFQ_SENT"),
                        tl("2026-11-17T12:00:00+05:30", "Clay", None, "4 quotes read; SK has handwritten rates", "QUOTES_IN"),
                        tl(T, "Clay", None, "Comparative ready — recommends a re-quote round", "COMPARATIVE_READY")],
           "allowed_actions": ["confirm_cells", "send_to_hod"]}

def msg(i, frm, typ, **k):
    base = {"id": i, "from": frm, "type": typ, "lang": None, "body": None, "audio_seconds": None, "transcript": None, "header": None,
            "fields": [], "buttons": [], "list": [], "footer": None, "link": None, "at": T}
    base.update(k); return base
sim = {
  "site_voice": {"replies": [
      msg("m1", "clay", "card", lang="bn", header="নতুন রিকোয়ারমেন্ট · Requirement draft",
          fields=[{"k": "Project", "v": "Vinayak Amara · Tower-2"}, {"k": "Work", "v": "Waterproofing — toilets, kitchen/wash, balcony, FRP"},
                  {"k": "Qty", "v": "39,881 sqft (from attached sheet)"}, {"k": "Start", "v": "Nov 2026 · finish Jun 2028"}],
          transcript="Tower-2 er waterproofing er kaaj, toilet, kitchen, balcony, quantity sheet pathiyechi",
          buttons=[{"id": "req_confirm", "title": "Confirm"}, {"id": "req_edit", "title": "Edit"}],
          footer="Source: voice note + site BOQ · synced 11:30")],
    "trace": [{"n": 1, "tool": "transcribe", "status": "ok", "ms": 1400, "args": "lang=bn", "source": None, "note": "conf 0.88"},
              {"n": 2, "tool": "parse_requirement", "status": "ok", "ms": 2100, "args": "sarvam-105b", "source": BOQ_FILE, "note": None}],
    "package_id": "PKG-AMARA-T2-WP"},
  "site_bad_audio": {"replies": [
      msg("m2", "clay", "buttons", lang="bn", body="দুঃখিত, পরিষ্কার শুনতে পাইনি। লিখে পাঠান বা বেছে নিন:",
          buttons=[{"id": "new_req", "title": "New requirement"}, {"id": "status", "title": "Status"}, {"id": "rate_vendor", "title": "Rate a vendor"}])],
    "trace": [{"n": 1, "tool": "transcribe", "status": "fallback", "ms": 1900, "args": "lang=bn", "source": None, "note": "conf 0.41 < 0.60 → menu"}],
    "package_id": None},
  "hod_card": {"replies": [
      msg("m3", "clay", "card", header="Approval needed · Waterproofing, Amara T-2",
          fields=[{"k": "Quotes", "v": "4 · ₹13.56 L – ₹18.74 L ex-GST"}, {"k": "Recommendation", "v": "Re-quote SK, Bajrang, Shyama on 39,881 sqft"},
                  {"k": "Why", "v": "3 quotes on old qty · Bajrang lapsed · SK handwritten"}],
          buttons=[{"id": "hod_approve", "title": "Approve"}, {"id": "hod_send_back", "title": "Send back"}, {"id": "hod_ask", "title": "Ask a question"}],
          footer="Source: comparative · 4 quotes · computed 11:30", link="/packages/PKG-AMARA-T2-WP/comparative")],
    "trace": [{"n": 1, "tool": "send_to_hod", "status": "handoff", "ms": 210, "args": "PKG-AMARA-T2-WP", "source": "comparative", "note": "agent recommends only"}],
    "package_id": "PKG-AMARA-T2-WP"},
  "rate_vendor": {"replies": [
      msg("m4", "clay", "buttons", body="Purvyakruti finished the mock-up floor. Quality of work?",
          buttons=[{"id": "q_5", "title": "Good (5)"}, {"id": "q_3", "title": "OK (3)"}, {"id": "q_1", "title": "Poor (1)"}],
          footer="Saved to vendor history · used in future rankings")],
    "trace": [{"n": 1, "tool": "rating_prompt", "status": "ok", "ms": 80, "args": "V-PUR", "source": None, "note": None}], "package_id": None},
}

out = {"package": package, "boq": boq, "item_matches": item_matches, "item_code_dupes": dupes,
       "rfq_draft": {"subject": "SEEKING QUOTATION FOR WATERPROOFING WORK AT VINAYAK AMARA",
                     "body": "Dear Sir,\n\nPlease find attached the description of work. You are requested to kindly submit your commercial quotation in accordance with the specifications in the attached file and the points below. Please price the quantities in the attached BOQ (39,881 sqft).\n\n{terms}\n\nThanks & Regards,\nSoham Saha\nSr. Engineer | Contracts & Planning",
                     "terms": TERMS6, "attachments": ["BOQ_Specification_Waterproofing_Amara_Tower-2_rates_blank.pdf"],
                     "suggested_vendor_ids": list(V)},
       "rfq_status": [{"vendor_id": vid, "vendor_name": v["name"], "state": "quote_received", "sent_to": f"{vid.lower()}@test.clay.local",
                       "sent_at": "2026-11-16T18:14:00+05:30", "next_follow_up_at": None} for vid, v in V.items()],
       "vendors": vendors, "quotes": quotes, "comparative": comparative, "sim": sim}
p = pathlib.Path(__file__).with_name("fixtures.json")
p.write_text(json.dumps(out, ensure_ascii=False, indent=1))
print("wrote", p)
for c in cols: print(c["rank"], c["vendor_name"], c["total_ex_gst"]["value"], c["scores"])

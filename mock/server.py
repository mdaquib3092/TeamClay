"""Mock of the Clay Procurement API — same paths and shapes as openapi.yaml, backed by fixtures.json.
Frontend points at http://localhost:8001/api/v1 until the real backend is ready, then swaps the base URL.
Run: uvicorn server:app --port 8001 --reload     (from this folder)
State is in memory; POST /api/v1/sim/reset restores the seed."""
import copy, json, pathlib, uuid
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

IST = timezone(timedelta(hours=5, minutes=30))
SEED = json.loads(pathlib.Path(__file__).with_name("fixtures.json").read_text())
DB: dict = {}
AUDIT: list = []
APPROVALS: dict = {}

def reset():
    DB.clear(); DB.update(copy.deepcopy(SEED)); AUDIT.clear(); APPROVALS.clear()
reset()

app = FastAPI(title="Clay Procurement API — MOCK")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
P = "/api/v1"
now = lambda: datetime.now(IST).isoformat(timespec="seconds")

class ApiError(Exception):
    def __init__(self, status, code, message): self.status, self.code, self.message = status, code, message

@app.exception_handler(ApiError)
async def _err(_, e: ApiError):
    return JSONResponse(status_code=e.status, content={"error": {"code": e.code, "message": e.message}})

def log(role, user, tool, status, detail, pkg=None):
    AUDIT.insert(0, {"at": now(), "role": role, "user": user, "tool": tool, "status": status, "package_id": pkg, "detail": detail})

def pkg(pid):
    if pid != DB["package"]["id"]: raise ApiError(404, "NOT_FOUND", f"No package {pid}.")
    return DB["package"]

def set_status(st, actor, role, text):
    p = DB["package"]; p["status"] = st; p["updated_at"] = now()
    p["timeline"].append({"at": now(), "actor": actor, "role": role, "text": text, "status_to": st})
    p["allowed_actions"] = {"WITH_HOD": ["decide"], "APPROVED": ["rate_vendor"], "SENT_BACK": ["draft_rfq", "send_rfq"]}.get(st, p["allowed_actions"])

# ---------- packages ----------
@app.get(P + "/packages")
def list_packages(x_role: str = Header(...), x_user: str = Header(...), status: str | None = None):
    p = DB["package"]
    s = {k: p[k] for k in ["id", "title", "project", "tower", "category", "status", "quotes_in", "rfq_sent", "updated_at"]}
    return {"data": [s] if not status or status == p["status"] else []}

@app.get(P + "/packages/{pid}")
def get_package(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    p = copy.deepcopy(pkg(pid))
    if x_role == "hod": p["allowed_actions"] = ["decide"] if p["status"] == "WITH_HOD" else []
    if x_role == "site_engineer": p["allowed_actions"] = ["rate_vendor"] if p["status"] == "APPROVED" else []
    return {"data": p}

# ---------- requirement ----------
@app.post(P + "/requirements/parse")
async def parse_req(req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    b = await req.json()
    text = (b.get("text") or "").lower()
    if not text and not b.get("audio_b64"): raise ApiError(422, "VALIDATION", "Send text or a voice note.")
    if "noisy" in text: raise ApiError(422, "STT_LOW_CONFIDENCE", "Could not hear clearly. Please type or pick from the menu.")
    log(x_role, x_user, "parse_requirement", "ok", text[:60] or "voice note")
    return {"data": {"project": "Vinayak Amara", "tower": "Tower-2", "category": "waterproofing", "needed_by": None,
                     "items": [{"description": b_["description"], "qty": b_["qty"]["value"], "unit": b_["unit"]} for b_ in DB["boq"]],
                     "missing_fields": ["needed_by"], "transcript": b.get("text") or "Tower-2 er waterproofing er kaaj…",
                     "language": b.get("lang_hint") or "mixed", "stt_confidence": 0.88 if b.get("audio_b64") else None}}

@app.post(P + "/requirements", status_code=201)
async def create_req(req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    await req.json(); log(x_role, x_user, "create_package", "ok", "requirement confirmed", DB["package"]["id"])
    return {"data": DB["package"]}

@app.get(P + "/packages/{pid}/boq")
def get_boq(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); return {"data": DB["boq"], "flags": [f for f in DB["comparative"]["package_flags"] if f["code"] == "NOT_QUOTED"]}

# ---------- item codes ----------
@app.get(P + "/packages/{pid}/item-matches")
def item_matches(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); return {"data": DB["item_matches"]}

@app.put(P + "/packages/{pid}/item-matches/{line_id}")
async def pick_code(pid: str, line_id: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); b = await req.json()
    m = next((m for m in DB["item_matches"] if m["line_id"] == line_id), None)
    if not m: raise ApiError(404, "NOT_FOUND", f"No line {line_id}.")
    m["selected"] = b.get("code") or b.get("new_code")
    for l in DB["boq"]:
        if l["id"] == line_id: l["item_code"] = m["selected"]
    log(x_role, x_user, "select_item_code", "ok", f"{line_id} → {m['selected']}", pid)
    return {"data": m, "package_status": DB["package"]["status"]}

@app.get(P + "/item-codes")
def item_codes(q: str = "", x_role: str = Header(...), x_user: str = Header(...)):
    codes = [{"code": c["code"], "description": c["description"], "row": None} for m in DB["item_matches"] for c in m["candidates"]]
    return {"data": [c for c in codes if q.lower() in (c["code"] + c["description"]).lower()]}

@app.get(P + "/item-codes/duplicates")
def dupes(x_role: str = Header(...), x_user: str = Header(...)):
    return {"data": DB["item_code_dupes"]}

# ---------- RFQ ----------
@app.post(P + "/packages/{pid}/rfq/draft")
def rfq_draft(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); d = copy.deepcopy(DB["rfq_draft"])
    d["body"] = d["body"].replace("{terms}", "\n".join(f"{i}. {t}" for i, t in enumerate(d["terms"], 1)))
    return {"data": d}

@app.post(P + "/packages/{pid}/rfq/send")
async def rfq_send(pid: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); b = await req.json()
    if len(b.get("vendor_ids", [])) < 3: raise ApiError(422, "VALIDATION", "SOP needs at least three vendors.")
    out = []
    for v in DB["vendors"]:
        if v["id"] in b["vendor_ids"]:
            out.append({"vendor_id": v["id"], "vendor_name": v["name"], "state": "sent", "sent_to": v["test_inbox"], "sent_at": now(),
                        "next_follow_up_at": (datetime.now(IST) + timedelta(days=2)).isoformat(timespec="seconds")})
    log(x_role, x_user, "send_rfq", "ok", f"{len(out)} test inboxes", pid)
    return {"data": out}

@app.get(P + "/packages/{pid}/rfq")
def rfq_status(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); return {"data": DB["rfq_status"]}

# ---------- quotes ----------
@app.get(P + "/packages/{pid}/quotes")
def quotes(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); return {"data": DB["quotes"]}

@app.post(P + "/packages/{pid}/quotes", status_code=202)
async def upload_quote(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); q = copy.deepcopy(DB["quotes"][0]); q["extraction_state"] = "reading"
    return {"data": q}

def find_quote(qid):
    q = next((q for q in DB["quotes"] if q["id"] == qid), None)
    if not q: raise ApiError(404, "NOT_FOUND", f"No quote {qid}.")
    return q

@app.get(P + "/quotes/{qid}")
def get_quote(qid: str, x_role: str = Header(...), x_user: str = Header(...)):
    return {"data": find_quote(qid)}

@app.put(P + "/quotes/{qid}/cells/{cell_id}")
async def confirm_cell(qid: str, cell_id: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    q = find_quote(qid); b = await req.json()
    line_id, _, field = cell_id.rpartition(".")
    line = next((l for l in q["lines"] if l["id"] == line_id), None)
    if not line or field not in ("rate", "vendor_qty"): raise ApiError(404, "NOT_FOUND", f"No cell {cell_id}.")
    cell = line[field]
    cell.update(value=b["value"], needs_confirmation=False, confirmed_by=x_user, confirmed_at=now(), confidence=1.0)
    line["flags"] = [f for f in line["flags"] if f["code"] != "HANDWRITTEN_UNCONFIRMED"]
    if not any(l["rate"]["needs_confirmation"] for l in q["lines"]):
        q["extraction_state"] = "ready"; q["flags"] = [f for f in q["flags"] if f["code"] != "HANDWRITTEN_UNCONFIRMED"]
    log(x_role, x_user, "confirm_cell", "ok", f"{cell_id} = {b['value']}")
    return {"data": cell}

# ---------- comparative ----------
@app.get(P + "/packages/{pid}/comparative")
def comparative(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); return {"data": DB["comparative"]}

@app.put(P + "/packages/{pid}/comparative/weights")
async def weights(pid: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); w = await req.json(); c = DB["comparative"]; c["weights"] = w
    pt = (w["price"] + w["terms"]) or 1
    for v in c["vendors"]:
        s = v["scores"]; s["total"] = round((s["price"] * w["price"] + s["terms"] * w["terms"]) / pt, 1)
    c["vendors"].sort(key=lambda v: -v["scores"]["total"])
    for i, v in enumerate(c["vendors"], 1): v["rank"] = i
    log(x_role, x_user, "set_weights", "ok", json.dumps(w), pid)
    return {"data": c}

# ---------- approval ----------
@app.post(P + "/packages/{pid}/send-to-hod")
def send_to_hod(pid: str, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid)
    if x_role not in ("desk", "admin"): raise ApiError(403, "ROLE_DENIED", "Only the procurement desk sends to the HOD.")
    a = {"id": "APR-" + uuid.uuid4().hex[:6], "package_id": pid, "state": "pending", "sent_to": "HOD (WhatsApp + web)",
         "sent_at": now(), "decided_by": None, "decided_at": None, "decision_reason": None, "undo_until": None}
    APPROVALS[a["id"]] = a; DB["approval_id"] = a["id"]
    set_status("WITH_HOD", x_user, x_role, "Recommendation sent to HOD")
    log(x_role, x_user, "send_to_hod", "handoff", "agent recommends only", pid)
    return {"data": a}

@app.post(P + "/packages/{pid}/decision")
async def decide(pid: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    pkg(pid); b = await req.json()
    if x_role != "hod":
        log(x_role, x_user, "decide", "denied", "only HOD decides", pid)
        raise ApiError(403, "ROLE_DENIED", "Only the HOD can approve or send back.")
    if DB["package"]["status"] != "WITH_HOD": raise ApiError(409, "INVALID_STATE", "Nothing waiting for a decision.")
    if b["decision"] == "send_back" and not b.get("reason"): raise ApiError(422, "VALIDATION", "Please give a reason.")
    a = APPROVALS[DB["approval_id"]]
    a.update(state="approved" if b["decision"] == "approve" else "sent_back", decided_by=x_user, decided_at=now(),
             decision_reason=b.get("reason"), undo_until=(datetime.now(IST) + timedelta(minutes=5)).isoformat(timespec="seconds"))
    set_status("APPROVED" if b["decision"] == "approve" else "SENT_BACK", x_user, "hod", b.get("reason") or "Approved")
    log(x_role, x_user, "decide", "ok", b["decision"], pid)
    return {"data": a}

@app.post(P + "/approvals/{aid}/undo")
def undo(aid: str, x_role: str = Header(...), x_user: str = Header(...)):
    a = APPROVALS.get(aid)
    if not a: raise ApiError(404, "NOT_FOUND", "No such approval.")
    if not a["undo_until"] or datetime.fromisoformat(a["undo_until"]) < datetime.now(IST):
        raise ApiError(409, "INVALID_STATE", "Undo window has passed.")
    a.update(state="pending", decided_by=None, decided_at=None, decision_reason=None, undo_until=None)
    set_status("WITH_HOD", x_user, x_role, "Decision undone")
    return {"data": a}

# ---------- vendors ----------
RATINGS: dict = {}

@app.get(P + "/vendors")
def vendors(category: str | None = None, x_role: str = Header(...), x_user: str = Header(...)):
    return {"data": [v for v in DB["vendors"] if not category or category in v["categories"]]}

@app.patch(P + "/vendors/{vid}")
async def patch_vendor(vid: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    v = next((v for v in DB["vendors"] if v["id"] == vid), None)
    if not v: raise ApiError(404, "NOT_FOUND", f"No vendor {vid}.")
    v.update({k: val for k, val in (await req.json()).items() if k in ("categories", "test_inbox")})
    return {"data": v}

@app.get(P + "/vendors/{vid}/ratings")
def get_ratings(vid: str, x_role: str = Header(...), x_user: str = Header(...)):
    rs = RATINGS.get(vid, []); n = len(rs)
    avg = lambda k: round(sum(r[k] for r in rs) / n, 2) if n else None
    hs = round((avg("quality") + avg("delivery") + avg("disputes")) / 15 * 100, 1) if n else None
    return {"data": rs, "summary": {"count": n, "avg_quality": avg("quality"), "avg_delivery": avg("delivery"),
                                    "avg_disputes": avg("disputes"), "history_score": hs}}

@app.post(P + "/vendors/{vid}/ratings", status_code=201)
async def add_rating(vid: str, req: Request, x_role: str = Header(...), x_user: str = Header(...)):
    r = await req.json(); r.update(rated_by=x_user, rated_at=now(), demo=r.get("demo", True))
    RATINGS.setdefault(vid, []).append(r)
    for v in DB["vendors"]:
        if v["id"] == vid: v["has_history"] = True
    log(x_role, x_user, "rate_vendor", "ok", f"{vid} q{r['quality']} d{r['delivery']} x{r['disputes']}")
    return {"data": r}

# ---------- simulator ----------
@app.post(P + "/sim/message")
async def sim(req: Request):
    b = await req.json(); s = DB["sim"]
    key = {"site_bn_waterproofing": "site_voice", "noisy": "site_bad_audio"}.get(b.get("demo_audio") or "")
    if not key:
        bid = b.get("button_id") or ""
        if b["role"] == "hod" and not bid: key = "hod_card"
        elif bid == "rate_vendor" or "rate" in (b.get("text") or "").lower(): key = "rate_vendor"
        elif b["type"] == "audio": key = "site_voice"
        elif bid.startswith("hod_") or bid in ("req_confirm", "q_5", "q_3", "q_1"):
            body = {"hod_approve": "Approved. Soham and the site have been told. 5 minutes to undo.",
                    "hod_send_back": "Please type the reason. It goes to Soham.",
                    "hod_ask": "Ask me anything about these 4 quotes.",
                    "req_confirm": "Saved as package PKG-AMARA-T2-WP. Soham's desk has it."}.get(bid, "Thanks, saved to vendor history.")
            return {"data": {"conversation_id": b.get("conversation_id") or "c1", "package_id": DB["package"]["id"],
                             "replies": [{"id": uuid.uuid4().hex[:6], "from": "clay", "type": "text", "lang": None, "body": body,
                                          "audio_seconds": None, "transcript": None, "header": None, "fields": [], "buttons": [], "list": [],
                                          "footer": None, "link": None, "at": now()}],
                             "trace": [{"n": 1, "tool": bid, "status": "ok", "ms": 120, "args": "", "source": None, "note": None}]}}
        else: key = "site_bad_audio"
    out = copy.deepcopy(s[key]); out["conversation_id"] = b.get("conversation_id") or "c1"
    log(b["role"], b["user"], out["trace"][-1]["tool"], out["trace"][-1]["status"], key, out.get("package_id"))
    return {"data": out}

@app.post(P + "/sim/reset")
def sim_reset(): reset(); RATINGS.clear(); return {"ok": True}

@app.get(P + "/audit")
def audit(package_id: str | None = None, limit: int = 50, x_role: str = Header(...), x_user: str = Header(...)):
    return {"data": [a for a in AUDIT if not package_id or a["package_id"] == package_id][:limit]}

@app.get(P + "/health")
def health(): return {"api": "mock", "stt": "up", "llm": "up", "email_sink": "test_only"}

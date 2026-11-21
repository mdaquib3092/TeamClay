import { useEffect, useState } from "react";
import { useStore } from "../store.jsx";
import { request, deskPath } from "../api.mjs";
import { RankingTable } from "../components/Req.jsx";
import { Tabs } from "../components/ui.jsx";

const UNITS = ["sqm", "sqft", "m", "kg", "nos", "lot", "cum", "ton"];
const nullable = value => value === "" || value == null ? null : Number(value);
const newLine = () => ({ id: crypto.randomUUID(), code: "NEW", description: "", quantity: null, unit: "sqm", itemId: null, specification: "", optional: false, sourceRef: "Human-reviewed input" });
const Field = ({ label, children }) => <div className="field"><label>{label}</label>{children}</div>;
const Unit = ({ value, onChange }) => <select value={value || ""} onChange={event => onChange(event.target.value || null)}><option value="">Unknown</option>{UNITS.map(unit => <option key={unit}>{unit}</option>)}</select>;

function Capture({ onCreated }) {
  const { act, busy, intakeDraft, setIntakeDraft, reqs } = useStore();
  const [text, setText] = useState(""), [sourceName, setSourceName] = useState("Web form");
  const [form, setForm] = useState({ title: "", project: "", location: "", category: "", needBy: "", specification: "", lines: [newLine()] });
  const [notice, setNotice] = useState(""), [working, setWorking] = useState(false);
  const set = (key, value) => setForm(form => ({ ...form, [key]: value }));
  useEffect(() => {
    if (!intakeDraft) return;
    setText(intakeDraft.text); setSourceName(intakeDraft.sourceName);
    setNotice(`${intakeDraft.provenance}. Confirm the project, scope and quantities below. Nothing has been saved yet.`);
    setIntakeDraft(null);
  }, [intakeDraft]);
  const assist = async () => {
    setWorking(true);
    try {
      const parsed = await request("/api/integration", { method: "POST", body: { operation: "parse_requirement", text } });
      setForm(form => ({ ...form, ...Object.fromEntries(Object.entries(parsed).filter(([key, value]) => value !== undefined && ["title", "project", "location", "category", "needBy", "specification"].includes(key))), lines: parsed.lines?.length ? parsed.lines : form.lines }));
      setNotice(parsed.warnings.join(" "));
    } catch (error) { setNotice(error.message); }
    finally { setWorking(false); }
  };
  const save = async event => {
    event.preventDefault();
    if (sourceName.startsWith("WhatsApp ") && reqs.some(r => r.sourceName === sourceName)) { setNotice("This source message has already been imported. Open its saved case instead."); return; }
    const next = await act({ type: "create_requirement", requirement: {
      ...form, quantity: form.lines[0]?.quantity || 0, unit: form.lines[0]?.unit || "sqm",
      sourceText: text, sourceName, priority: "Normal", measuredScopeOnly: false, flags: [],
    } });
    if (next) { setNotice("Requirement saved for BOQ review. No RFQ or approval was issued."); onCreated(next.activeRequestId); }
  };
  return <section className="card"><h2>Capture a reviewed requirement</h2>
    <Field label="Original message / transcript"><textarea rows={5} value={text} onChange={event => setText(event.target.value)} /></Field>
    <button className="btn" disabled={!text.trim() || working} onClick={assist}>{working ? "Reading…" : "Assist extraction (draft only)"}</button>
    {notice && <p role="status" className="notice">{notice}</p>}
    <form onSubmit={save}><div className="grid2" style={{ marginTop: 16 }}>
      {["title", "project", "location", "category"].map(key => <Field key={key} label={key}><input required={key !== "location"} value={form[key]} onChange={event => set(key, event.target.value)} /></Field>)}
      <Field label="Required by (unknown may remain blank)"><input type="date" value={form.needBy} onChange={event => set("needBy", event.target.value)} /></Field>
      <Field label="Source reference"><input required value={sourceName} readOnly={sourceName.startsWith("WhatsApp ")} onChange={event => setSourceName(event.target.value)} /></Field>
    </div><Field label="Specification"><textarea value={form.specification} onChange={event => set("specification", event.target.value)} /></Field>
      {form.lines.map((line, index) => <div className="card" key={line.id} style={{ marginBottom: 10 }}>
        <Field label={`BOQ line ${index + 1}`}><input required value={line.description} onChange={event => set("lines", form.lines.map(item => item.id === line.id ? { ...item, description: event.target.value } : item))} /></Field>
        <div className="grid2"><Field label="Quantity (blank means unmeasured)"><input type="number" min="0.000001" step="any" value={line.quantity ?? ""} onChange={event => set("lines", form.lines.map(item => item.id === line.id ? { ...item, quantity: nullable(event.target.value) } : item))} /></Field>
          <Field label="Unit"><Unit value={line.unit} onChange={unit => set("lines", form.lines.map(item => item.id === line.id ? { ...item, unit } : item))} /></Field></div>
        {form.lines.length > 1 && <button type="button" className="btn" onClick={() => set("lines", form.lines.filter(item => item.id !== line.id))}>Remove draft line</button>}
      </div>)}
      <div className="inline"><button className="btn" type="button" onClick={() => set("lines", [...form.lines, newLine()])}>Add BOQ line</button><button className="btn primary" disabled={busy || working}>Confirm and save requirement</button></div>
    </form>
  </section>;
}

function ItemReview({ r }) {
  const { payload, act, busy } = useStore();
  return <section className="card"><h2>BOQ and ERP mapping</h2>
    <p>Suggested text matches are not technical approval. Check descriptions, dimensions and specifications. Saving changes supersedes prior recommendation decisions.</p>
    {r.raw.lines.map(line => <div className="card" key={line.id} style={{ marginBottom: 12 }}>
      <h3>{line.code} · {line.quantity ?? "Unmeasured"} {line.unit}</h3><p>{line.description}</p>
      <Field label="ERP item (save an explicit reviewed selection)"><select disabled={busy} value={line.itemId || ""} onChange={event => event.target.value && act({ type: "match_item", requestId: r.id, lineId: line.id, itemId: event.target.value })}>
        <option value="">Choose after reviewing specification</option>{payload.workspace.items.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name} · {item.unit}</option>)}
      </select></Field>
      <details><summary>Matching evidence</summary>{(payload.matches[r.id]?.[line.id] || []).map(match => <p key={match.item.id}><b>{match.item.code} · {Math.round(match.confidence * 100)}% text similarity:</b> {match.item.name}<br />{match.reason}</p>)}</details>
    </div>)}
    <label className="inline"><input type="checkbox" disabled={busy} checked={r.measuredScopeOnly} onChange={event => act({ type: "update_requirement", requestId: r.id, requirement: { measuredScopeOnly: event.target.checked } })} />
      Explicitly compare only quantified BOQ lines; exclude unmeasured work from the approval value</label>
    {location.pathname.startsWith("/desk/") ? <p>Use the local full editor for additional source-pack edits.</p> : <p><a href="http://127.0.0.1:5173" target="_blank" rel="noreferrer">Open the original full editor for quantity corrections, new ERP items or additional source documents</a></p>}
  </section>;
}

function QuoteReview({ r }) {
  const { payload, act, busy } = useStore();
  const [vendorId, setVendorId] = useState(r.candidateIds[0] || payload.workspace.vendors[0]?.id || "");
  const existing = payload.workspace.quotes.filter(q => q.requestId === r.id && q.vendorId === vendorId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const blank = () => ({
    requestId: r.id, vendorId, rate: null, unit: null, gstPercent: null, freight: null, paymentTerms: "", deliveryDays: null,
    scopeConfirmed: false, reviewed: false, sourceText: "", sourceName: "Human-reviewed vendor reply", flags: [],
    lines: r.raw.lines.map(line => ({ boqLineId: line.id, description: line.description, rate: null, unit: null, quotedQuantity: null, confirmed: false, sourceRef: "" })),
  });
  const [form, setForm] = useState(existing ? structuredClone(existing) : blank());
  const [notice, setNotice] = useState(""), [working, setWorking] = useState(false);
  useEffect(() => { setForm(existing ? structuredClone(existing) : blank()); setNotice(""); }, [r.id, vendorId, existing?.updatedAt]);
  const set = (key, value) => setForm(form => ({ ...form, [key]: value }));
  const editLine = (id, key, value) => setForm(form => ({
    ...form, reviewed: false,
    lines: form.lines.map(line => line.boqLineId === id ? { ...line, [key]: value, ...(key === "rate" || key === "unit" ? { confirmed: false } : {}) } : line),
  }));
  const assist = async () => {
    setWorking(true);
    try {
      const parsed = await request("/api/integration", { method: "POST", body: { operation: "parse_quote", text: form.sourceText, requestId: r.id } });
      setForm(current => ({ ...current, ...Object.fromEntries(Object.entries(parsed).filter(([key, value]) => value !== undefined && ["rate", "unit", "gstPercent", "freight", "paymentTerms", "deliveryDays"].includes(key))),
        lines: parsed.lines?.length ? parsed.lines : current.lines, reviewed: false, scopeConfirmed: false, flags: parsed.warnings || [] }));
      setNotice("Draft extraction only. Confirm every line and all commercial terms against the source.");
    } catch (error) { setNotice(error.message); }
    finally { setWorking(false); }
  };
  const upload = async file => {
    if (!file) return;
    setWorking(true);
    try {
      const body = new FormData(); body.set("file", file);
      const response = await fetch(deskPath("/api/extract"), { method: "POST", body, credentials: "same-origin" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setForm(form => ({ ...form, sourceText: data.text, sourceName: data.sourceName, sourceAttachmentId: data.attachmentId || undefined, reviewed: false }));
      setNotice((data.warnings || []).join(" ") || "Document text saved in the draft. Review it before extracting.");
    } catch (error) { setNotice(error.message); } finally { setWorking(false); }
  };
  const save = async event => {
    event.preventDefault();
    const quote = { ...form, requestId: r.id, vendorId };
    const next = await act(existing ? { type: "update_quote", quoteId: existing.id, quote } : { type: "add_quote", quote });
    if (next) setNotice("Quotation saved. The backend recalculated the comparison and invalidated any superseded approval.");
  };
  return <section className="card"><h2>Quotation source and review</h2>
    <Field label="Vendor"><select value={vendorId} onChange={event => setVendorId(event.target.value)}>{payload.workspace.vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
    <form onSubmit={save}>
      <Field label="Source reference"><input required value={form.sourceName} onChange={event => set("sourceName", event.target.value)} /></Field>
      <Field label="Original vendor reply / document text"><textarea rows={6} value={form.sourceText} onChange={event => set("sourceText", event.target.value)} /></Field>
      <div className="inline"><input type="file" accept=".pdf,.xlsx,.xls,.txt,.csv,.eml" aria-label="Read quotation source" onChange={event => upload(event.target.files[0])} />
        <button type="button" className="btn" disabled={working || !form.sourceText.trim()} onClick={assist}>Assist extraction (unconfirmed)</button></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="grid2" style={{ marginTop: 16 }}>
        <Field label="GST % (blank = unknown)"><input type="number" min="0" max="100" step="any" value={form.gstPercent ?? ""} onChange={event => set("gstPercent", nullable(event.target.value))} /></Field>
        <Field label="Freight / mobilisation INR (blank = unknown)"><input type="number" min="0" step="any" value={form.freight ?? ""} onChange={event => set("freight", nullable(event.target.value))} /></Field>
        <Field label="Agreed payment terms"><input value={form.paymentTerms} onChange={event => set("paymentTerms", event.target.value)} /></Field>
        <Field label="Agreed lead time in days (blank = unknown)"><input type="number" min="0" step="1" value={form.deliveryDays ?? ""} onChange={event => set("deliveryDays", nullable(event.target.value))} /></Field>
      </div>
      {r.raw.lines.map(boq => {
        const line = form.lines.find(line => line.boqLineId === boq.id);
        if (!line) return <p key={boq.id}>{boq.code}: no quoted line. <button type="button" className="btn" onClick={() => set("lines", [...form.lines, { boqLineId: boq.id, description: boq.description, rate: null, unit: null, quotedQuantity: null, confirmed: false, sourceRef: form.sourceName }])}>Add missing line</button></p>;
        return <div className="card" key={boq.id} style={{ marginBottom: 12 }}><b>{boq.code} · {boq.description}</b>
          <div className="grid2"><Field label="Vendor rate"><input type="number" min="0" step="any" value={line.rate ?? ""} onChange={event => editLine(boq.id, "rate", nullable(event.target.value))} /></Field>
            <Field label="Vendor unit"><Unit value={line.unit} onChange={value => editLine(boq.id, "unit", value)} /></Field></div>
          <label className="inline"><input type="checkbox" checked={line.confirmed} onChange={event => editLine(boq.id, "confirmed", event.target.checked)} />I checked this rate and unit against its source</label>
        </div>;
      })}
      <label className="inline"><input type="checkbox" checked={form.scopeConfirmed} onChange={event => set("scopeConfirmed", event.target.checked)} />Scope, exclusions and client-supplied materials confirmed</label>
      <label className="inline"><input type="checkbox" checked={form.reviewed} onChange={event => set("reviewed", event.target.checked)} />Human quotation review completed</label>
      <button className="btn primary" disabled={busy || working || !vendorId} style={{ marginTop: 12 }}>Save quotation review</button>
    </form>
  </section>;
}

function Recommendation({ r }) {
  const { act, busy } = useStore(); const [note, setNote] = useState("");
  const ready = r.comparisons.filter(row => row.eligible).length >= 2 && !!r.rec;
  return <><RankingTable r={r} /><div className="card" style={{ marginTop: 16 }}>
    <h2>Submit for human review</h2><p>{ready ? `Backend recommendation: ${r.rec}` : "Blocked: at least two comparable reviewed quotes and an unambiguous recommendation are required."}</p>
    <Field label="Recommendation note"><textarea value={note} onChange={event => setNote(event.target.value)} /></Field>
    <button className="btn primary" disabled={busy || !ready || r.approval?.status === "Pending"} onClick={() => act({ type: "submit_recommendation", requestId: r.id, note })}>Submit saved recommendation</button>
    {r.approval && <p><a href={`#approve/${encodeURIComponent(r.id)}`}>Open current human review</a></p>}
    <p className="small muted">Creates an in-app review record. No WhatsApp notification, live email, order or payment is claimed.</p>
  </div></>;
}

export default function Workflow() {
  const { reqs, intakeDraft } = useStore();
  const [id, setId] = useState(reqs[0]?.id || ""), [tab, setTab] = useState("Capture");
  const r = reqs.find(r => r.id === id) || reqs[0];
  useEffect(() => { if (intakeDraft) setTab("Capture"); }, [intakeDraft]);
  return <>
    <Tabs value={tab} onChange={setTab} tabs={["Capture", "BOQ & items", "Quotations", "Recommendation"].map(value => [value, value])} />
    {tab !== "Capture" && <div className="field"><label>Saved case</label><select value={r?.id || ""} onChange={event => setId(event.target.value)}>{reqs.map(r => <option key={r.id} value={r.id}>{r.project} · {r.title}</option>)}</select></div>}
    {tab === "Capture" ? <Capture onCreated={id => { setId(id); setTab("BOQ & items"); }} /> : !r ? <div className="card">Capture a requirement first.</div>
      : tab === "BOQ & items" ? <ItemReview r={r} /> : tab === "Quotations" ? <QuoteReview key={r.id} r={r} /> : <Recommendation r={r} />}
  </>;
}

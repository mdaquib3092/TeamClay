import { useState } from "react";
import { useStore } from "../store.jsx";
import { useResource } from "../hooks.jsx";

const Error = ({ error }) => error ? <p className="err" role="alert">{error}</p> : null;
const DataTable = ({ rows }) => {
  if (!rows?.length) return <p className="muted">No rows available.</p>;
  const keys = Object.keys(rows[0]);
  return <div className="tablewrap"><table><thead><tr>{keys.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{keys.map(key => <td key={key}>{row[key] == null ? "Unknown" : String(row[key])}</td>)}</tr>)}</tbody></table></div>;
};

export function AdminData() {
  const { payload } = useStore(); const catalog = useResource("/local-api/catalog");
  return <>
    <div className="card"><h2>Saved procurement workspace</h2><p>{payload.workspace.requests.length} requirements · {payload.workspace.items.length} ERP records · {payload.workspace.vendors.length} vendor records · {payload.workspace.quotes.length} quotations.</p>
      <p>These come from the existing saved backend, not the frontend's original invented orders. Use Procurement workflow to capture or read source documents.</p></div>
    <Error error={catalog.error} />
    <div className="stack" style={{ marginTop: 16 }}>{Object.entries(catalog.data?.tables || {}).map(([name, rows]) => <section className="card" key={name}>
      <h2>{name} · {rows.length} configured CSV rows</h2><p className="small muted">{catalog.data.source}. Separate from the imported workspace; no silent cross-catalog matching or historical ratings are assumed.</p>
      <details><summary>Preview current configured rows</summary><DataTable rows={rows.slice(0, 25)} /></details>
    </section>)}</div>
  </>;
}

export function AdminVendors() {
  const { payload } = useStore();
  const catalog = useResource("/local-api/catalog");
  return <>
    <h2>Procurement workspace vendors</h2>
    <DataTable rows={payload.workspace.vendors.map(v => ({ id: v.id, name: v.name, category: v.category || "Unconfirmed", email: v.email || null, history: v.performance ? `${v.performance.completedOrders} recorded orders` : "No verified history" }))} />
    <h2 style={{ marginTop: 24 }}>Configured communication contacts (CSV)</h2>
    <Error error={catalog.error} /><DataTable rows={catalog.data?.tables.vendors} />
    <p className="notice">The CSV uses demo/test identities and shared inboxes. These records have not been silently substituted for source-pack contractors or confirmed as independent eligible bids.</p>
  </>;
}

export function AdminStock() {
  const catalog = useResource("/local-api/catalog");
  const [project, setProject] = useState("");
  const rows = (catalog.data?.tables.stock || []).filter(row => !project || row.project_id === project);
  return <>
    <p className="notice">Configured CSV stock is shown as supplied. It is not a live ERP stock ledger and is not automatically deducted from imported waterproofing/road-work BOQs.</p>
    <Error error={catalog.error} />
    <div className="field"><label>Project</label><select value={project} onChange={event => setProject(event.target.value)}><option value="">All projects</option>
      {[...new Set(catalog.data?.tables.stock?.map(row => row.project_id))].map(id => <option key={id}>{id}</option>)}</select></div>
    <DataTable rows={rows} />
  </>;
}

export function AdminIntegrations() {
  const { payload } = useStore();
  const status = useResource("/local-api/status"), roles = useResource("/local-api/roles");
  const data = status.data;
  return <>
    <div className="toolbar"><button className="btn" onClick={() => { status.refresh(); roles.refresh(); }}>Check connections (no messages sent)</button><a className="btn" href="#admin-agent">Open agent inbox</a></div>
    <Error error={status.error || roles.error} />
    <div className="grid2">
      <section className="card"><h2>Procurement backend</h2><p>Connected · signed in as {payload.identity.name}</p><p>Saved revision {payload.workspace.revision}. All case mutations use optimistic concurrency and the existing domain gates.</p></section>
      <section className="card"><h2>WhatsApp bridge</h2><p>{data?.whatsapp.phase || data?.whatsapp.state || "Checking…"}</p><p>Account ending {data?.whatsapp.accountLastFour || "not available"}</p><p>Outbound scope: {data?.whatsapp.sendScope || (data?.whatsapp.outboundEnabled ? "See transport configuration" : "Disabled")}</p><a href="http://127.0.0.1:8766" target="_blank" rel="noreferrer">Bridge status / pairing</a></section>
      <section className="card"><h2>Staff conversation / voice agent</h2><p>Chat model: {data?.agent.chat?.model || "Not reported"}</p><p>Automatic staff replies: {data?.agent.chat?.automaticReplies ? "Enabled for configured staff" : "Not enabled / unavailable"}</p><p>Verified WhatsApp case commands: {data?.agent.caseWorkflow?.enabled ? "enabled" : "unavailable"}.</p></section>
      <section className="card"><h2>Gmail</h2><p>{data?.gmail.state || "Checking…"}</p><p>{data?.gmail.mailbox || "No saved mailbox"}</p><p>{data?.liveEmailDispatch ? "The case worker sends PM-confirmed RFQs and watches their Gmail threads for vendor replies." : "Case email automation is unavailable."}</p><a href="#live-cases">View RFQ receipts and HOD reports</a></section>
    </div>
    <section className="card" style={{ marginTop: 16 }}><h2>Configured WhatsApp staff</h2>
      <DataTable rows={roles.data?.staff?.map(user => ({ name: user.name, role: user.label || user.role, project: user.project_id, number: `ending ${user.number_ending}` }))} />
      <p>Identity/role comes from the existing staff roster and verified sender mapping, never from a claim in message text. Selecting a web view does not impersonate that staff member.</p>
    </section>
  </>;
}

export function AdminLog() {
  const { payload } = useStore(); const [id, setId] = useState("");
  const events = payload.workspace.events.filter(event => !id || event.requestId === id);
  return <>
    <div className="field"><label>Case</label><select value={id} onChange={event => setId(event.target.value)}><option value="">All cases</option>{payload.workspace.requests.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>
    <DataTable rows={events.map(event => ({ at: event.at, actor: event.actor, action: event.action, case: event.requestId, detail: event.detail }))} />
    <p className="small muted">Actual backend audit records only. Staff conversations are in Agent inbox; no fabricated delivery events are generated.</p>
  </>;
}

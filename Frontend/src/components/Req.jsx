import { useStore } from "../store.jsx";
import { ranked, repliedVendors } from "../data.js";
import { Flags } from "./ui.jsx";

export function ReqHeader({ r }) {
  return <div className="card">
    <h2>{r.id} · {r.project}</h2><p><b>{r.title}</b></p>
    <dl className="kv"><dt>Required by</dt><dd>{r.needBy}</dd><dt>Source</dt><dd>{r.sourceName || "Not recorded"}</dd><dt>Review scope</dt><dd>{r.measuredScopeOnly ? "Quantified lines only; unmeasured work excluded" : "Whole package; unmeasured work blocks recommendation"}</dd></dl>
    <details><summary>Original requirement</summary><div className="raw">{r.orig}</div></details>
  </div>;
}

export function StockCard({ r }) {
  return <div className="card"><h2>BOQ scope</h2>
    <div className="tablewrap"><table><thead><tr><th>Line</th><th>Description</th><th>Quantity</th><th>Unit</th></tr></thead>
      <tbody>{r.raw.lines.map(line => <tr key={line.id}><td>{line.code}</td><td>{line.description}</td><td>{line.quantity ?? "Unmeasured"}</td><td>{line.unit}</td></tr>)}</tbody></table></div>
    <p className="small muted">Source: {r.sourceName || "Human input"}. Inventory is not linked to these BOQ lines; no stock availability or shortage is inferred.</p>
  </div>;
}

export function RfqCard({ r }) {
  const received = repliedVendors(r);
  return <div className="card"><h2>RFQ / quotation evidence</h2>{r.vendors.map(vendor => <div className="minirow" key={vendor}>
    <b>{vendor}</b><span>{received.includes(vendor) ? "Saved quotation" : "No quotation"} · {r.sent.includes(vendor) ? "Test RFQ recorded" : "No dispatch recorded"}</span>
  </div>)}</div>;
}

function Performance({ vendor }) {
  const p = vendor?.performance;
  return p?.completedOrders > 0
    ? <>Quality {p.quality}/100<br />On-time {p.delivery}/100<br />{p.completedOrders} recorded orders</>
    : <>No verified history<br />Disclosed neutral baseline</>;
}

export function RankingTable({ r }) {
  const { dispatch, vendors } = useStore();
  const rows = ranked(r);
  if (!rows.length) return <div className="card">No saved quotations to compare.</div>;
  return <>
    <div className="tablewrap"><table><caption className="sr">Backend-computed comparison for {r.id}</caption>
      <thead><tr><th>Rank</th><th>Vendor</th><th>Base subtotal</th><th>Landed total incl. GST</th><th>Lead time</th><th>Payment</th><th>History</th><th>Score</th><th>Review flags / reason</th></tr></thead>
      <tbody>{rows.map(q => <tr key={q.id} className={q.v === r.rec ? "rec" : q.unranked ? "unranked" : ""}>
        <td>{q.rank ?? "—"}</td><td><b>{q.v}</b><br /><button className="link small" onClick={() => dispatch({ type: "openRaw", key: `${r.id}|${q.v}` })}>View source</button></td>
        <td>{q.baseTotal}</td><td>{q.total}</td><td>{q.days}</td><td>{q.terms}</td><td><Performance vendor={vendors[q.v]} /></td><td>{q.score}</td>
        <td style={{ minWidth: 220 }}>{q.reason}<Flags list={q.flags} /></td>
      </tr>)}</tbody>
    </table></div>
    <p className="small muted">Computed by the existing backend: 60% price + 40% past performance. Missing terms remain unknown. Partial measured subtotals are not full package prices. GST uses the entered base-plus-freight basis.</p>
  </>;
}

export function Tracking({ r }) {
  const received = repliedVendors(r).length;
  return <ol className="track">
    <li className="t-done"><b>Requirement saved</b><div>{r.sourceName}</div></li>
    <li><b>BOQ / ERP review</b><div>{r.raw.lines.filter(line => line.itemId).length} of {r.raw.lines.length} lines mapped</div></li>
    <li className={r.sent.length ? "t-done" : ""}><b>Test RFQ records</b><div>{r.sent.length} distinct vendors · no live delivery claimed</div></li>
    <li className={received ? "t-done" : ""}><b>Quotations saved</b><div>{received} vendors; every source needs review</div></li>
    <li className={r.approval ? "t-done" : ""}><b>Human review</b><div>{r.approval?.status || "No recommendation submitted"}</div></li>
    <li><b>Work order / execution</b><div>Not implemented. Recommendation approval is not an order or payment.</div></li>
  </ol>;
}

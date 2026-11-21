import { useEffect, useState } from "react";
import { useStore } from "../store.jsx";
import { statusOf, repliedVendors, recQ, nextStep, rfqMail } from "../data.js";
import { Flags, StatusBar, Rule, DecisionBanner, Tabs } from "../components/ui.jsx";
import { ReqHeader, StockCard, RfqCard, RankingTable, Tracking } from "../components/Req.jsx";

export const reportLink = id => `#report/${encodeURIComponent(id)}`;

export function PmRequests() {
  const { myReqs } = useStore();
  return <>
    <div className="toolbar"><a className="btn primary" href="#pm-workflow">Capture / review a requirement</a></div>
    <div className="tablewrap"><table>
      <thead><tr><th>ID</th><th>Work package</th><th>Scope</th><th>Required by</th><th>Status</th><th>Next step</th></tr></thead>
      <tbody>{myReqs.map(r => <tr key={r.id}><td><a href={reportLink(r.id)}>{r.id}</a></td><td>{r.title}<div className="small muted">{r.project}</div></td><td>{r.qty}</td><td>{r.needBy}</td><td>{statusOf(r)}</td><td>{nextStep(r)}</td></tr>)}
        {!myReqs.length && <tr><td colSpan={6}>No saved requirements. Capture one to begin.</td></tr>}</tbody>
    </table></div>
  </>;
}

export function PmOutbox() {
  const { myReqs, dispatch, busy, payload } = useStore();
  const [tab, setTab] = useState("Drafts"), [pick, setPick] = useState(""), [selected, setSelected] = useState({});
  const entries = myReqs.flatMap(r => tab === "Sent"
    ? r.rfqs.map(rfq => ({ r, vendor: r.vendors.find(v => r.vendorIds[v] === rfq.vendorId), mail: { to: rfq.recipient, subj: rfq.subject, body: rfq.body }, rfq }))
    : !r.approval ? r.vendors.filter(v => r.candidateIds.includes(r.vendorIds[v]) && !r.sent.includes(v)).map(vendor => ({ r, vendor, mail: rfqMail(r, vendor) })) : []);
  const current = entries.find(entry => `${entry.r.id}|${entry.vendor}` === pick) || entries[0];
  const chosen = current ? selected[current.r.id] || [] : [];
  return <>
    <div className="notice" style={{ marginBottom: 16 }}>This is the backend's internal test outbox—not Gmail. At least {payload.policy.minimumRfqVendors} distinct eligible vendors and reviewed item mappings are required. No real supplier email is sent.</div>
    <Tabs tabs={[["Drafts", "Drafts"], ["Sent", "Saved test dispatches"]]} value={tab} onChange={value => { setTab(value); setPick(""); }} />
    {!current ? <div className="card">No {tab === "Drafts" ? "eligible drafts" : "saved test dispatches"}.</div> : <div className="mail">
      <div className="mlist">{entries.map(entry => <button key={`${entry.r.id}|${entry.vendor}`} className={`mitem ${entry === current ? "on" : ""}`} onClick={() => setPick(`${entry.r.id}|${entry.vendor}`)}>
        <b>{entry.vendor}</b><div className="small muted">{entry.r.id} · {entry.r.title}</div></button>)}</div>
      <div className="card">
        <h2>{current.r.title}</h2><p><b>To:</b> {current.mail.to}</p><p><b>Subject:</b> {current.mail.subj}</p>
        <div className="raw">{current.mail.body}</div>
        {tab === "Drafts" && <>
          <h3>Select the invitation batch</h3>
          {current.r.vendors.filter(v => current.r.candidateIds.includes(current.r.vendorIds[v]) && !current.r.sent.includes(v)).map(v => <label className="inline" key={v}>
            <input type="checkbox" checked={chosen.includes(current.r.vendorIds[v])} onChange={event => setSelected(value => ({ ...value, [current.r.id]: event.target.checked ? [...chosen, current.r.vendorIds[v]] : chosen.filter(id => id !== current.r.vendorIds[v]) }))} />{v}
          </label>)}
          <button className="btn primary" style={{ marginTop: 12 }} disabled={busy || chosen.length < payload.policy.minimumRfqVendors}
            onClick={() => dispatch({ type: "sendAll", id: current.r.id, vendorIds: chosen })}>Save {chosen.length} test RFQs</button>
          <p className="small muted">If the backend blocks dispatch, resolve the BOQ/item mappings in Procurement workflow first.</p>
        </>}
        {current.rfq && <p className="small muted">{current.rfq.status} · {new Date(current.rfq.createdAt).toLocaleString()}</p>}
      </div>
    </div>}
  </>;
}

export function PmInbox() {
  const { myReqs, read, dispatch } = useStore();
  const [pick, setPick] = useState("");
  const entries = myReqs.flatMap(r => repliedVendors(r).map(vendor => ({ r, vendor, quote: r.quotes[vendor], key: `${r.id}|${vendor}` })));
  const current = entries.find(entry => entry.key === pick) || entries[0];
  const key = current?.key;
  useEffect(() => { if (key) dispatch({ type: "markRead", key }); }, [key]);
  return <>
    <div className="toolbar"><a className="btn" href="#admin-agent">Open staff agent intake</a><a className="btn primary" href="#pm-workflow">Import / review quotation</a></div>
    {!current ? <div className="card">No quotations have been saved. Gmail inbox monitoring is not enabled; import a source quotation for human review.</div> : <div className="mail">
      <div className="mlist">{entries.map(entry => <button key={entry.key} className={`mitem ${entry.key === key ? "on" : ""} ${read.includes(entry.key) ? "" : "unread"}`} onClick={() => setPick(entry.key)}>
        <b>{entry.vendor}</b><div className="small muted">{entry.r.title}</div><div>{entry.quote.rank ? `Rank ${entry.quote.rank}` : "Review required"}</div></button>)}</div>
      <div className="card">
        <h2>{current.vendor}</h2><div className="small muted">{current.r.id} · {current.quote.sourceName} · {new Date(current.quote.receivedAt).toLocaleString()}</div>
        <p>{current.r.sent.includes(current.vendor) ? "An internal test RFQ is recorded for this vendor." : "Imported quotation; no email dispatch is claimed."}</p>
        <div className="raw">{current.quote.rawMessage || "No source text recorded."}</div>
        <dl className="kv"><dt>Measured base subtotal</dt><dd>{current.quote.baseTotal}</dd><dt>Landed total incl. entered GST</dt><dd>{current.quote.total}</dd><dt>Review</dt><dd>{current.quote.reason}</dd></dl>
        <Flags list={current.quote.flags} />
        <p><a href={reportLink(current.r.id)}>Open comparison and case</a></p>
      </div>
    </div>}
  </>;
}

export function PmReport({ r }) {
  if (!r) return <div className="card">No saved request with this ID.</div>;
  return <>
    <p><a href="#pm-list">← All requests</a></p>
    <div className="stack"><DecisionBanner r={r} /><StatusBar status={statusOf(r)} /><Rule /></div>
    <div className="review" style={{ marginTop: 16 }}>
      <div className="stack"><ReqHeader r={r} /><StockCard r={r} /><RfqCard r={r} /></div>
      <div className="aside stack"><div className="card"><h2>Case progress</h2><Tracking r={r} /><a className="btn block" href="#pm-workflow">Review BOQ / quotations</a></div>
        <div className="card"><h2>Recommendation</h2>{r.rec ? <><b>{r.rec}</b><p>{recQ(r).total} landed · score {recQ(r).score}</p></> : <p>Not ready. Resolve the comparison flags; the UI never invents a winner.</p>}</div>
      </div>
    </div>
    <h2 style={{ marginTop: 24 }}>Saved quotation comparison</h2><RankingTable r={r} />
  </>;
}

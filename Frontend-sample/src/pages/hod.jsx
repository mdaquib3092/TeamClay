import { useState } from "react";
import { useStore } from "../store.jsx";
import { statusOf, hasReport, recQ, pmName } from "../data.js";
import { StatusBar, Rule, DecisionBanner, Tabs, Txt } from "../components/ui.jsx";
import { ReqHeader, RankingTable } from "../components/Req.jsx";

export function HodList() {
  const { reqs } = useStore();
  const [tab, setTab] = useState("Pending");
  const map = { Pending: "hod", Approved: "approved", "Sent back": "sentback" };
  const rows = reqs.filter(r => r.stage === map[tab]);
  return (<>
    <Tabs value={tab} onChange={setTab} tabs={Object.keys(map).map(t => [t, `${t} · ${reqs.filter(r => r.stage === map[t]).length}`])} />
    <div className="tablewrap"><table>
      <thead><tr><th>Requirement</th><th>Project</th><th>Recommended vendor</th><th className="num">Amount ex-GST</th><th>PM</th><th>{tab === "Pending" ? "Waiting" : "Decision"}</th></tr></thead>
      <tbody>{rows.length ? rows.map(r => (
        <tr key={r.id} className="rowlink" tabIndex={0} onClick={() => (location.hash = "approve-" + r.id.slice(4))} onKeyDown={e => e.key === "Enter" && (location.hash = "approve-" + r.id.slice(4))}>
          <td><a href={`#approve-${r.id.slice(4)}`}><b>{r.id}</b></a><div className="small muted">{r.title}</div></td><td>{r.project}</td><td>{r.rec}</td>
          <td className="num"><b>{recQ(r).total}</b></td><td>{pmName(r)}</td>
          <td className="small">{tab === "Pending" ? <Txt>[waiting]</Txt> : r.decision.text}</td></tr>))
        : <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 28 }}>Nothing here.</td></tr>}</tbody>
    </table></div>
  </>);
}

export function HodView({ r }) {
  const { dispatch } = useStore();
  const [reason, setReason] = useState(""); const [err, setErr] = useState("");
  if (!r || !hasReport(r)) return <div className="card"><p className="muted" style={{ margin: 0 }}>Not found.</p></div>;
  const locked = r.stage !== "hod", q = recQ(r);
  const sendBack = () => { if (!reason.trim()) { setErr("A reason is required to send back."); return; } dispatch({ type: "hodBack", id: r.id, reason: reason.trim() }); };
  return (<>
    <p style={{ margin: "0 0 12px" }}><a href="#hod-list">← All approvals</a></p>
    <div className="stack" style={{ marginBottom: 16 }}><DecisionBanner r={r} /><StatusBar status={statusOf(r)} /><Rule /></div>
    <div className="review">
      <div className="stack">
        <ReqHeader r={r} />
        <div className="card"><h2>Report prepared by Clay</h2><p style={{ margin: 0 }}>Sent to you with an approval link. PM {pmName(r)} has view access and tracks the status.</p></div>
        <div className="card"><h2>Questions asked</h2>
          {r.qa.length ? r.qa.map(([qq, a, src]) => (
            <div key={qq} className="minirow" style={{ display: "block" }}><div><b>Q (Vikram):</b> “{qq}”</div>
              <div style={{ marginTop: 6 }}><b>Clay:</b> {a}</div><div className="small muted" style={{ marginTop: 4 }}>Source: {src}</div></div>))
            : <p className="muted" style={{ margin: 0 }}>No questions yet. Vikram can ask Clay on WhatsApp.</p>}
        </div>
      </div>
      <div className="aside"><div className="card">
        <div className="small muted">Recommended by Clay</div>
        <div style={{ fontSize: 17, fontWeight: 700, margin: "2px 0" }}>{r.rec}</div>
        <div>{q.total} ex-GST · {q.days} · {q.terms}</div>
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />
        <div className="field"><label htmlFor="hr">Reason (required to send back)</label>
          <textarea id="hr" value={reason} disabled={locked} onChange={e => { setReason(e.target.value); setErr(""); }} /></div>
        <div className="stack" style={{ gap: 10 }}>
          <button className="btn primary block" disabled={locked} onClick={() => dispatch({ type: "hodApprove", id: r.id })}>Approve</button>
          <button className="btn block" disabled={locked} onClick={sendBack}>Send back</button>
          <div className="err" role="alert">{err}</div>
        </div>
      </div></div>
    </div>
    <div style={{ marginTop: 20 }}><h2 style={{ fontSize: 16, margin: "4px 0 10px" }}>Ranking (read-only)</h2><RankingTable r={r} /></div>
  </>);
}

import { useState } from "react";
import { useStore } from "../store.jsx";
import { recQ } from "../data.js";
import { DecisionBanner, Tabs } from "../components/ui.jsx";
import { ReqHeader, RankingTable } from "../components/Req.jsx";

export function HodList() {
  const { reqs } = useStore();
  const [tab, setTab] = useState("Pending");
  const stages = { Pending: "hod", Approved: "approved", "Changes requested": "sentback" };
  const rows = reqs.filter(r => r.stage === stages[tab]);
  return <>
    <div className="notice">Human decisions are saved in the authenticated owner's private workspace. Separate HOD accounts, delegation and enterprise role enforcement are not configured.</div>
    <Tabs value={tab} onChange={setTab} tabs={Object.keys(stages).map(value => [value, value])} />
    <div className="tablewrap"><table><thead><tr><th>Case</th><th>Project</th><th>Vendor</th><th>Approval value</th><th>State</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td><a href={`#approve/${encodeURIComponent(r.id)}`}>{r.title}</a></td><td>{r.project}</td><td>{r.rec || "No current recommendation"}</td><td>{recQ(r).total}</td><td>{r.approval.status}</td></tr>)}
        {!rows.length && <tr><td colSpan={5}>No records in this state.</td></tr>}</tbody></table></div>
  </>;
}

export function HodView({ r }) {
  const { dispatch, busy, payload } = useStore();
  const [note, setNote] = useState("");
  if (!r?.approval) return <div className="card">No current recommendation. Review the comparison and submit it from Procurement workflow first.</div>;
  const locked = r.approval.status !== "Pending";
  return <>
    <p><a href="#hod-list">← All approvals</a></p><DecisionBanner r={r} /><ReqHeader r={r} />
    <div className="card" style={{ margin: "16px 0" }}>
      <h2>Human review</h2><p>{r.approval.recommendation}</p>
      <p>Recorded reviewer: <b>{payload.identity.name}</b>. The decision applies to the saved comparison snapshot. Changes to the underlying evidence supersede it.</p>
      <div className="field"><label htmlFor="decision-note">Review note (required for either decision)</label><textarea id="decision-note" value={note} disabled={locked || busy} onChange={event => setNote(event.target.value)} /></div>
      <div className="inline">
        <button className="btn primary" disabled={locked || busy || !note.trim()} onClick={() => dispatch({ type: "hodApprove", id: r.id, reason: note })}>Approve recommendation</button>
        <button className="btn" disabled={locked || busy || !note.trim()} onClick={() => dispatch({ type: "hodBack", id: r.id, reason: note })}>Request changes</button>
      </div>
      <p className="small muted">No vendor award, signed work order or payment is created.</p>
    </div>
    <RankingTable r={r} />
  </>;
}

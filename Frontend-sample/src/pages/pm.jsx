import { useEffect, useState } from "react";
import { useStore } from "../store.jsx";
import { P, statusOf, hasReport, repliedVendors, recQ, nextStep, rfqMail, hodMail, replyText, STATUS } from "../data.js";
import { Txt, Chip, Flags, StatusBar, Rule, DecisionBanner, Tabs } from "../components/ui.jsx";
import { ReqHeader, StockCard, RfqCard, RankingTable, Tracking } from "../components/Req.jsx";

const go = h => { location.hash = h; };

/* ---------- Requests: status tracking only ---------- */
export function PmRequests() {
  const { myReqs } = useStore();
  const order = { drafts: 0, sentback: 1, sent: 2, hod: 3, approved: 4, instock: 5 };
  const rows = [...myReqs].sort((a, b) => order[a.stage] - order[b.stage]);
  const counts = Object.keys(order).map(k => [k, rows.filter(r => r.stage === k).length]).filter(x => x[1]);
  return (<>
    <div className="notice" style={{ marginBottom: 16 }}>You track status here. Clay drafts every email and sends each ranking report straight to the HOD with an approval link.</div>
    <div className="toolbar">{counts.map(([k, n]) => <span key={k} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Chip status={STATUS[k]} /><span className="small muted" style={{ marginRight: 8 }}>{n}</span></span>)}</div>
    <div className="tablewrap"><table>
      <thead><tr><th>ID</th><th>Material</th><th className="num">Qty</th><th>Needed by</th><th>Raised by</th><th>Status</th><th>Next step</th></tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.id} className="rowlink" tabIndex={0} onClick={() => go("report-" + r.id.slice(4))} onKeyDown={e => e.key === "Enter" && go("report-" + r.id.slice(4))}>
          <td><a href={`#report-${r.id.slice(4)}`}><b>{r.id}</b></a></td><td>{r.short}</td><td className="num">{r.qty}</td><td>{r.needBy}</td><td>{r.by}</td>
          <td><Chip status={statusOf(r)} /></td><td className="small">{nextStep(r)}</td></tr>))}</tbody>
    </table></div>
  </>);
}

/* ---------- Outbox: Clay drafts, PM presses Send ---------- */
export function PmOutbox() {
  const { myReqs, dispatch } = useStore();
  const [tab, setTab] = useState("Drafts");
  const [sel, setSel] = useState(null);

  const groups = myReqs.map(r => {
    let items;
    if (tab === "Drafts") items = r.stage === "drafts" ? r.vendors.filter(v => !r.sent.includes(v)).map(v => ({ id: r.id + "|" + v, r, v, name: v, m: rfqMail(r, v), draft: true })) : [];
    else {
      items = r.sent.map(v => ({ id: r.id + "|" + v, r, v, name: v, m: rfqMail(r, v) }));
      if (hasReport(r)) items.push({ id: r.id + "|HOD", r, name: "Vikram (HOD)", m: hodMail(r), auto: true });
    }
    return { r, items };
  }).filter(g => g.items.length);
  const all = groups.flatMap(g => g.items);
  const nDrafts = myReqs.reduce((n, r) => n + (r.stage === "drafts" ? r.vendors.length - r.sent.length : 0), 0);
  const nSent = myReqs.reduce((n, r) => n + r.sent.length + (hasReport(r) ? 1 : 0), 0);
  const cur = all.find(x => x.id === sel) || all[0];

  return (<>
    <Tabs value={tab} onChange={t => { setTab(t); setSel(null); }} tabs={[["Drafts", `Drafts · ${nDrafts}`], ["Sent", `Sent · ${nSent}`]]} />
    {!all.length ? <div className="card"><p className="muted" style={{ margin: 0 }}>{tab === "Drafts" ? "No drafts. Clay writes RFQ drafts here as soon as a requirement is short on stock." : "Nothing sent yet."}</p></div> : (
      <div className="mail">
        <div className="mlist" role="list">
          {groups.map(g => (<div key={g.r.id}>
            <div className="mgroup"><div className="mrow"><span>{g.r.id} · {g.r.short}</span>
              {tab === "Drafts"
                ? <button className="btn" style={{ minHeight: 44, padding: "0 10px", fontSize: 13 }} onClick={() => { dispatch({ type: "sendAll", id: g.r.id }); setSel(null); }}>Send all {g.items.length}</button>
                : <span className="small muted">{g.items.length}</span>}</div></div>
            {g.items.map(x => (
              <button key={x.id} className={`mitem ${x.id === cur.id ? "on" : ""}`} role="listitem" onClick={() => setSel(x.id)}>
                <span className="mrow"><b>{x.name}</b>
                  {x.auto ? <span className="flag" style={{ margin: 0 }}>Auto-sent by Clay</span> : x.draft ? <span className="flag" style={{ margin: 0 }}>Draft</span> : <span className="small muted"><Txt>{P("time")}</Txt></span>}</span>
                <span className="small muted ell">{x.m.subj}</span></button>))}
          </div>))}
        </div>
        <div className="mread card">
          <div className="mhead"><div><div className="small muted">To</div><b><Txt>{cur.m.to}</Txt></b></div>
            {cur.draft ? <button className="btn primary" onClick={() => { dispatch({ type: "send", id: cur.r.id, vendor: cur.v }); setSel(null); }}>Send</button> : <span className="chip s-rfq">Sent</span>}</div>
          <div className="small muted" style={{ marginTop: 10 }}>Subject</div>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{cur.m.subj}</div>
          <div className="raw"><Txt>{cur.m.body}</Txt></div>
          <p className="small muted" style={{ margin: "10px 0 0" }}>{cur.draft ? "Drafted by Clay from the RFQ template. You only need to press Send." : cur.auto ? "Sent automatically by Clay when all replies were in. You are copied for tracking." : "Sent by you."}</p>
        </div>
      </div>)}
  </>);
}

/* ---------- Inbox: replies grouped by quotation ---------- */
export function PmInbox() {
  const { myReqs, read, dispatch } = useStore();
  const [pick, setPick] = useState(null);
  const withMail = myReqs.filter(r => repliedVendors(r).length || r.stage === "sent");
  const waiting = myReqs.filter(r => r.stage === "drafts");
  const keys = withMail.flatMap(r => repliedVendors(r).map(v => r.id + "|" + v));
  const selKey = keys.includes(pick) ? pick : keys[0];
  useEffect(() => { if (selKey) dispatch({ type: "markRead", key: selKey }); }, [selKey]);

  const tip = waiting.length > 0 && <div className="notice" style={{ marginBottom: 16 }}>{waiting.length} requirement{waiting.length > 1 ? "s have" : " has"} RFQ drafts waiting. <a href="#pm-outbox">Open Outbox</a></div>;
  if (!withMail.length) return <>{tip}<div className="card"><p className="muted" style={{ margin: 0 }}>No vendor replies yet.</p></div></>;

  let reader = <p className="muted" style={{ margin: 0 }}>Select a reply.</p>;
  if (selKey) {
    const [id, v] = selKey.split("|"); const r = myReqs.find(x => x.id === id), q = r.quotes[v], subj = rfqMail(r, v).subj;
    reader = (<>
      <div className="mhead"><div><div className="small muted">Thread · {r.id} · {r.short}</div><b style={{ fontSize: 17 }}>{v}</b></div>
        <button className="link small" onClick={() => dispatch({ type: "openRaw", key: selKey })}>View original reply</button></div>
      <div className="msg out"><div className="mrow"><b>You → {v}</b><span className="small muted"><Txt>{P("time")}</Txt></span></div><div className="small muted">{subj}</div><p style={{ margin: "6px 0 0" }}>RFQ sent (drafted by Clay)</p></div>
      <div className="msg"><div className="mrow"><b>{v}</b><span className="small muted"><Txt>{P("time")}</Txt></span></div><div className="small muted">Re: {subj}</div><p style={{ margin: "6px 0 0" }}><Txt>{replyText(r, v)}</Txt></p></div>
      <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>What Clay read</h3>
      <dl className="kv">{q.unranked ? <><dt>Said</dt><dd>{q.said}</dd><dt>Ranking</dt><dd>{q.reason}</dd></> : <>
        <dt>Landed ex-GST</dt><dd>{q.landed}/{q.u}</dd><dt>Total ex-GST</dt><dd>{q.total} {hasReport(r) && q.diff}</dd>
        <dt>Rank</dt><dd>{hasReport(r) ? `${q.rank} · score ${q.score}` : "After all replies are in"}</dd></>}</dl>
      <div style={{ marginTop: 8 }}><Flags list={q.flags} /></div>
      <p className="small muted" style={{ margin: "12px 0 0" }}>View only. Clay handles follow-ups and builds the report.</p>
    </>);
  }
  return (<>{tip}
    <div className="mail">
      <div className="mlist" role="list">
        {withMail.map(r => { const rep = repliedVendors(r); return (
          <div key={r.id}>
            <div className="mgroup"><div>{r.id} · {r.short}</div>
              <div className="small muted" style={{ fontWeight: 500 }}>{rep.length} of {r.vendors.length} vendors replied · {r.vendors.length + rep.length} emails · <Chip status={statusOf(r)} /></div></div>
            {hasReport(r)
              ? <a className="btn block" href={`#report-${r.id.slice(4)}`} style={{ margin: "0 0 6px" }}>Consolidated report</a>
              : <button className="btn block" style={{ margin: "0 0 6px" }} onClick={() => { dispatch({ type: "simReplies", id: r.id }); setPick(null); }}>Simulate remaining replies (demo)</button>}
            {rep.map(v => { const k = r.id + "|" + v, q = r.quotes[v]; return (
              <button key={k} className={`mitem ${k === selKey ? "on" : ""} ${read.includes(k) ? "" : "unread"}`} role="listitem" onClick={() => setPick(k)}>
                <span className="mrow"><span className="vn">{v}</span><span className="small muted">2 emails</span></span>
                <span className="small muted ell">{q.unranked ? `${q.said} · not ranked` : hasReport(r) ? `Rank ${q.rank} · ${q.total} · score ${q.score}` : `${q.landed}/${q.u} · ranking pending`}</span></button>); })}
            {r.vendors.filter(v => !rep.includes(v)).map(v => <div key={v} className="mitem" style={{ cursor: "default" }}><span className="mrow"><span className="muted">{v}</span><span className="small muted">awaiting</span></span></div>)}
            <div style={{ height: 10 }} />
          </div>); })}
      </div>
      <div className="mread card">{reader}</div>
    </div></>);
}

/* ---------- Report: PM has view access + tracking ---------- */
export function PmReport({ r }) {
  if (!r) return <div className="card"><p className="muted" style={{ margin: 0 }}>Not found in your project.</p></div>;
  const rpt = hasReport(r);
  return (<>
    <p style={{ margin: "0 0 12px" }}><a href="#pm-list">← All requests</a></p>
    <div className="stack" style={{ marginBottom: 16 }}><DecisionBanner r={r} /><StatusBar status={statusOf(r)} /><Rule /></div>
    <div className="review">
      <div className="stack"><ReqHeader r={r} /><div className="grid2"><StockCard r={r} /><RfqCard r={r} /></div></div>
      <div className="aside stack">
        <div className="card"><h2>Tracking</h2><Tracking r={r} />
          {r.stage === "drafts" && <a className="btn primary block" href="#pm-outbox" style={{ marginTop: 8 }}>Send {r.vendors.length - r.sent.length} RFQ drafts</a>}</div>
        {rpt && <div className="card"><div className="small muted">Clay's recommendation</div>
          <div style={{ fontSize: 17, fontWeight: 700, margin: "2px 0" }}>{r.rec}</div><div>{recQ(r).total} ex-GST · score {recQ(r).score}</div>
          <p className="small muted" style={{ margin: "10px 0 0" }}>You have view access. The HOD approves or sends back.</p></div>}
      </div>
    </div>
    {r.stage !== "instock" && <div style={{ marginTop: 20 }}>
      <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 10 }}><h2 style={{ fontSize: 16, margin: 0 }}>Consolidated ranking report</h2><span className="chip s-stock">View only</span></div>
      {rpt ? <RankingTable r={r} /> : <div className="card"><p className="muted" style={{ margin: 0 }}>Clay builds this report once all replies are in, then sends it to the HOD.</p></div>}
    </div>}
  </>);
}

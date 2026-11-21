import { useStore } from "../store.jsx";
import { P, pmName, ranked, repliedVendors, hasReport, VM } from "../data.js";
import { Txt, Flags } from "./ui.jsx";

export function ReqHeader({ r }) {
  return (
    <div className="card">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>{r.id} · Vinayak {r.project}</h2>
        <span className="demo">{r.sample ? "Sample data" : "Demo data"}</span>
      </div>
      <p style={{ margin: "6px 0 12px", fontSize: 16, fontWeight: 600 }}>{r.title}</p>
      <dl className="kv">
        <dt>Needed by</dt><dd>{r.needBy}</dd>
        <dt>Raised by</dt><dd>{r.by} (site engineer) · {r.via}</dd>
        <dt>PM</dt><dd>{pmName(r)}</dd>
      </dl>
      <div className="grid2" style={{ marginTop: 12 }}>
        <div><div className="small muted">{r.origLabel}</div><div className="quote"><Txt>{r.orig}</Txt></div></div>
        <div><div className="small muted">English meaning</div><div className="quote">{r.english}</div></div>
      </div>
    </div>);
}

export function StockCard({ r }) {
  return (
    <div className="card"><h2>Stock check</h2>
      <div className="tablewrap" style={{ border: 0 }}><table>
        <thead><tr><th>Material</th><th className="num">Available</th><th className="num">Short</th><th className="num">RFQ qty</th></tr></thead>
        <tbody>{r.stock.map(s => <tr key={s[0]}><td>{s[0]}</td><td className="num">{s[1]}</td><td className="num"><b>{s[2]}</b></td><td className="num">{s[3]}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted" style={{ margin: "8px 0 0" }}>Source: stock · updated 21 Nov 10:00</p>
      {r.stockReply && <div className="notice" style={{ marginTop: 10 }}>{r.stockReply}</div>}
    </div>);
}

export function RfqCard({ r }) {
  if (r.stage === "instock") return <div className="card"><h2>RFQ</h2><p className="muted" style={{ margin: 0 }}>Not needed. Clay answered the site engineer instantly on WhatsApp.</p></div>;
  const rep = repliedVendors(r);
  const label = v => rep.includes(v) ? `Replied · ${P("time")} · email` : r.sent.includes(v) ? "Sent · awaiting reply" : "Draft ready";
  return (
    <div className="card"><h2>RFQ · {r.vendors.length} vendors · {r.sent.length} sent · {rep.length} replied</h2>
      {r.vendors.map(v => <div key={v} className="minirow"><span>{v}</span><span className="muted"><Txt>{label(v)}</Txt></span></div>)}
    </div>);
}

const Perf = ({ vm }) => vm.isNew ? "New vendor" : <>On-time {vm.ot}<br />Quality {vm.q}/5<br />Replies {vm.rp}</>;

export function RankingTable({ r }) {
  const { dispatch } = useStore();
  return (
    <>
      <div className="tablewrap"><table>
        <caption className="sr">Vendor ranking for {r.id}</caption>
        <thead><tr><th>#</th><th>Vendor</th><th className="num">Landed / unit<div style={{ textTransform: "none", letterSpacing: 0 }}>ex-GST</div></th><th className="num">Total ex-GST</th><th>Delivery</th><th>Payment</th><th>Performance</th><th className="num">Score /100</th><th>Reason</th></tr></thead>
        <tbody>{ranked(r).map(q => {
          const link = <button className="link small" onClick={() => dispatch({ type: "openRaw", key: r.id + "|" + q.v })}>View original reply</button>;
          if (q.unranked) return (
            <tr key={q.v} className="unranked"><td>—</td>
              <td><b style={{ color: "var(--ink)" }}>{q.v}</b><div><Flags list={q.flags} /></div>{link}</td>
              <td className="num">—</td><td className="num">—</td><td>—</td><td>—</td>
              <td className="perf"><Perf vm={VM[q.v]} /></td><td className="num">Not ranked</td><td>{q.reason}</td></tr>);
          const rec = q.v === r.rec;
          return (
            <tr key={q.v} className={rec ? "rec" : ""}><td><b>{q.rank}</b></td>
              <td><b>{q.v}</b>{rec && <div><span className="chip s-hod" style={{ marginTop: 4 }}>Recommended</span></div>}<div><Flags list={q.flags} /></div>{link}</td>
              <td className="num"><div className="small muted">{q.quoted}</div><b>{q.landed}</b><span className="small muted">/{q.u}</span>{q.extra && <div className="small muted">{q.extra}</div>}</td>
              <td className="num"><b>{q.total}</b>{q.diff && <div className="small muted">{q.diff}</div>}</td>
              <td style={{ whiteSpace: "nowrap" }}>{q.days}</td><td style={{ whiteSpace: "nowrap" }}>{q.terms}</td>
              <td className="perf"><Perf vm={VM[q.v]} /></td><td className="num score">{q.score}</td><td style={{ minWidth: 180 }}>{q.reason}</td></tr>);
        })}</tbody>
      </table></div>
      <p className="small muted" style={{ margin: "8px 2px 0" }}>Score = 50% price · 20% delivery · 30% past performance. Unranked vendors are shown but not scored.</p>
    </>);
}

function Step({ done, label, sub }) {
  return <li className={done ? "t-done" : ""}><span className="tdot" aria-hidden="true" /><div><b>{label}</b>{sub && <div className="small muted">{sub}</div>}</div></li>;
}
export function Tracking({ r }) {
  const n = r.vendors.length, rep = repliedVendors(r).length, rpt = hasReport(r);
  if (r.stage === "instock") return (
    <ol className="track"><Step done label="Requirement received" sub={`${r.by} · ${r.via}`} /><Step done label="Stock checked" sub="21 Nov 10:00 · available" /><Step done label="Answered instantly on WhatsApp" sub="No RFQ, no approval needed" /></ol>);
  return (
    <ol className="track">
      <Step done label="Requirement received" sub={`${r.by} · ${r.via}`} />
      <Step done label="Stock checked" sub="21 Nov 10:00 · short" />
      <Step done label="RFQ emails drafted by Clay" sub={`${n} vendors`} />
      <Step done={r.sent.length === n} label="RFQs sent" sub={`${r.sent.length} of ${n} sent`} />
      <Step done={rep === n} label="Replies in" sub={`${rep} of ${n}`} />
      <Step done={rpt} label="Report sent to HOD" sub={rpt ? "Vikram · email + WhatsApp with approval link" : "sent automatically when replies are in"} />
      <Step done={["approved", "sentback"].includes(r.stage)} label="HOD decision" sub={r.stage === "approved" ? "Approved" : r.stage === "sentback" ? "Sent back" : "pending"} />
    </ol>);
}

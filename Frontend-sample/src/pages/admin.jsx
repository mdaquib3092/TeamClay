import { useRef, useState } from "react";
import { useStore } from "../store.jsx";
import { VM, logRows } from "../data.js";
import { Txt, Seg } from "../components/ui.jsx";

const PH = ({ t }) => <span className="ph">[{t}]</span>;

export function AdminData() {
  const cards = [["Materials", "40"], ["Stock", "80"], ["Vendors", "15"], ["Vendor performance", "15"]];
  const refs = useRef([]);
  return (
    <div className="cards4">{cards.map(([n, c], i) => (
      <div key={n} className="card upload">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ margin: 0 }}>{n}</h2><span className="num"><b>{c}</b> rows</span></div>
        <div className="small muted">Last updated {i === 1 ? "21 Nov 10:00" : <PH t="date, time" />}</div>
        <div className="dz">
          <label htmlFor={`f${i}`} style={{ margin: 0, fontWeight: 500 }}>Drop CSV here or</label>
          <input id={`f${i}`} ref={el => (refs.current[i] = el)} type="file" accept=".csv" className="sr" />
          <button className="btn" style={{ marginTop: 8 }} onClick={() => refs.current[i].click()}>Upload CSV</button>
        </div>
        <div className="tablewrap"><table>
          <thead><tr>{[0, 1, 2].map(k => <th key={k}><PH t="column" /></th>)}</tr></thead>
          <tbody>{[0, 1, 2].map(k => <tr key={k}>{[0, 1, 2].map(j => <td key={j}><PH t="value" /></td>)}</tr>)}</tbody>
        </table></div>
        <div className="small">Errors: <b>0</b> <span className="muted"><PH t="error list shows here" /></span></div>
      </div>))}</div>);
}

export function AdminVendors() {
  const list = Object.entries(VM);
  return (<>
    <div className="toolbar"><b>{list.length} vendors</b><span className="muted small">Vendors with no orders show "New vendor", never a low score. Rows 5–15 are sample data.</span></div>
    <div className="tablewrap"><table>
      <thead><tr><th>Vendor</th><th>Category</th><th>WhatsApp</th><th>Email</th><th>Payment terms</th><th className="num">Orders</th><th className="num">On-time</th><th className="num">Quality</th><th className="num">Avg reply</th></tr></thead>
      <tbody>{list.map(([n, v]) => (
        <tr key={n}><td><b>{n}</b></td><td>{v.cat}</td><td><PH t="number" /></td><td><PH t="email" /></td><td>{v.terms || <PH t="terms" />}</td>
          {v.isNew ? <td colSpan={4}><span className="flag" style={{ margin: 0 }}>New vendor</span> <span className="small muted">No orders yet</span></td>
            : <><td className="num"><PH t="n" /></td><td className="num">{v.ot}</td><td className="num">{v.q}/5</td><td className="num">{v.rp}</td></>}</tr>))}</tbody>
    </table></div></>);
}

const STOCK = {
  Amara: [["TMT 12mm", "Steel", "0.4", "MT", true], ["TMT 16mm", "Steel", "0", "MT", false], ["Cement OPC 53", "Cement", "0", "bags", false], ["AAC block 600×200×200 mm", "Blocks", "0", "nos", false], ["Binding wire 18 gauge", "Hardware", "350", "kg", true]],
  Aquina: [["River sand", "Sand & aggregates", "0", "cft", false], ["Stone chips 20 mm", "Sand & aggregates", "0", "cft", false], ["Cement OPC 53", "Cement", "0", "bags", false], ["PVC conduit 25 mm", "Electrical", "800", "m", true]],
};
export function AdminStock() {
  const [proj, setProj] = useState("Amara"); const [f, setF] = useState("all");
  const cnt = proj === "Amara" ? { a: 23, o: 17 } : { a: 13, o: 27 };
  const rows = STOCK[proj].filter(r => f === "all" || (f === "avail" ? r[4] : !r[4]));
  return (<>
    <div className="toolbar">
      <Seg label="Project" value={proj} onChange={setProj} options={[["Amara", "Amara"], ["Aquina", "Aquina"]]} />
      <Seg label="Filter" value={f} onChange={setF} options={[["all", `All · ${cnt.a + cnt.o}`], ["avail", `Available · ${cnt.a}`], ["out", `Out of stock · ${cnt.o}`]]} />
      <span className="small muted">Updated 21 Nov 10:00</span></div>
    <div className="tablewrap"><table>
      <thead><tr><th>Code</th><th>Material</th><th>Category</th><th className="num">Qty available</th><th>Unit</th><th>Status</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r[0]}><td><PH t="code" /></td><td>{r[0]}</td><td>{r[1]}</td><td className="num">{r[2]}</td><td>{r[3]}</td>
        <td>{r[4] ? <span className="chip s-stock">Available</span> : <span className="chip s-replies">Out of stock</span>}</td></tr>)}</tbody>
    </table></div>
    <p className="small muted">Showing rows used by the sample orders. <PH t="remaining rows from Stock CSV" /></p></>);
}

function AgentCard({ title }) {
  const [res, setRes] = useState("");
  const test = () => { setRes("Sending…"); setTimeout(() => setRes("Demo result: [agent response]"), 600); };
  const id = title.split(" ")[0].toLowerCase();
  return (
    <div className="card"><h2>{title}</h2>
      <div className="field"><label htmlFor={id + "u"}>Agent URL</label><input id={id + "u"} type="text" placeholder="[https://agent-url]" /></div>
      <div className="field"><label htmlFor={id + "k"}>API key</label><input id={id + "k"} type="password" placeholder="[API key]" /></div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}><button className="btn" onClick={test}>Send test</button><span className="small" role="status"><Txt>{res}</Txt></span></div>
    </div>);
}
export function AdminIntegrations() {
  const [sim, setSim] = useState(true); const [msg, setMsg] = useState("Give this URL to both agents so replies reach Clay.");
  const url = "[https://clay.example/webhook/inbound]";
  const copy = async () => { try { await navigator.clipboard.writeText(url); setMsg("Copied."); } catch { setMsg("Select the URL and press Ctrl+C to copy."); } };
  return (<>
    <div className="grid2"><AgentCard title="WhatsApp agent" /><AgentCard title="Email agent" /></div>
    <div className="card" style={{ marginTop: 16 }}><h2>Our inbound webhook</h2>
      <div className="inline"><input type="text" readOnly value={url} aria-label="Inbound webhook URL" /><button className="btn" onClick={copy}>Copy</button></div>
      <div className="help" role="status">{msg}</div></div>
    <div className="card" style={{ marginTop: 16 }}><h2>Sample data</h2>
      <label className="switch"><input type="checkbox" checked={sim} onChange={e => setSim(e.target.checked)} /> Simulate vendor replies (sample data)</label>
      <div className="help">When on, vendor replies come from demo data instead of the live agents.</div></div></>);
}

export function AdminLog() {
  const { reqs } = useStore();
  const [rq, setRq] = useState("all"); const [ch, setCh] = useState("all");
  const rows = logRows(reqs).filter(r => (ch === "all" || r[0] === ch) && (rq === "all" || r[4] === rq));
  return (<>
    <div className="toolbar">
      <div><label htmlFor="lr">Requirement</label><select id="lr" value={rq} onChange={e => setRq(e.target.value)}><option value="all">All</option>{reqs.map(r => <option key={r.id}>{r.id}</option>)}</select></div>
      <div><label htmlFor="lc">Channel</label><select id="lc" value={ch} onChange={e => setCh(e.target.value)}><option value="all">All</option><option>WhatsApp</option><option>Email</option></select></div>
      <span className="small muted" style={{ alignSelf: "flex-end", paddingBottom: 12 }}>{rows.length} messages</span></div>
    <div className="tablewrap"><table>
      <thead><tr><th>Time</th><th>Channel</th><th>Dir.</th><th>From</th><th>To</th><th>Req.</th><th>Message</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td className="num"><PH t="time" /></td><td>{r[0]}</td><td>{r[1] === "In" ? "↓ In" : "↑ Out"}</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td><td style={{ minWidth: 260 }}><Txt>{r[5]}</Txt></td><td>{r[6]}</td></tr>)}</tbody>
    </table></div></>);
}

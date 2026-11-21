import { useEffect, useRef } from "react";
import { useStore } from "../store.jsx";
import { Txt, Flags } from "./ui.jsx";

/** Side panel with a vendor's original reply. */
export default function Drawer() {
  const { drawer, byId, dispatch } = useStore();
  const close = () => dispatch({ type: "closeRaw" });
  const btn = useRef(null);
  useEffect(() => {
    if (!drawer) return;
    btn.current?.focus();
    const onKey = e => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  let title = "Original reply", body = null;
  if (drawer) {
    const [id, v] = drawer.split("|"); const r = byId(id), q = r?.quotes[v];
    if (!q) return null;
    title = v + " · original reply";
    body = (<>
      <div className="small muted">{r.id} · {q.sourceName} · saved {new Date(q.receivedAt).toLocaleString()}</div>
      <div className="raw" style={{ marginTop: 10 }}>{q.rawMessage || "No source text recorded."}</div>
      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>What Clay read from it</h3>
      <dl className="kv">{q.unranked
        ? <><dt>Status</dt><dd>Not ranked</dd><dt>Review needed</dt><dd>{q.reason}</dd><dt>Measured base subtotal</dt><dd>{q.baseTotal}</dd></>
        : <><dt>Quoted</dt><dd>{q.quoted}</dd><dt>Landed ex-GST</dt><dd>{q.landed}/{q.u}</dd><dt>Delivery</dt><dd>{q.days}</dd><dt>Payment</dt><dd>{q.terms}</dd></>}</dl>
      {q.flags.length > 0 && <div style={{ marginTop: 12 }}><Flags list={q.flags} /></div>}
    </>);
  }
  return (<>
    <div className={`scrim ${drawer ? "open" : ""}`} onClick={close} />
    <aside className={`drawer ${drawer ? "open" : ""}`} role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <header><h2 id="drawerTitle" style={{ fontSize: 16, margin: 0 }}>{title}</h2>
        <button ref={btn} className="btn" onClick={close} aria-label="Close panel">Close</button></header>
      <div className="body">{body}</div>
    </aside>
  </>);
}

import { useStore } from "../store.jsx";
import { USERS, repliedVendors } from "../data.js";

export const NAV = {
  PM: [["live-cases","Live RFQ desk"],["pm-inbox", "Inbox"], ["pm-outbox", "Outbox"], ["pm-list", "Requests"], ["pm-workflow", "Procurement workflow"]],
  HOD: [["live-cases","Live RFQ desk"],["hod-list", "Approvals"]],
  Admin: [["live-cases","Live RFQ desk"],["admin-data", "Source data"], ["admin-vendors", "Vendors"], ["admin-stock", "Stock"], ["admin-integrations", "Integrations"], ["admin-agent", "Agent inbox"], ["admin-log", "Activity log"]],
};

function useBadges() {
  const { user, reqs, read, myReqs } = useStore();
  const role = USERS[user].role;
  if (role === "HOD") return { "hod-list": reqs.filter(r => r.stage === "hod").length };
  if (role === "PM") return {
    "pm-outbox": myReqs.reduce((a, r) => a + (r.stage === "drafts" ? r.vendors.length - r.sent.length : 0), 0),
    "pm-inbox": myReqs.flatMap(r => repliedVendors(r).map(v => r.id + "|" + v)).filter(k => !read.includes(k)).length,
  };
  return {};
}

export default function Layout({ page, title, children }) {
  const { user, dispatch, payload, error, busy, clearError, reload } = useStore();
  const u = USERS[user], badges = useBadges();
  return (
    <div className="app">
      <nav className="side" aria-label="Main">
        <div className="brand"><i aria-hidden="true" /><div>Clay<small>Vinayak Group</small></div></div>
        <div className="nav">
          {NAV[u.role].map(([k, l]) => (
            <a key={k} href={`#${k}`} aria-current={k === page ? "page" : undefined}>
              {l}{badges[k] ? <span className="badge">{badges[k]}</span> : null}
            </a>))}
        </div>
        <div className="who"><b>{payload.identity.name}</b>
          <div className="muted">{u.name} view · owner-private session</div>
          <button className="link small" onClick={() => { dispatch({ type: "logout" }); location.hash = "login"; }}>Switch view</button></div>
      </nav>
      <main className="main">
        <div className="top"><h1>{title}</h1>{page==="live-cases" ? <span className="demo">TeamClay · local workspace</span> : <div className="inline"><button className="btn" disabled={busy} onClick={reload}>Refresh</button><span className="demo">Saved revision {payload.workspace.revision}</span></div>}</div>
        <div className="content">
          {page!=="live-cases" && <div className="notice" style={{ marginBottom: 16 }}>This workspace uses internal test inboxes. Track PM-confirmed Gmail RFQs, vendor replies and HOD WhatsApp decisions in the <a href="#live-cases">Live RFQ desk</a>.</div>}
          {error && <div className="notice err" role="alert">{error} <button className="link" onClick={clearError}>Dismiss</button></div>}
          {busy && <p role="status">Saving to the backend…</p>}
          {children}
        </div>
      </main>
    </div>);
}

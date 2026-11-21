import { useStore } from "../store.jsx";
import { USERS, repliedVendors } from "../data.js";

export const NAV = {
  PM: [["pm-inbox", "Inbox"], ["pm-outbox", "Outbox"], ["pm-list", "Requests"]],
  HOD: [["hod-list", "Approvals"]],
  Admin: [["admin-data", "Data upload"], ["admin-vendors", "Vendors"], ["admin-stock", "Stock"], ["admin-integrations", "Integrations"], ["admin-log", "Activity log"]],
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
  const { user, dispatch } = useStore();
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
        <div className="who"><b>{u.name}</b> · {u.role}
          <div className="muted">{u.role === "PM" ? "Vinayak " + u.project : u.project}</div>
          <button className="link small" onClick={() => { dispatch({ type: "logout" }); location.hash = "login"; }}>Switch user</button></div>
      </nav>
      <main className="main">
        <div className="top"><h1>{title}</h1><span className="demo">Demo data</span></div>
        <div className="content">{children}</div>
      </main>
    </div>);
}

import { useEffect, useState } from "react";
import { useStore } from "./store.jsx";
import { USERS } from "./data.js";
import Layout, { NAV } from "./components/Layout.jsx";
import Drawer from "./components/Drawer.jsx";
import Login from "./pages/Login.jsx";
import { PmInbox, PmOutbox, PmRequests, PmReport } from "./pages/pm.jsx";
import { HodList, HodView } from "./pages/hod.jsx";
import { AdminData, AdminVendors, AdminStock, AdminIntegrations, AdminLog } from "./pages/admin.jsx";

/* page key -> [title, component, parent nav key] */
const PAGES = {
  "pm-inbox": ["Inbox", PmInbox], "pm-outbox": ["Outbox", PmOutbox], "pm-list": ["Requests", PmRequests],
  "pm-report": ["Report", PmReport, "pm-list"],
  "hod-list": ["Approvals", HodList], "hod-view": ["Approve", HodView, "hod-list"],
  "admin-data": ["Data upload", AdminData], "admin-vendors": ["Vendors", AdminVendors], "admin-stock": ["Stock", AdminStock],
  "admin-integrations": ["Integrations", AdminIntegrations], "admin-log": ["Activity log", AdminLog],
};

/** Tiny hash router: #pm-inbox, #report-1001, #approve-1001 */
function parse(hash) {
  let m;
  if ((m = hash.match(/^report-(\d+)$/))) return { page: "pm-report", id: "REQ-" + m[1] };
  if ((m = hash.match(/^approve-(\d+)$/))) return { page: "hod-view", id: "REQ-" + m[1] };
  return { page: hash };
}
function useHash() {
  const [h, setH] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => { setH(location.hash.slice(1)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}

export default function App() {
  const { user, byId, myReqs } = useStore();
  const hash = useHash();
  if (!user) return <Login />;

  let { page, id } = parse(hash);
  const role = USERS[user].role;
  const allowed = NAV[role].map(n => n[0]);
  if (!PAGES[page] || !(allowed.includes(page) || allowed.includes(PAGES[page][2]))) page = USERS[user].home;

  const [title, Page, parent] = PAGES[page];
  let props = {};
  if (id) {
    const r = byId(id);
    // a PM may only open requests from their own project
    props = { r: page === "pm-report" && r && !myReqs.includes(r) ? null : r };
  }
  return (
    <Layout page={parent || page} title={id ? `${title} · ${id}` : title}>
      <Page {...props} />
      <Drawer />
    </Layout>);
}

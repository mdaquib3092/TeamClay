import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { request } from "./api.mjs";
import { workspaceView } from "./view-model.mjs";

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true), [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [user, setUser] = useState(null), [read, setRead] = useState([]), [drawer, setDrawer] = useState(null);
  const [intakeDraft, setIntakeDraft] = useState(null);
  const current = useRef(null), working = useRef(false);
  const reload = useCallback(async () => {
    try {
      const data = await request("/api/integration");
      current.current = data; setPayload(data); setAuthRequired(false);
      return data;
    } catch (e) { if (e.status === 401) setAuthRequired(true); throw e; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload().catch(e => setError(e.message)); }, [reload]);
  const act = async action => {
    if (working.current || !current.current) return null;
    working.current = true; setBusy(true); setError("");
    try {
      const next = await request("/api/actions", {
        method: "POST", body: { revision: current.current.workspace.revision, action },
      });
      // Keep the saved revision even if refreshing the computed view fails.
      current.current = { ...current.current, workspace: next };
      await reload();
      return next;
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await reload().catch(() => {});
      return null;
    } finally { working.current = false; setBusy(false); }
  };
  const dispatch = async action => {
    if (action.type === "login") { setUser(action.user); return; }
    if (action.type === "logout") { setUser(null); setDrawer(null); return; }
    if (action.type === "markRead") { setRead(values => values.includes(action.key) ? values : [...values, action.key]); return; }
    if (action.type === "openRaw") { setDrawer(action.key); return; }
    if (action.type === "closeRaw") { setDrawer(null); return; }
    if (action.type === "sendAll") return act({ type: "send_rfqs", requestId: action.id, vendorIds: action.vendorIds });
    if (action.type === "hodApprove" || action.type === "hodBack") {
      const approval = current.current?.workspace.approvals.find(item => item.requestId === action.id && item.status === "Pending");
      if (!approval) { setError("There is no current pending recommendation. Refresh the workspace."); return null; }
      if (!action.reason?.trim()) { setError("Record a human review note before deciding."); return null; }
      return act({ type: "review_approval", approvalId: approval.id,
        decision: action.type === "hodApprove" ? "Approved" : "Changes requested",
        reviewer: current.current.identity.name, note: action.reason.trim() });
    }
    setError("This demo-only action has been removed. Use the saved procurement workflow.");
    return null;
  };
  const view = payload ? workspaceView(payload) : { reqs: [], vendors: {} };
  const byId = id => view.reqs.find(r => r.id === id);
  return <Ctx.Provider value={{
    ...view, user, read, drawer, payload, loading, authRequired, error, busy, dispatch, act, intakeDraft, setIntakeDraft,
    reload: () => reload().catch(e => setError(e.message)), clearError: () => setError(""),
    byId, myReqs: view.reqs,
  }}>{children}</Ctx.Provider>;
}

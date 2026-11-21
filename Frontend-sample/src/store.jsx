import { createContext, useContext, useReducer } from "react";
import { initialReqs, repliedVendors } from "./data.js";

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const upd = (s, id, fn) => ({ ...s, reqs: s.reqs.map(r => (r.id === id ? fn(r) : r)) });
// once every RFQ is sent the request moves to "RFQ sent"
const advance = r => (r.sent.length === r.vendors.length ? { ...r, stage: "sent", replied: 0 } : r);

const init = () => {
  const reqs = initialReqs();
  // threads already opened in the starting data
  const read = ["REQ-1001", "REQ-1003", "REQ-1006"].flatMap(id => {
    const r = reqs.find(x => x.id === id);
    return repliedVendors(r).map(v => id + "|" + v);
  });
  return { user: null, reqs, read, drawer: null };
};

function reducer(s, a) {
  switch (a.type) {
    case "login":  return { ...s, user: a.user };
    case "logout": return { ...s, user: null };
    case "send":    return upd(s, a.id, r => advance({ ...r, sent: [...new Set([...r.sent, a.vendor])] }));
    case "sendAll": return upd(s, a.id, r => advance({ ...r, sent: [...r.vendors] }));
    case "simReplies": return upd(s, a.id, r => ({ ...r, replied: r.vendors.length, stage: "hod" }));
    case "hodApprove": return upd(s, a.id, r => ({ ...r, stage: "approved", decision: { text: "Approved by Vikram in the web app" } }));
    case "hodBack":    return upd(s, a.id, r => ({ ...r, stage: "sentback", decision: { text: "Sent back by Vikram in the web app", reason: a.reason } }));
    case "markRead": return s.read.includes(a.key) ? s : { ...s, read: [...s.read, a.key] };
    case "openRaw":  return { ...s, drawer: a.key };
    case "closeRaw": return { ...s, drawer: null };
    default: return s;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const byId = id => state.reqs.find(r => r.id === id);
  const myReqs = state.reqs.filter(r => r.pm === state.user);
  return <Ctx.Provider value={{ ...state, dispatch, byId, myReqs }}>{children}</Ctx.Provider>;
}

import { useStore } from "../store.jsx";
import { USERS } from "../data.js";

export default function Login() {
  const { dispatch } = useStore();
  const enter = k => { dispatch({ type: "login", user: k }); location.hash = USERS[k].home; };
  return (
    <div className="login"><div className="box">
      <div className="brand" style={{ padding: 0 }}><i aria-hidden="true" /><div>Clay<small>Procurement assistant · Vinayak Group</small></div></div>
      <h1 style={{ fontSize: 26, margin: "28px 0 4px" }}>Choose a demo user</h1>
      <p className="muted" style={{ margin: 0 }}>REQ-1001 uses the brief's data. REQ-1002 to REQ-1008 are invented sample orders. Actions are shared across users in this session.</p>
      <div className="users">
        {Object.entries(USERS).map(([k, u]) => <button key={k} className="user" onClick={() => enter(k)}><b>{u.name}</b><span>{u.blurb}</span></button>)}
      </div>
    </div></div>);
}

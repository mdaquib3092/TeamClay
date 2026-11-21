import { useStore } from "../store.jsx";
import { USERS } from "../data.js";

export default function Login() {
  const { dispatch, payload, error, reload } = useStore();
  const enter = k => { dispatch({ type: "login", user: k }); if(location.hash!=="#live-cases")location.hash = USERS[k].home; };
  return (
    <div className="login"><div className="box">
      <div className="brand" style={{ padding: 0 }}><i aria-hidden="true" /><div>Clay<small>Procurement assistant · Vinayak Group</small></div></div>
      <h1 style={{ fontSize: 26, margin: "28px 0 4px" }}>Open your connected workspace</h1>
      <p className="muted">Signed in as <b>{payload?.identity.name || "Workspace unavailable"}</b>. These are navigation views, not separate authenticated staff accounts. Human decisions are recorded under your signed-in identity.</p>
       {error && <p className="err" role="alert">{error} <button className="btn" onClick={reload}>Retry connection</button></p>}
       <button className="btn primary" disabled={!payload} onClick={()=>{dispatch({type:"login",user:"desk"});location.hash="live-cases";}}>Open live RFQ desk</button>
      <div className="users">
        {Object.entries(USERS).map(([k, u]) => <button key={k} className="user" disabled={!payload} onClick={() => enter(k)}><b>{u.name}</b><span>{u.blurb}</span></button>)}
      </div>
    </div></div>);
}

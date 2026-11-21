import { useEffect, useState } from "react";
import { request } from "../api.mjs";

const base="/local-api/procurement";
const titles={BOQ_REVIEW:"PM reviewing RFQ",IN_STOCK:"Covered by stock",DISPATCHING:"Sending RFQs",AWAITING_QUOTES:"Waiting for vendor replies",QUOTE_CLARIFICATION:"Replies received · clarification needed",COMPARISON:"Comparison ready",WITH_HOD:"HOD decision pending",APPROVED:"HOD approved"};
const delivery={not_sent:"Draft",queued:"Queued",sending:"Sending",accepted:"Accepted",unconfirmed:"Acceptance unconfirmed",held:"Held",superseded:"Superseded",failed:"Failed"};
const at=value=>value ? new Date(value).toLocaleString("en-IN") : "";
const money=n=>n==null?"—":new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(n/100);
const staffName=(board,id)=>board.staff.find(u=>u.id===id)?.name || id;

function Copy({text,label="Copy message"}) {
  const [result,setResult]=useState("");
  useEffect(()=>setResult(""),[text]);
  return <button type="button" className="btn" onClick={async()=>{
    try {await navigator.clipboard.writeText(text);setResult("Copied");} catch {setResult("Select the message to copy");}
  }}>{result||label}</button>;
}
function Draft({board,text,label="Open WhatsApp draft"}) {
  return <div className="live-buttons"><Copy text={text}/>{board.agentNumber && <a className="btn" target="_blank" rel="noreferrer" href={`https://wa.me/${board.agentNumber}?text=${encodeURIComponent(text)}`}>{label} ↗</a>}</div>;
}
function Message({from,to,text}) {
  return <article className="live-message"><p className="small"><b>{from}</b> → {to}</p><pre>{text || "No text recorded."}</pre></article>;
}
function SampleRunner({guide,board}) {
  const [run,setRun]=useState(null),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const site=board.staff.find(u=>u.role==="site_engineer"), pm=board.staff.find(u=>u.role==="project_manager");
  async function start() {
    setBusy(true);setError("");
    try{const data=await request(`${base}/samples/${guide.key}`);setRun(data);setStep(0);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="stack">
    <div><h3>{guide.title}</h3><p>{guide.invites.map(v=>v.contact?.name || `${v.id} (not configured)`).join(" · ")}</p>
      <button className="btn primary" disabled={busy || guide.invites.some(v=>!v.contact)} onClick={start}>{busy?"Running…":run?"Restart walkthrough":`Run ${guide.label.toLowerCase()} sample`}</button>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
    {run && <section aria-label="Sample messages" className="live-walk">
      <p className="notice"><b>Rehearsal · simulated delivery.</b> These are actual outputs of the case workflow running in memory. This case ID is for the walkthrough only.</p>
      <div className="live-steps" aria-label="Walkthrough steps">{run.steps.map((s,i)=><button type="button" className="btn" key={s.label} aria-pressed={step===i} onClick={()=>setStep(i)}>{i+1}. {s.label}</button>)}</div>
      <h3>Step {step+1} of {run.steps.length} · {run.steps[step].label}</h3>
      {run.steps[step].items.map((item,i)=><Message key={i} {...item}/>)}
      <div className="live-buttons"><button className="btn" disabled={!step} onClick={()=>setStep(step-1)}>Back</button>
        <button className="btn primary" disabled={step===run.steps.length-1} onClick={()=>setStep(step+1)}>Next step</button></div>
    </section>}
    <details><summary><b>Run this sample with your real WhatsApp and Gmail</b></summary>
      <p>{site?.name || "Site engineer"} sends this message to the agent. It opens a new live case. {pm?.name || "The PM"} reviews the generated RFQs and must confirm before any vendor email goes out.</p>
      <Message from={site?.name || "Site engineer"} to={`Agent${board.connections.agentEnding?" · "+board.connections.agentEnding:""}`} text={guide.starter}/><Draft board={board} text={guide.starter}/>
      <p>After dispatch, click <b>Reply</b> in each vendor’s own RFQ email. Use these hypothetical terms for the test:</p>
      {guide.invites.map(v=><div key={v.id}><Message from={`${v.id} · ${v.contact?.email || "Missing address"}`} to="Reply in the RFQ thread" text={v.reply}/><Copy text={v.reply} label={`Copy ${v.id} reply`}/></div>)}
    </details>
  </div>;
}

function CaseAction({c,board}) {
  const eligible=c.vendors.filter(v=>v.comparable);
  const [vendor,setVendor]=useState(eligible[0]?.id || ""),[note,setNote]=useState(""),[decision,setDecision]=useState("APPROVE");
  if(c.stage==="BOQ_REVIEW") {
    const enough=c.vendors.length >= (c.minimumInvites ?? (c.demo ? board.demoMinimum : board.standardMinimum));
    const cmd=`SEND ${c.id} B${c.boqRev} ${c.vendors.map(v=>v.id).join(" ")}`;
    return <section><h3>{staffName(board,c.pm)} · PM review</h3><p>{enough?"Review the drafts below. Send this confirmation from the registered PM WhatsApp to email these recipients.":"This segment needs more eligible vendors before dispatch."}</p>
      {enough&&<div><p>The assigned PM’s WhatsApp review message includes a private, one-tap approval link. To request a fresh link from the PM’s own WhatsApp:</p><Draft board={board} text={`REVIEWLINK ${c.id}`} label="Request PM review link"/></div>}
      {enough&&<><pre>{cmd}</pre><Draft board={board} text={cmd}/></>}</section>;
  }
  if(!["COMPARISON","WITH_HOD"].includes(c.stage))return null;
  const pm=c.stage==="COMPARISON", verb=pm?"RECOMMEND":decision, pick=pm?vendor:c.selected;
  const cmd=`${verb} ${c.id} Q${c.quoteRev}${verb==="RETURN"?"":" "+pick} | ${note.trim()}`;
  return <section><h3>{staffName(board,pm?c.pm:c.hod)} · {pm?"PM recommendation":"HOD decision"}</h3>
    {pm?<label>Reviewed vendor<select value={vendor} onChange={e=>setVendor(e.target.value)}>{eligible.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>:
      <label>Decision<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="APPROVE">Approve {c.selected} and reviewed rates</option><option value="RETURN">Return for changes</option></select></label>}
    <label>Review note<input type="text" maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
    {note.trim().length>=2 && <><pre>{cmd}</pre><Draft board={board} text={cmd}/></>}
    <p className="small muted">Only the assigned person sending the command in WhatsApp records this decision.</p>
  </section>;
}

function CasePanel({c,board}) {
  return <article className="card live-panel"><div className="toolbar"><b>{c.id}</b><span className="chip s-rfq">{titles[c.stage]||c.stage}</span><span>{c.runKey?"Workflow run · WhatsApp & Gmail":c.demo?"Demo case · real channels":"Standard case"} · B{c.boqRev} / Q{c.quoteRev}</span></div>
    <p>{c.project} · {c.site} · {c.segment} · Needed {c.neededBy} · Quote deadline {c.deadline}</p>
    <details><summary>Site engineer’s message and PM review</summary><Message from={staffName(board,c.owner)} to="Agent" text={c.submission}/>
      {c.review&&<Message from="Agent" to={staffName(board,c.pm)} text={c.review}/>}</details>
    <h3>BOQ</h3><ul>{c.lines.map(l=><li key={l.code}>{l.code} · {l.name} · Requested {l.requested}, stock {l.stock}, RFQ <b>{l.qty} {l.unit}</b></li>)}</ul>
    <h3>Vendor RFQs and Gmail replies</h3><div className="tablewrap"><table><thead><tr><th>Invited vendor</th><th>Gmail dispatch</th><th>Replies</th><th>Landed total</th></tr></thead><tbody>
      {c.vendors.map(v=><tr key={v.id}><td>{v.id} · {v.name}<div className="small muted">{v.email}</div></td><td>{delivery[v.delivery]||v.delivery}<div className="small muted">{at(v.accepted)}</div></td>
        <td>{v.replyCount} {v.pollError&&" · thread read needs attention"}<div className="small muted">{at(v.replied)}</div></td><td>{money(v.terms?.landed)}{v.sourceFlags?.length>0&&<div className="small">{v.sourceFlags.join(" ")}</div>}</td></tr>)}</tbody></table></div>
    {c.vendors.map(v=><details key={v.id}><summary>{v.id} · RFQ email and latest vendor reply</summary>
      {v.draft && <Message from="RFQ" to={v.email} text={`Subject: ${v.draft.subject}\n\n${v.draft.text}`}/>}
      {v.replyCount ? <Message from={v.name} to="Procurement Gmail" text={v.reply || "Reply recorded; no usable plain text. Request clarification."}/> : <p>Awaiting a reply.</p>}</details>)}
    <h3>Analysis for {staffName(board,c.hod)}</h3>{c.report?<pre>{c.report}</pre>:<p>No vendor comparison yet.</p>}
    {c.report&&<p className="small muted">The assigned HOD receives a one-tap WhatsApp link to compare both quotes, read the original replies and send a review note to the PM. To request the latest link, send <b>ANALYSIS {c.id}</b> from the registered HOD WhatsApp.</p>}
    {c.hodMessages.length ? c.hodMessages.map((m,i)=><details key={i}><summary>WhatsApp · Q{m.quote_rev} · {delivery[m.state]||m.state} {at(m.accepted)}</summary><pre>{m.text}</pre></details>):
      <p className="small muted">No HOD report queued yet. A comparison is sent automatically at {board.minimumQuotes} comparable replies; if all reply but terms are incomplete, an exception report is sent.</p>}
    {c.decisions.length>0&&<details><summary>Recorded reviews and decisions</summary>{c.decisions.map((d,i)=><p key={i}><b>{staffName(board,d.user_id)} · {d.status}</b> · {d.note} · {at(d.decided_at)}</p>)}</details>}
    {c.staffMessages.length>0&&<details><summary>Received staff commands</summary>{c.staffMessages.map((m,i)=><Message key={i} from={staffName(board,m.from_id)} to="Agent" text={m.text}/>)}</details>}
    <CaseAction key={`${c.id}:${c.stage}:${c.quoteRev}:${c.boqRev}`} c={c} board={board}/>
  </article>;
}

export default function LiveCases() {
  const [board,setBoard]=useState(null),[error,setError]=useState(""),[refresh,setRefresh]=useState(0),[sample,setSample]=useState("cement"),[id,setId]=useState("");
  useEffect(()=>{
    const controller=new AbortController();let timer;
    async function load(){
      try{const b=await request(`${base}/cases`,{signal:controller.signal});if(!controller.signal.aborted){setBoard(b);setError("");}}
      catch(e){if(!controller.signal.aborted){setError(e.message);setBoard(null);}}
      finally{if(!controller.signal.aborted)timer=setTimeout(load,5000);}
    }
    load();return()=>{controller.abort();clearTimeout(timer);};
  },[refresh]);
  const guide=board?.samples.find(s=>s.key===sample), c=board?.cases.find(c=>c.id===id) || board?.cases[0];
  return <div className="stack live-desk">
    <div className="live-head"><div><b>WhatsApp intake → Gmail RFQs → HOD on WhatsApp</b>
      <div className="small muted">{board?`${board.database} · Updated ${at(board.generatedAt)}`:"Connecting to the local case worker…"}</div></div>
      <button className="btn" onClick={()=>setRefresh(x=>x+1)}>Refresh cases</button></div>
    {error&&<p role="alert" className="notice err">{error}</p>}
    {board&&<>
      <div className="live-badges"><span className="chip s-rfq">WhatsApp {board.connections.whatsapp?"connected":"offline"}</span><span className="chip s-rfq">Gmail {board.connections.gmailAuthorised?"authorised":"unavailable"}</span>
        <span className="chip s-rfq">{board.sources.vendors.rows??"—"} vendor contacts · {board.sources.performance.matched??"—"} sample histories</span></div>
      {(board.workerError||board.sources.vendors.error||board.sources.performance.error)&&<p className="notice err">Needs attention: {board.workerError||board.sources.vendors.error||board.sources.performance.error}</p>}
      <section className="card"><h2>Start a live workflow run</h2><p>The registered site engineer sends one WhatsApp message. The PM reviews the actual vendor drafts before Gmail dispatches them.</p><a href="https://clay-procurement.teamclay-d326e1.workers.dev/runs">Steel and waterproofing: messages for every handoff →</a></section>
      <section className="card"><h2>Test three procurement samples</h2><p>Choose a sample to see the messages at each handoff, including the full RFQs and the automatic HOD comparison.</p>
        <div className="live-steps" aria-label="Sample selection">{board.samples.map(s=><button type="button" className="btn" key={s.key} aria-pressed={sample===s.key} onClick={()=>setSample(s.key)}>{s.label}</button>)}</div>
        {guide&&<SampleRunner key={guide.key} guide={guide} board={board}/>}
      </section>
      <section><h2>Live cases</h2><p className="small muted">Last 30 WhatsApp cases · refreshes automatically. Gmail and WhatsApp acceptance are shown from recorded sends.</p>
        {c?<><label>Case<select value={c.id} onChange={e=>setId(e.target.value)}>{board.cases.map(v=><option key={v.id} value={v.id}>{v.id} · {v.site} · {titles[v.stage]||v.stage}</option>)}</select></label><CasePanel c={c} board={board}/></>:
          <div className="card"><b>No live cases yet.</b> Start one with the site engineer’s WhatsApp message under the selected sample. A rehearsal stays out of this list.</div>}</section>
    </>}
  </div>;
}

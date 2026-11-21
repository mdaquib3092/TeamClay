import { useState } from "react";
import { useStore } from "../store.jsx";
import { useResource } from "../hooks.jsx";
import { Tabs } from "../components/ui.jsx";

export default function AgentInbox() {
  const notes = useResource("/local-api/voice-notes"), messages = useResource("/local-api/messages");
  const { reqs, setIntakeDraft } = useStore();
  const [tab, setTab] = useState("Voice notes");
  const rows = tab === "Voice notes" ? (notes.data?.notes || []).map(note => ({ ...note, text: note.transcript, kind: "voice" }))
    : (messages.data?.messages || []).map(message => ({ ...message, text: message.user_text, kind: "text" }));
  const importDraft = record => {
    setIntakeDraft({
      text: record.text, sourceName: `WhatsApp ${record.kind} ${record.message_id}`,
      projectId: record.project_id,
      provenance: `Verified staff intake: ${record.name}; role ${record.role}; project ${record.project_id}; message ${record.message_id}; received ${record.received_at}`,
    });
    location.hash = "pm-workflow";
  };
  return <>
    <div className="notice">These are saved messages from the existing staff-only WhatsApp agent. A transcript, AI reply or mentioned case ID is not an approved requirement or HOD decision. Import opens a draft for your explicit review; it does not send a reply.</div>
    <div className="toolbar"><a className="btn primary" href="#live-cases">Test the three RFQ samples</a><button className="btn" onClick={() => { notes.refresh(); messages.refresh(); }}>Refresh agent records</button><a href="http://127.0.0.1:8767" target="_blank" rel="noreferrer">Original agent dashboard</a></div>
    {(notes.error || messages.error) && <p className="err" role="alert">{notes.error || messages.error}</p>}
    <Tabs tabs={[["Voice notes", `Voice notes · ${notes.data?.notes?.length || 0}`], ["Messages", `Conversations · ${messages.data?.messages?.length || 0}`]]} value={tab} onChange={setTab} />
    <div className="stack">{rows.map(record => {
      const source = `WhatsApp ${record.kind} ${record.message_id}`;
      const existing = reqs.find(r => r.sourceName === source);
      return <article className="card" key={record.id}>
        <h2>{record.name} · {record.role}</h2>
        <p className="small muted">{record.project_id} · number ending {record.number_ending} · {new Date(record.received_at).toLocaleString()} · {record.status}</p>
        <div className="raw">{record.text || "No usable transcript yet. Await transcription or ask the sender for clarification."}</div>
        {record.assistant_reply && <details style={{ marginTop: 12 }}><summary>Agent reply (not a business action)</summary><div className="raw">{record.assistant_reply}</div></details>}
        {existing ? <p><a href={`#report/${encodeURIComponent(existing.id)}`}>Already imported into {existing.id}</a></p>
          : <button className="btn" style={{ marginTop: 12 }} disabled={!record.text} onClick={() => importDraft(record)}>Review as requirement draft</button>}
      </article>;
    })}{!rows.length && <div className="card">{notes.loading || messages.loading ? "Loading agent records…" : "No saved records. No historical chats are backfilled."}</div>}</div>
  </>;
}

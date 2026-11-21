import http from "node:http";
import { liveBoard } from "./procurement/board.mjs";
import { runScenario } from "../scripts/rfq-rehearsal.mjs";

export function createServer(intake, port) {
  return http.createServer(async (request, response) => {
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(request.headers.host) ||
        (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)) {
      response.writeHead(403); response.end("Local access only."); return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }); response.end("Read-only service."); return;
    }
    const route = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (route === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(PAGE);
    } else if (route === "/api/procurement/cases" || /^\/api\/procurement\/samples\/(?:cement|steel|waterproofing)$/.test(route)) {
      const send = (code, body) => { response.writeHead(code, {"Content-Type":"application/json"}); response.end(JSON.stringify(body)); };
      if (!intake.workflow) return send(503, {error:"Case workflow is offline."});
      try {
        if (route.includes("/samples/")) {
          const team = ["U01","U03","U05"].map(id => [...intake.users.values()].find(u => u.user_id === id));
          if (team.some(u => !u)) return send(409,{error:"The sample's three staff assignments are unavailable."});
          return send(200, await runScenario({root:intake.workflow.root,sourceDb:intake.workflow.db,team,key:route.split("/").pop()}));
        }
        const board = liveBoard(intake.workflow,intake.users);
        const devices = intake.sessions.prepare("SELECT jid FROM whatsmeow_device LIMIT 2").all();
        const digits = devices.length===1 && /^([1-9]\d{7,14})(?::\d+)?@s\.whatsapp\.net$/.exec(devices[0].jid)?.[1];
        return send(200,{...board,agentNumber:digits || null});
      } catch { return send(503,{error:"Could not read the case data or run the configured sample."}); }
    } else if (["/api/status", "/api/voice-notes", "/api/roles", "/api/messages"].includes(route)) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(route === "/api/status" ? intake.status() :
        route === "/api/roles" ? intake.profiles() :
        route === "/api/messages" ? { messages: intake.chat?.messages() || [] } : { notes: intake.notes() }));
    } else { response.writeHead(404); response.end("Not found."); }
  });
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Vinayak · Voice-note intake</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f6f3;color:#18382b;font:15px system-ui,sans-serif}
main{max-width:1050px;margin:40px auto;padding:0 24px}.label{font-size:12px;letter-spacing:2px;color:#377857;font-weight:700}
h1{font-size:30px;margin:14px 0}p{color:#52695d;line-height:1.7}.card{background:white;border:1px solid #dce8df;border-radius:16px;padding:24px;margin:20px 0}
#status{font-weight:600;color:#256643}.safeguard{font-size:13px}article{border-top:1px solid #e2eae5;padding:20px 0}
article:first-child{border:0}.meta{font-size:12px;color:#52695d}.transcript{white-space:pre-wrap;line-height:1.7}
.state{display:inline-block;padding:5px 9px;border-radius:7px;background:#eef7f1;font-size:12px}.error{color:#885c12}.draft{border-left:3px solid #73a88c;padding-left:16px;white-space:pre-wrap;line-height:1.7}
</style></head><body><main><div class="label">VINAYAK PROCUREMENT · SARVAM VOICE INTAKE</div>
<h1>Your procurement assistant, by role.</h1>
<p>Send WhatsApp text or a voice note to the linked agent number from a staff number configured in users.csv.
Sarvam transcribes voice; DeepSeek answers with your role and project context.</p>
<section class="card"><div id="status" role="status">Checking the local transcription service…</div>
<p id="ai"></p><p id="activity"></p><p class="safeguard">New direct messages from configured staff only. No old chats are uploaded.
Audio is sent to Sarvam; the sender's text/transcript and separate conversation context go to DeepSeek.
Replies are assistance—not an approval or an executed procurement instruction.
<span id="caseMode">Loading case workflow status…</span>
Send /stop to pause your automatic replies and /start to resume.</p></section>
<section class="card"><h2>AI conversations</h2><div id="chats">No new staff conversations received yet.</div></section>
<section class="card"><h2>WhatsApp procurement cases</h2><div id="caseList"></div></section>
<section class="card"><h2>Three staff profiles</h2><div id="roles"></div></section>
<section class="card"><h2>Eight-step procurement workflow</h2><ol id="workflow"></ol>
<p class="safeguard">Project manager coordinates procurement. Accounts verification and authorised signing stay external human gates.
Vendors communicate by email; they are not staff WhatsApp users.</p></section>
<section class="card"><h2>Recent voice notes and response drafts</h2><div id="notes">No voice notes received yet.</div></section>
</main><script>
const statusEl=document.getElementById('status'),ai=document.getElementById('ai'),chats=document.getElementById('chats'),activity=document.getElementById('activity'),notes=document.getElementById('notes'),roles=document.getElementById('roles'),workflow=document.getElementById('workflow');
function text(tag,value,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;}
function voiceReplyStatus(note){if(note.reply_status==='sent')return (note.reply_kind==='voice_failure'?'Re-record request':'Reply')+' accepted by WhatsApp · '+new Date(note.reply_sent_at).toLocaleTimeString();if(note.reply_status==='send_unconfirmed')return 'Reply attempted · WhatsApp acceptance unconfirmed';if(['not_sent','disabled','draft_not_sent','draft_only'].includes(note.reply_status))return 'No WhatsApp reply sent yet';return 'Reply: '+note.reply_status.replaceAll('_',' ');}
async function update(){try{const [s,n,c]=await Promise.all([fetch('/api/status',{cache:'no-store'}).then(r=>r.json()),fetch('/api/voice-notes',{cache:'no-store'}).then(r=>r.json()),fetch('/api/messages',{cache:'no-store'}).then(r=>r.json())]);
statusEl.textContent=s.error?'Intake paused — check the users CSV or bridge database':s.provider+' '+s.model+' · Listening for '+s.registeredStaff+' configured staff users';
const cf=s.caseWorkflow;document.getElementById('caseMode').textContent=cf?.enabled?'Typed case commands enable PM-confirmed RFQ emails, thread-linked comparison and human HOD decisions. Work orders and payments are not issued.':'Case dispatch is off.';
const caseList=document.getElementById('caseList');caseList.replaceChildren();if(cf?.enabled){caseList.append(text('p','From the site engineer’s WhatsApp: '+cf.sample));for(const c of cf.cases)caseList.append(text('p',(c.demo?'DEMO · ':'')+c.id+' · '+c.stage+' · B'+c.boq_rev+' / Q'+c.quote_rev));if(cf.error)caseList.append(text('p',cf.error,'error'));}
ai.textContent=s.chat&&s.chat.enabled?'DeepSeek '+s.chat.requestedVersion+' · '+(s.chat.automaticReplies?'Automatic staff-only replies enabled':'Response-draft mode'):'DeepSeek conversation mode is not enabled.';
activity.textContent='Last scan: '+(s.lastScan?new Date(s.lastScan).toLocaleString():'Starting')+' · '+Object.entries(s.counts).map(([key,value])=>key+': '+value).join(' · ');
chats.replaceChildren();if(!c.messages.length)chats.append(text('p','No new staff conversations received yet.'));
for(const message of c.messages){const card=document.createElement('article');card.append(text('strong',message.name+' · '+message.role));card.append(text('p',message.channel+' · '+message.project_id+' · '+message.status,'meta'));card.append(text('p',message.user_text,'transcript'));if(message.assistant_reply){card.append(text('h3','Assistant'));card.append(text('p',message.assistant_reply,'draft'));}if(message.error_code)card.append(text('p',message.error_code,'error'));chats.append(card);}
notes.replaceChildren();if(!n.notes.length)notes.append(text('p','No new authorised voice notes received yet.'));
for(const note of n.notes){const card=document.createElement('article');card.append(text('strong',note.name+' · '+note.role));card.append(text('p',note.project_id+' · '+new Date(note.received_at).toLocaleString()+' · number ending '+note.number_ending,'meta'));card.append(text('span',note.status,'state'));card.append(text('p',voiceReplyStatus(note),'meta'));if(note.transcript)card.append(text('p',note.transcript,'transcript'));if(note.error_code)card.append(text('p','Needs attention: '+note.error_code,'error'));if(note.assistance){card.append(text('h3','Internal role guidance'));card.append(text('p',note.assistance.response_draft,'draft'));card.append(text('p','Queue: '+note.assistance.work_queue+' · '+note.assistance.case_link_status,'meta'));}notes.append(card);}}
catch{statusEl.textContent='The local voice-intake service is not reachable.';}}
async function loadRoles(){try{const data=await fetch('/api/roles',{cache:'no-store'}).then(r=>r.json());roles.replaceChildren();workflow.replaceChildren();for(const user of data.staff){const card=document.createElement('article');card.append(text('strong',user.name+' · '+user.label));card.append(text('p',user.project_id+' · number ending '+user.number_ending,'meta'));card.append(text('p',user.purpose));roles.append(card);}for(const step of data.workflow){const item=document.createElement('li');item.append(text('strong',step.description));item.append(text('p',step.gate,'meta'));workflow.append(item);}}catch{roles.textContent='Role configuration unavailable.';}}
update();loadRoles();setInterval(update,3000);
</script></body></html>`;

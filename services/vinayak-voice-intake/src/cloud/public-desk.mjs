import {parseTerms, formatMoney} from "../procurement/quote-terms.mjs";
import {fieldRuns,findRun,runCommand,runFields} from "../procurement/field-runs.mjs";
import {runGuides} from "./run-guides.mjs";

const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const steps=["Site message","RFQ drafts","PM approval","Vendor replies","HOD analysis","Final decision"];
const pageHeaders={"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","x-frame-options":"DENY",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const style=`*{box-sizing:border-box}body{margin:0;background:#f4f7f8;color:#172c35;font:16px/1.55 system-ui,sans-serif}main,header{max-width:1050px;margin:auto;padding:22px}header{display:flex;gap:15px;align-items:center;justify-content:space-between}a{color:#075b76}a:focus-visible,button:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #079097;outline-offset:3px}.brand{font-size:20px;text-decoration:none;color:#163d46;font-weight:760}.brand b{background:#0b6570;color:white;border-radius:8px;padding:5px 9px;margin-right:8px}.label{font-size:12px;letter-spacing:.09em;font-weight:750;text-transform:uppercase;color:#11626a}h1,h2,h3{line-height:1.2}h1{font-size:clamp(30px,5vw,48px);margin:12px 0}h2{font-size:23px;margin-top:10px}h3{font-size:17px}.lead{max-width:70ch;color:#425964}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:22px}.card,article{background:#fff;border:1px solid #d6e1e4;border-radius:14px;padding:20px}.card{margin:16px 0}.cards article{display:flex;flex-direction:column}.cards article p{flex:1;margin-top:0}.btn,button{display:inline-block;text-align:center;background:#096571;color:white;text-decoration:none;border:0;border-radius:8px;padding:11px 16px;font:600 15px/1.4 system-ui;cursor:pointer}.quiet{background:white;color:#195965;border:1px solid #bfced0}.nav,.steps{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:18px 0}.steps a{padding:7px 10px;text-decoration:none;color:#35545d;border:1px solid #cfdcdf;background:white;border-radius:7px;font-size:14px}.steps a[aria-current=step]{font-weight:700;color:white;background:#174c55}.pill{display:inline-block;color:#265966;background:#e4eff1;padding:2px 9px;border-radius:20px;font-size:13px;font-weight:650}.msg{border-left:3px solid #52a5a3;background:#f2f8f8;padding:10px 14px;margin:14px 0}.msg p{font-size:14px;margin:0 0 5px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}details{margin:12px 0}summary{cursor:pointer;font-weight:650}label{display:block;font-weight:600;margin:14px 0 6px}textarea,select,input{max-width:100%;width:100%;border:1px solid #9fb5b9;border-radius:7px;background:white;padding:9px;font:inherit}textarea{min-height:105px}table{width:100%;border-collapse:collapse}td,th{padding:9px;text-align:left;border-bottom:1px solid #dbe3e5;vertical-align:top}.scroll{overflow:auto}.muted,footer{color:#536971;font-size:14px}footer{border-top:1px solid #d2dfe1;margin-top:28px;padding-top:16px}@media(max-width:740px){.cards{grid-template-columns:1fr}.steps{gap:5px}main,header{padding:15px}.card,article{padding:14px}}`;
function html(req,title,content,status=200,footer="Sample cases use fictional suppliers and simulated deliveries. Live activity shows aggregate counts from the working procurement system."){
  return new Response(req.method==="HEAD"?null:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Procurement from site intake to a HOD decision."><title>${esc(title)} · Clay</title><style>${style}</style></head><body><header><a class="brand" href="/"><b>C</b> Clay Procurement</a><a href="/activity">Live activity</a></header><main>${content}<footer>${esc(footer)}</footer></main></body></html>`,{status,headers:pageHeaders});
}
const href=(s,step)=>`/demo/${s.key}/${step}`;
function messages(items){return items.map(m=>`<div class="msg"><p><strong>${esc(m.from)}</strong> → ${esc(m.to)}</p><pre>${esc(m.text)}</pre></div>`).join("");}
const next=(s,n,label)=>`<a class="btn" href="${href(s,n)}">${esc(label)} →</a>`;
function landing(req,samples){return html(req,"Public procurement dashboard",`<span class="label">Public workspace</span><h1>Procurement dashboard</h1><p class="lead">Start a steel or waterproofing run using WhatsApp and Gmail, or try one of the interactive cases below.</p><div class="nav"><a class="btn" href="/runs">Open the two live run guides →</a><a class="btn quiet" href="/activity">View live workflow status →</a></div><div class="cards">${samples.map(s=>`<article><span class="label">${esc(s.label)}</span><h2>${esc(s.title)}</h2><p>${s.lines.map(l=>`${esc(l.qty)} ${esc(l.unit)} to quote for ${esc(l.name)}`).join("<br>")}</p>${next(s,1,`Try ${s.label.toLowerCase()}`)}</article>`).join("")}</div>`);}
function runGuide(r){
  const g=runGuides[r.key],lines=r.lines.map(l=>({...l,qty:l.requested-l.referenceStock}));
  return `<section class="card"><span class="label">Workflow run</span><h2>${esc(r.label)} · ${esc(r.site)}</h2>
    <h3>1. Site engineer → WhatsApp agent</h3><p>From the registered site engineer’s chat, send the following once. Save the returned CASE ID.</p><pre>${esc(runCommand(r)+" | "+runFields(r).join(" | "))}</pre>
    <p>${lines.map(l=>`${l.code} · ${esc(l.name)}: ${l.requested} requested − ${l.referenceStock} reference stock = <b>${l.qty} ${l.unit} to quote</b>`).join("<br>")}. The issued BOQ uses current stock.</p>
    <h3>2. Agent → PM → vendors</h3><p>The PM opens the private WhatsApp review link, checks BOQ B1, both inboxes and the individual drafts, then presses <b>Approve &amp; send</b>. Gmail acceptance is reported in the PM chat.</p>
    <h3>3. Each vendor → procurement Gmail</h3><p>In each invited inbox, reply to its own new RFQ. Paste the terms above the original email, then sign with the company name on that RFQ.</p>
    ${g.replies.map((s,i)=>`<div class="msg"><strong>${r.vendors[i]}</strong><pre>${esc(s)}</pre></div>`).join("")}
    <h3>4. Agent → HOD</h3><p>After both comparable replies, the HOD receives a private WhatsApp link with the two original replies and the comparison. Expected with the quantities and terms above: ${g.replies.map((s,i)=>`<b>${r.vendors[i]} ${formatMoney(parseTerms(s,lines).landed)}</b>`).join(" · ")}. GST applies to goods plus freight.</p><p>${esc(g.reason)}</p>
    <h3>5. PM recommendation → HOD decision</h3><p>After reviewing the actual offers, replace CASE-ID and Qn with the values in the latest WhatsApp report. The HOD can send a review note from the link, or decide on the PM’s recommendation by text.</p><pre>${esc(`RECOMMEND CASE-ID Qn ${g.pick} | ${g.reason}\nAPPROVE CASE-ID Qn ${g.pick} | Reviewed the BOQ, price and delivery.\nRETURN CASE-ID Qn | Please clarify the delivery commitment.`)}</pre><p>The HOD sends either APPROVE or RETURN. The PM and site engineer receive the recorded outcome.</p></section>`;
}
export function activityPage(req,data){
  const fields=[["cases","Cases opened"],["pending","Awaiting PM dispatch approval"],["emails","RFQs accepted by Gmail"],["replies","Vendor threads with replies"],["reports","HOD comparisons accepted by WhatsApp"]];
  const ok=fields.every(([k])=>Number.isSafeInteger(data?.[k])&&data[k]>=0);
  return html(req,"Live workflow status",`<a href="/">← Dashboard</a><p class="label">Live activity · aggregate totals</p><h1>Live workflow status</h1>${ok?`<p>Counts from the case database as of ${esc(data.at)}.</p><div class="cards">${fields.map(([k,label])=>`<article><span class="label">${label}</span><h2>${data[k]}</h2></article>`).join("")}</div>`:`<p>Live counts are temporarily unavailable. The <a href="/">interactive samples</a> are still available.</p>`}<p><a class="btn quiet" href="/activity">Refresh status</a></p>`);
}
async function formData(req){
  if(req.headers.get("content-type")?.split(";")[0]!=="application/x-www-form-urlencoded")throw Error("Use the sample form.");
  let size=0;const parts=[];const reader=req.body?.getReader();if(!reader)throw Error("No sample submitted.");
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000){await reader.cancel();throw Error("Sample too large.");}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let off=0;for(const p of parts){bytes.set(p,off);off+=p.length;}
  return new URLSearchParams(new TextDecoder().decode(bytes));
}
function repliesForm(s,replies){return `<form method="post" action="${href(s,5)}"><p>Each supplier replies in its own RFQ email thread. Edit the fictional replies below to try different commercial terms. Leave the field labels in place.</p>${s.vendors.map((v,i)=>`<label for="reply${i}">${esc(v.id)} · ${esc(v.name)}</label><textarea id="reply${i}" name="reply${i}" rows="4" maxlength="2500" required>${esc(replies[i])}</textarea>`).join("")}<p><button type="submit">Compare vendor replies →</button></p></form>`;}
function comparison(s,replies){
  const rows=s.vendors.map((v,i)=>({...v,t:parseTerms(replies[i],s.lines)}));
  const ranked=rows.filter(v=>v.t.landed!==null).sort((a,b)=>a.t.landed-b.t.landed);
  const summary=ranked.length<2?"Waiting for two comparable replies. Correct the flagged fields to make a recommendation.":
    ranked[0].t.landed===ranked[1].t.landed?"The landed prices are equal. Review delivery and payment terms before selecting a vendor.":
    `${ranked[0].name} is ${formatMoney(ranked[1].t.landed-ranked[0].t.landed)} lower on landed price. Review delivery and payment terms alongside price.`;
  const table=`<div class="scroll"><table><caption>Same BOQ · INR · GST applied to goods plus freight</caption><thead><tr><th>Vendor</th><th>Rates / freight</th><th>GST</th><th>Landed total</th><th>Terms</th></tr></thead><tbody>${rows.map(v=>`<tr><th>${esc(v.name)}</th><td>${s.lines.map(l=>`${esc(l.code)} ${v.t.rates[l.code]===undefined?"unknown":formatMoney(v.t.rates[l.code])+"/"+esc(l.unit)}`).join("<br>")}<br>Freight: ${v.t.freight===null?"unknown":formatMoney(v.t.freight)}</td><td>${v.t.gst===null?"unknown":v.t.gst+"%"}</td><td><b>${v.t.landed===null?"Not comparable":formatMoney(v.t.landed)}</b></td><td>${v.t.days===null?"Unknown lead time":v.t.days+" days"} · ${esc(v.t.payment)||"Payment unknown"}<br>Exclusions: ${esc(v.t.exclusions)||"unknown"}${v.t.flags.length?"<br>Clarify: "+esc(v.t.flags.join(", ")):""}</td></tr>`).join("")}</tbody></table></div>`;
  return {ranked,summary,table};
}
function stepContent(s,n,form){
  const replies=s.replies.map((v,i)=>form?.get("reply"+i)??v);
  if(replies.some(v=>v.length>2500))throw Error("Keep each vendor reply below 2,500 characters.");
  if(n===4)return repliesForm(s,replies);
  if(n<4)return messages(s.steps[n-1].items)+next(s,n+1,["Review the RFQ drafts","See the PM confirmation","Simulate dispatch and view replies"][n-1]);
  const {ranked,summary,table}=comparison(s,replies);
  if(n===5){
    const original=replies.every((v,i)=>v===s.replies[i]);
    const keep=replies.map((v,i)=>`<input type="hidden" name="reply${i}" value="${esc(v)}">`).join("");
    const report=original?`<details><summary>Read the sample HOD WhatsApp message</summary>${messages(s.steps[4].items)}</details>`:"";
    return `${table}<p><b>${esc(summary)}</b></p>${report}${ranked.length<2?repliesForm(s,replies):`<form method="post" action="${href(s,6)}">${keep}<label for="vendor">PM’s recommended vendor</label><select id="vendor" name="vendor">${ranked.map(v=>`<option value="${esc(v.id)}"${v.id===(original?s.pick:ranked[0].id)?" selected":""}>${esc(v.id)} · ${esc(v.name)}</option>`).join("")}</select><label for="decision">HOD decision</label><select name="decision" id="decision"><option value="approve">Approve reviewed vendor and rates</option><option value="return">Return for changes</option></select><label for="reason">Reason</label><input id="reason" name="reason" maxlength="400" required value="${esc(original?s.reason:"Reviewed the revised rates and delivery terms.")}"><p><button>Record sample decision →</button></p></form>`}`;
  }
  if(!form)return messages(s.steps[5].items)+`<p><a href="${href(s,5)}">Try your own decision</a></p>`;
  const selected=ranked.find(v=>v.id===form.get("vendor")),decision=form.get("decision"),reason=form.get("reason")?.trim()||"";
  if(ranked.length<2||!selected||!["approve","return"].includes(decision)||!reason||reason.length>400)throw Error("Review the comparison and select a vendor and decision.");
  return `<span class="pill">Simulation complete</span><h2>${decision==="approve"?"HOD approved the sample":"HOD returned the sample for changes"}</h2><p>${esc(selected.name)} · reviewed landed total <b>${formatMoney(selected.t.landed)}</b></p><p>${esc(reason)}</p>${table}<p><a class="btn" href="/">Try another sample</a></p>`;
}
export async function publicDesk(req,url,samples){
  const p=url.pathname;
  if(p==="/runs"||p.startsWith("/runs/")){
    const segments=/^\/runs(?:\/(steel|waterproofing))?\/?$/.exec(p);
    if(!segments)return html(req,"Run not found","<h1>Run not found</h1>",404);
    if(!["GET","HEAD"].includes(req.method))return html(req,"Method not allowed","<h1>Open the guide to read the instructions.</h1>",405);
    const selected=segments[1]?[findRun(segments[1])]:fieldRuns;
    return html(req,"WhatsApp and Gmail run guides",`<a href="/">← Dashboard</a><h1>WhatsApp and Gmail run guides</h1><p>Opening this page does not create a case. The site engineer starts each run in WhatsApp.</p><nav class="nav">${fieldRuns.map(r=>`<a href="/runs/${r.key}">${r.label}</a>`).join(" · ")}</nav>${selected.map(runGuide).join("")}`,200,"Run references only. Actual case records and supplier replies are available to the assigned staff.");
  }
  if(p==="/"||p==="/demo"||p==="/demo/")return ["GET","HEAD"].includes(req.method)?landing(req,samples):html(req,"Method not allowed","<h1>Use the walkthrough links</h1>",405);
  if(!p.startsWith("/demo/"))return null;
  const m=/^\/demo\/(cement|steel|waterproofing)\/([1-6])\/?$/.exec(p);
  const s=m&&samples.find(x=>x.key===m[1]);if(!s)return html(req,"Unknown sample",'<h1>Sample not found</h1><a href="/">All samples</a>',404);
  const n=Number(m[2]);
  if(!["GET","HEAD"].includes(req.method)&&!(req.method==="POST"&&[5,6].includes(n)))return html(req,"Method not allowed","<h1>Use the sample form</h1>",405);
  try{
    const content=stepContent(s,n,req.method==="POST"?await formData(req):null);
    return html(req,`${s.label} · ${steps[n-1]}`,`<a href="/">← All samples</a><p class="label">${esc(s.label)} · sample case</p><h1>${esc(s.title)}</h1><nav class="steps" aria-label="Case stages">${steps.map((name,i)=>`<a ${i+1===n?'aria-current="step" ': ""}href="${href(s,i+1)}">${i+1}. ${name}</a>`).join("")}</nav><section class="card"><span class="label">Step ${n} of 6</span><h2>${steps[n-1]}</h2>${content}</section>`);
  }catch(e){return html(req,"Check the sample",`<h1>Check the sample</h1><p>${esc(e.message)}</p><a href="${href(s,4)}">Edit vendor replies</a>`,400);}
}

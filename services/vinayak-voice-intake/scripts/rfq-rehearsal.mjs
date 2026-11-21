import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { CaseFlow } from "../src/procurement/flow.mjs";
import { caseDetails } from "../src/procurement/board.mjs";
import { samples } from "../src/procurement/samples.mjs";

export const sampleQuotes = samples[0].replies;
// Uses the real schema/template only. All individual identities, messages and
// transactions below are fixtures in an isolated directory and in-memory DB.
export function rehearsal(config = {}) {
  const master = config.root || process.env.TEAMCLAY_ROOT || path.join(os.homedir(), "Downloads/TeamClay");
  const root = config.root || fs.mkdtempSync(path.join(os.tmpdir(), "rfq-rehearsal-"));
  if (!config.root) {
    fs.mkdirSync(path.join(root,"data")); fs.mkdirSync(path.join(root,"templates"));
    fs.copyFileSync(path.join(master,"templates/rfq_email.txt"),path.join(root,"templates/rfq_email.txt"));
    fs.writeFileSync(path.join(root,"data/vendors.csv"),"vendor_id,vendor_name,category,email\nV05,Demo Cement A,cement,a@example.test\nV06,Demo Cement B,cement,b@example.test\nV01,Demo Steel A,steel,a@example.test\nV02,Demo Steel B,steel,c@example.test\nV10,Demo Waterproof A,waterproofing,d@example.test\nV16,Demo Waterproof B,waterproofing,b@example.test\n");
    fs.writeFileSync(path.join(root,"data/vendor_performance.csv"),"vendor_id,total_orders,on_time_delivery_pct,avg_quality_rating,avg_reply_hours,reply_rate_pct,last_updated\nV05,10,90,4.4,1.5,100,2026-11-21\nV06,6,83,3,4.3,100,2026-11-21\n");
  }
  const db = new DatabaseSync(":memory:"); db.exec(fs.readFileSync(path.join(master,"db/schema.sql"),"utf8"));
  const team = config.team || [["S","site_engineer","P"],["P","project_manager","P"],["H","hod","ALL"]].map(([id,role,project])=>({user_id:id,name:`Test ${id}`,role,project_id:project,whatsapp:`+1202555010${id==="S"?"1":id==="P"?"2":"3"}`}));
  const users = new Map(team.map(u=>[u.whatsapp.slice(1),u]));
  const p = team[0].project_id, source=config.sourceDb;
  const project=source ? source.prepare("SELECT project_name,address FROM projects WHERE project_id=?").get(p) : {project_name:"Demo Amara",address:"Test Road"};
  db.prepare("INSERT INTO projects VALUES (?,?,?)").run(p,project.project_name,project.address);
  for (const [code,name,segment,unit,spec,stock] of [
    ["MAT010","PPC cement","cement","bag","IS 1489, 50 kg bag",0],["MAT004","16mm TMT","steel","mt","IS 1786 Fe500D",0],
    ["MAT006","25mm TMT","steel","mt","IS 1786 Fe500D",0],["MAT020","Waterproof coating","waterproofing","pack","Two-component pack",12],
  ]) {
    const m=source ? source.prepare("SELECT material_name,category,unit,specification FROM materials WHERE material_code=?").get(code) : {material_name:name,category:segment,unit,specification:spec};
    const s=source ? source.prepare("SELECT qty_available,unit,last_updated FROM stock WHERE project_id=? AND material_code=?").get(p,code) : {qty_available:stock,unit,last_updated:"sample snapshot"};
    if(m)db.prepare("INSERT INTO materials VALUES (?,?,?,?,?)").run(code,m.material_name,m.category,m.unit,m.specification);
    if(m&&s)db.prepare("INSERT INTO stock VALUES (?,?,?,?,?)").run(p,code,s.qty_available,s.unit,s.last_updated);
  }
  for(const u of team)db.prepare("INSERT INTO users(user_id,name,role,project_id,whatsapp) VALUES(?,?,?,?,?)").run(u.user_id,u.name,u.role,u.project_id,u.whatsapp);
  for(const v of ["V05","V06"])db.prepare("INSERT INTO vendors(vendor_id) VALUES(?)").run(v);
  const emails=[], alerts=[], inbox=new Map();
  const mailbox = { async send(msg){emails.push(msg);return {sent:true,messageId:`sent-${emails.length}`,threadId:`thread-${emails.length}`};},
    async replies(inv,seen){return (inbox.get(inv.thread_id)||[]).filter(x=>!seen.has(x.id));} };
  const flow = new CaseFlow({root,db,mailbox,sendStaff:async(u,text)=>{alerts.push({role:u.role,text});return {accepted:true};}});
  let seq=0;
  const command=(u,text,channel="text",source=`${config.key || "cement"}:source-${++seq}`)=>flow.handle({id:source,message_id:source,channel,user_text:text},u,users);
  const flush=async()=>{for(let i=0;i<30&&flow.one("SELECT 1 FROM wa_flow_outbox WHERE state='queued'");i++)await flow.deliver(users);};
  return {db,flow,users,site:team[0],pm:team[1],hod:team[2],mailbox,emails,alerts,inbox,command,flush,
    close(){db.close();if(!config.root)fs.rmSync(root,{recursive:true,force:true});}};
}
export async function runScenario(config = {}) {
  const sample=samples.find(s=>s.key===(config.key||"cement"));
  if(!sample)throw new Error("Unknown sample");
  const f=rehearsal(config);
  try{
    const first=await f.command(f.site,sample.starter), id=first.match(/CASE-[A-F0-9]+/)?.[0]; await f.flush();
    if(!id || f.flow.get(id).stage!=="BOQ_REVIEW")throw new Error("No RFQ shortfall in the current sample");
    const confirmation=`SEND ${id} B1 ${sample.vendors.join(" ")}`, review=f.alerts.find(a=>a.role==="project_manager")?.text;
    const dispatch=await f.command(f.pm,confirmation); await f.flush();
    for(let i=0;i<sample.replies.length;i++){
      f.inbox.set(`thread-${i+1}`,[{id:`answer-${i}`,threadId:`thread-${i+1}`,received:Date.now(),text:sample.replies[i]}]);
    }
    // Exercise the automatic worker polling path, not a human import action.
    for(let i=0;i<sample.replies.length;i++)await f.flow.tick(f.users);
    await f.flush();
    const snapshot=JSON.parse(f.flow.comparison(f.flow.get(id)));
    const report=f.alerts.find(a=>a.role==="hod"&&a.text.includes("For information."))?.text;
    if(!report)throw new Error("No automatic HOD analysis");
    const recommend=`RECOMMEND ${id} Q2 ${sample.pick} | ${sample.reason}`;
    const pm=await f.command(f.pm,recommend);
    await f.flush();
    const approve=`APPROVE ${id} Q2 ${sample.pick} | Reviewed the rates and terms for this sample.`;
    const hod=await f.command(f.hod,approve);await f.flush();
    if(f.flow.get(id).stage!=="APPROVED"||f.emails.length!==2||!f.alerts.some(a=>a.role==="hod"&&a.text.includes("APPROVE ")))throw new Error("Scenario did not reach the HOD decision");
    return {transport:"SIMULATED — no external sends",case:id,site:first,dispatch,emails:f.emails.map(x=>x.to),
      comparison:snapshot.map(x=>({vendor:x.id,landedINR:x.terms.landed/100})),pm,hod,stage:f.flow.get(id).stage,
      record:caseDetails(f.flow,f.flow.get(id)),sampleQuotes:sample.replies,
      steps:[
        {label:"Site message",items:[{from:f.site.name,to:"WhatsApp agent",text:sample.starter},{from:"Agent",to:f.site.name,text:first}]},
        {label:"RFQ drafts",items:[{from:"Agent",to:f.pm.name,text:review},...f.emails.map(e=>({from:"Generated draft",to:e.to,text:`Subject: ${e.subject}\n\n${e.text}`}))]},
        {label:"PM confirms & sends",items:[{from:f.pm.name,to:"WhatsApp agent",text:confirmation},{from:"Agent",to:f.pm.name,text:dispatch},...f.emails.map(e=>({from:"Gmail (simulated)",to:e.to,text:e.subject}))]},
        {label:"Vendor replies",items:f.emails.map((e,i)=>({from:`${sample.vendors[i]} · ${e.to}`,to:"Reply in its own Gmail thread",text:sample.replies[i]}))},
        {label:"HOD analysis",items:[{from:"Agent · automatic WhatsApp report",to:f.hod.name,text:report}]},
        {label:"Human decision",items:[{from:f.pm.name,to:"WhatsApp agent",text:recommend},{from:"Agent",to:f.hod.name,text:f.alerts.find(a=>a.role==="hod"&&a.text.includes("APPROVE "))?.text},
          {from:f.hod.name,to:"WhatsApp agent",text:approve},{from:"Agent",to:f.hod.name,text:hod}]},
      ]};
  }finally{f.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runScenario(),null,2));

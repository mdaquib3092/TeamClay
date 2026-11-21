import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {timingSafeEqual} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {CaseFlow} from "../procurement/flow.mjs";
import {CaseInputError} from "../procurement/boq.mjs";
import {VendorDataError} from "../procurement/vendor-data.mjs";
import {loadUsers} from "../config.mjs";
import {PmApproval,DeskError} from "./pm-approval.mjs";

process.umask(0o077);
const root=process.env.TEAMCLAY_ROOT||path.join(os.homedir(),"Downloads/TeamClay"),local="http://127.0.0.1:5174";
const secret=fs.readFileSync(path.join(os.homedir(),"Library/Application Support/TeamClay/Cloudflare/origin.key"),"utf8").trim();
const flow=new CaseFlow({root,recoverOutbox:false});
const chat=new DatabaseSync(path.join(root,"data/voice_notes/voice-notes.sqlite"),{readOnly:true});
const pm=new PmApproval(flow,{users:()=>loadUsers(path.join(root,"data/users.csv")),secret,
  paused:id=>!!chat.prepare("SELECT paused FROM chat_preferences WHERE user_id=?").get(id)?.paused});
const deskRead=/^\/(?:api\/(?:integration|workspace|source|sources|capabilities|export)|local-api\/(?:catalog|status|roles|messages|voice-notes|procurement\/(?:cases|samples\/(?:cement|steel|waterproofing))))$/;
const deskWrite=/^\/api\/(?:integration|actions|extract)$/;
const json=(res,status,data,headers={})=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",...headers});res.end(JSON.stringify(data));};
const same=(a,b)=>typeof a==="string"&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const collect=async(req,limit)=>{const chunks=[];let bytes=0;for await(const v of req){bytes+=v.length;if(bytes>limit)throw new DeskError(413,"Request is too large.");chunks.push(v);}return Buffer.concat(chunks);};
const cookie=(name,s)=>String(s||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="))?.slice(name.length+1)||"";
const pmCookie=(name,value,id,sec)=>`__Secure-clay-${name}=${value}; Path=/pm/${id}/; Max-Age=${sec}; Secure; HttpOnly; SameSite=Strict`;
let ownerSession;
async function authorisedLocalWorkspace(){
  // Only used after the edge has verified the single owner's Access identity.
  if(!ownerSession){const r=await fetch(local+"/signin-with-chatgpt?return_to=/",{redirect:"manual",signal:AbortSignal.timeout(4000)});
    if(r.status!==302)throw Error("Workspace session unavailable");
    const c=r.headers.getSetCookie().map(x=>x.split(";")[0]).find(x=>x.startsWith("__sites_local_auth="));
    if(!c)throw Error("Workspace session unavailable");ownerSession=c;}
  return ownerSession;
}
const server=http.createServer(async(req,res)=>{
  try{
    if(!same(req.headers["x-clay-origin"],secret))return json(res,403,{error:"Private origin."});
    const url=new URL(req.url,"http://127.0.0.1:8791"),route=url.pathname;
    if(route==="/public-progress"&&req.method==="GET"){
      const counts=flow.one(`SELECT
        (SELECT COUNT(*) FROM wa_flow_cases) cases,
        (SELECT COUNT(*) FROM wa_flow_cases WHERE stage='BOQ_REVIEW') pending,
        (SELECT COUNT(*) FROM wa_flow_mail WHERE gmail_id IS NOT NULL) emails,
        (SELECT COUNT(*) FROM (SELECT DISTINCT case_id,vendor_id FROM wa_flow_replies)) replies,
        (SELECT COUNT(*) FROM wa_flow_outbox WHERE role='hod' AND kind='whatsapp' AND state='accepted' AND id LIKE '%:quote:%:hod') reports`);
      return json(res,200,{...counts,at:new Date().toISOString()});
    }
    if(route==="/healthz"&&req.method==="GET"){
      const [b,a,d]=await Promise.all([fetch("http://127.0.0.1:8766/status").then(r=>r.json()),fetch("http://127.0.0.1:8767/api/status").then(r=>r.json()),
        fetch(local+"/api/integration",{headers:{cookie:await authorisedLocalWorkspace()},signal:AbortSignal.timeout(6500)})]);
      await d.body?.cancel();const ok=b.phase==="connected"&&a.caseWorkflow?.enabled===true&&d.ok;return json(res,ok?200:503,{ready:ok});
    }
    const m=/^\/pm\/(CASE-[A-F0-9]{12})\/(open|review|approve)$/.exec(route);
    if(m){
      const [,id,op]=m,s=cookie("__Secure-clay-session",req.headers.cookie);
      if(op==="review"&&req.method==="GET")return json(res,200,pm.view(id,s));
      if(req.method!=="POST"||req.headers["content-type"]?.split(";")[0]!=="application/json")return json(res,405,{error:"Use the approval form."});
      let data;try{data=JSON.parse(await collect(req,4200));}catch{return json(res,400,{error:"Invalid request."});}
      if(op==="open"){const t=pm.exchange(id,data?.link);return json(res,200,{opened:true},{"Set-Cookie":pmCookie("session",t,id,3600)});}
      if(op==="approve")return json(res,200,pm.approve(id,s,data));
      return json(res,405,{error:"Not supported."});
    }
    if(!((req.method==="GET"&&deskRead.test(route))||(req.method==="POST"&&deskWrite.test(route))))return json(res,404,{error:"Unknown workspace route."});
    const headers=new Headers({cookie:await authorisedLocalWorkspace(),origin:local});
    if(req.headers["content-type"])headers.set("content-type",req.headers["content-type"]);
    const reply=await fetch(local+route+url.search,{method:req.method,headers,redirect:"manual",
      body:req.method==="POST"?await collect(req,20*1024*1024):undefined,signal:AbortSignal.timeout(60000)});
    const out={"Cache-Control":"no-store","Content-Type":reply.headers.get("content-type")||"application/octet-stream"};
    if(reply.headers.has("content-disposition"))out["Content-Disposition"]=reply.headers.get("content-disposition");
    if(reply.status===401)ownerSession=null;
    res.writeHead(reply.status,out);for await(const next of reply.body||[])res.write(next);res.end();
  }catch(e){if(res.headersSent){res.destroy();return;}const known=e instanceof DeskError||e instanceof CaseInputError||e instanceof VendorDataError;
    json(res,known?(e.status||409):503,{error:known?e.message:"The local procurement service is temporarily unavailable."});}
});
server.listen(8791,"127.0.0.1");

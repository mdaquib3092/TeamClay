import {createHash,createHmac,randomBytes} from "node:crypto";
import {DeskError} from "./pm-approval.mjs";
import {authoredReply} from "../procurement/quote-terms.mjs";
import {comparable} from "../procurement/quote-evidence.mjs";

const hour=3600000, token=()=>randomBytes(32).toString("hex");
const digest=s=>createHash("sha256").update(s).digest("hex");
const fail=(ok,status,reason)=>{if(!ok)throw new DeskError(status,reason);};
const denied="Open the latest comparison link in the assigned HOD’s WhatsApp.";

export class HodAnalysis {
  constructor(flow,{users,secret,paused=()=>false}){
    Object.assign(this,{flow,users,secret,paused});
    flow.db.exec(`CREATE TABLE IF NOT EXISTS wa_hod_analysis_links(
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, actor TEXT NOT NULL, identity TEXT NOT NULL, boq_rev INTEGER NOT NULL,
      quote_rev INTEGER NOT NULL, snapshot TEXT NOT NULL, expires INTEGER NOT NULL, session TEXT UNIQUE, session_until INTEGER);
      CREATE TABLE IF NOT EXISTS wa_hod_analysis_notes(
      case_id TEXT NOT NULL, quote_rev INTEGER NOT NULL, actor TEXT NOT NULL, request TEXT NOT NULL, vendor TEXT, note TEXT NOT NULL,
      created TEXT NOT NULL, PRIMARY KEY(case_id,quote_rev,actor,request));`);
  }
  actor(c){
    const u=[...this.users().values()].find(u=>c&&u.user_id===c.hod_id&&u.role==="hod"&&[c.project_id,"ALL"].includes(u.project_id));
    fail(u&&!this.paused(u.user_id),403,denied);return u;
  }
  identity(u){return createHmac("sha256",this.secret).update(JSON.stringify(["hod-analysis",u.user_id,u.whatsapp,u.project_id])).digest("hex");}
  issue(id,q,recipient){
    return this.flow.tx(()=>{
      const c=this.flow.get(id),u=this.actor(c),snap=this.flow.comparison(c);
      fail(recipient.user_id===u.user_id&&recipient.role==="hod"&&recipient.whatsapp===u.whatsapp&&recipient.project_id===u.project_id,403,denied);
      fail(snap&&c.quote_rev===q,409,"Comparison superseded.");
      const t=token(),now=Date.now();this.flow.run("DELETE FROM wa_hod_analysis_links WHERE expires<?",now);
      this.flow.run("INSERT INTO wa_hod_analysis_links(id,case_id,actor,identity,boq_rev,quote_rev,snapshot,expires) VALUES(?,?,?,?,?,?,?,?)",
        digest(t),id,u.user_id,this.identity(u),c.boq_rev,q,digest(snap),now+24*hour);return t;
    });
  }
  verify(id,t,kind){
    fail(typeof t==="string"&&/^[a-f0-9]{64}$/.test(t),401,denied);
    const c=this.flow.get(id),u=this.actor(c),snap=this.flow.comparison(c);
    const g=this.flow.one(`SELECT * FROM wa_hod_analysis_links WHERE ${kind==="link"?"id":"session"}=? AND case_id=?`,digest(t),id);
    fail(g&&g.expires>Date.now()&&g.actor===u.user_id&&g.identity===this.identity(u)&&
      (kind==="link"?!g.session:g.session_until>Date.now()),401,denied);
    fail(snap&&g.quote_rev===c.quote_rev&&g.boq_rev===c.boq_rev&&g.snapshot===digest(snap),409,"A newer comparison is available. Open the latest HOD WhatsApp report.");
    return {c,u,g,snap};
  }
  exchange(id,t){
    return this.flow.tx(()=>{
      const {g}=this.verify(id,t,"link"),s=token();
      this.flow.run("UPDATE wa_hod_analysis_links SET session=?,session_until=? WHERE id=?",digest(s),Date.now()+hour,g.id);
      return s;
    });
  }
  view(id,s){
    const {c,snap}=this.verify(id,s,"session"),rows=JSON.parse(snap);
    return {id,boq:c.boq_rev,q:c.quote_rev,stage:c.stage,project:c.scope.project,site:c.scope.site,neededBy:c.scope.needBy,
      lines:c.scope.lines.filter(l=>l.qty>0).map(({code,name,spec,qty,unit})=>({code,name,spec,qty,unit})),
      analysis:this.flow.analysis(c,rows),vendors:rows.map(v=>{
        const source=v.source&&this.flow.one("SELECT received,body FROM wa_flow_replies WHERE case_id=? AND vendor_id=? AND gmail_id=?",id,v.id,v.source);
        return {id:v.id,name:v.name,terms:v.terms,history:v.history,issues:v.sourceFlags||[],signature:v.signature||null,
          comparable:comparable(v),received:source?.received||null,reply:source?authoredReply(source.body).slice(0,8000):null};
      }),notes:this.flow.all("SELECT vendor,note,created FROM wa_hod_analysis_notes WHERE case_id=? AND quote_rev=? ORDER BY rowid DESC LIMIT 30",id,c.quote_rev)};
  }
  note(id,s,input){
    return this.flow.tx(()=>{
      const {c,u,snap}=this.verify(id,s,"session"),note=typeof input?.note==="string"?input.note.trim():"",vendor=input?.vendor;
      fail(input?.revision===c.quote_rev,409,"Review the latest comparison before adding a note.");
      fail(typeof note==="string"&&note.length>=2&&note.length<=500&&typeof input.request==="string"&&/^[a-f0-9-]{36}$/.test(input.request)&&
        (vendor==="all"||JSON.parse(snap).some(v=>v.id===vendor)),400,"Choose a vendor or both, and enter a review note (2–500 characters).");
      const created=new Date().toISOString();
      const saved=this.flow.run("INSERT OR IGNORE INTO wa_hod_analysis_notes VALUES(?,?,?,?,?,?,?)",id,c.quote_rev,u.user_id,input.request,vendor,note,created);
      if(saved.changes){
        this.flow.event(c,"web","inbound",u.user_id,"agent",{action:"hod_analysis_note",quoteRevision:c.quote_rev,vendor,note},"recorded");
        this.flow.notify(c,`hod-note:${c.quote_rev}:${input.request}`,"project_manager",`HOD review note on Q${c.quote_rev} (${vendor==="all"?"both / all invited vendors":vendor}): ${note}\nThis is a review note, not a vendor approval.`,c.quote_rev);
      }else{
        const prior=this.flow.one("SELECT vendor,note FROM wa_hod_analysis_notes WHERE case_id=? AND quote_rev=? AND actor=? AND request=?",id,c.quote_rev,u.user_id,input.request);
        fail(prior?.vendor===vendor&&prior.note===note,409,"This note was already submitted. Refresh before sending a different note.");
      }
      return {saved:true};
    });
  }
}

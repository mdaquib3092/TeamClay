import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from "node:crypto";
import {renderRfq,scopeSummary} from "../procurement/boq.mjs";
const digest=v=>createHash("sha256").update(v).digest("hex");
const key=()=>randomBytes(32).toString("hex");
const ms=60000;
export class DeskError extends Error {constructor(status,message){super(message);this.status=status;}}
const requireValue=(ok,status,message)=>{if(!ok)throw new DeskError(status,message);};
export class PmApproval {
  constructor(flow,{users,secret,sendCode,paused=()=>false}) {
    Object.assign(this,{flow,users,secret,sendCode,paused});
    flow.db.exec(`CREATE TABLE IF NOT EXISTS wa_pm_web_auth (
      id TEXT PRIMARY KEY,case_id TEXT NOT NULL, actor TEXT NOT NULL, identity TEXT NOT NULL,
      created INTEGER NOT NULL, expires INTEGER NOT NULL, otp TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      session TEXT UNIQUE, reviewed TEXT, consumed INTEGER);
      CREATE INDEX IF NOT EXISTS wa_pm_web_recent ON wa_pm_web_auth(actor,created);`);
  }
  actor(c) {
    const who=[...this.users().values()].find(u=>u.role==="project_manager"&&u.user_id===c?.pm_id&&u.project_id===c.project_id);
    requireValue(who&&!this.paused(who.user_id),403,"Use the assigned PM’s registered WhatsApp number.");return who;
  }
  signature(v){return createHmac("sha256",this.secret).update(v).digest("hex");}
  async challenge(id,phone) {
    const c=this.flow.get(id),u=this.actor(c);
    let digits=String(phone||"").replace(/[\s()+-]/g,"");if(/^\d{10}$/.test(digits)&&u.whatsapp.startsWith("+91"))digits="91"+digits;
    requireValue(digits===u.whatsapp.slice(1),403,"Use the assigned PM’s registered WhatsApp number.");
    requireValue(c.stage==="BOQ_REVIEW",409,"This case is no longer awaiting PM dispatch.");
    const now=Date.now(),token=key(),n=digest(token),code=String(randomInt(0,100000000)).padStart(8,"0");
    this.flow.tx(()=>{
      this.flow.run("DELETE FROM wa_pm_web_auth WHERE created<?",now-24*60*ms);
      const r=this.flow.one("SELECT COUNT(*) n,MAX(created) last FROM wa_pm_web_auth WHERE actor=? AND created>?",u.user_id,now-60*ms);
      requireValue(!r.last||now-r.last>=60_000,429,"Wait a minute before requesting another code.");
      requireValue(r.n<5,429,"Verification request limit reached. Try again later.");
      this.flow.run("UPDATE wa_pm_web_auth SET otp=NULL WHERE case_id=? AND actor=?",id,u.user_id);
      this.flow.run("INSERT INTO wa_pm_web_auth(id,case_id,actor,identity,created,expires,otp) VALUES(?,?,?,?,?,?,?)",n,id,u.user_id,this.signature(u.whatsapp),now,now+5*ms,this.signature(`${n}:${code}`));
    });
    try{await this.sendCode(u,`Clay PM dashboard · ${id}\nYour verification code: ${code}\nValid for five minutes. Enter it only on the Clay dashboard. Verification does not send vendor emails.`);}
    catch{this.flow.run("UPDATE wa_pm_web_auth SET otp=NULL WHERE id=?",n);throw new DeskError(503,"WhatsApp did not confirm code delivery. Wait a minute and request a new code.");}
    return token;
  }
  verify(id,token,code) {
    const c=this.flow.get(id),u=this.actor(c),n=digest(token||"");
    const r=this.flow.one("SELECT * FROM wa_pm_web_auth WHERE id=? AND case_id=?",n,id);
    requireValue(r?.otp&&r.expires>Date.now()&&r.attempts<5&&r.actor===u.user_id&&r.identity===this.signature(u.whatsapp),403,"Code expired or incorrect. Request a new code.");
    this.flow.run("UPDATE wa_pm_web_auth SET attempts=attempts+1 WHERE id=?",n);
    requireValue(typeof code==="string"&&/^\d{8}$/.test(code)&&timingSafeEqual(Buffer.from(r.otp),Buffer.from(this.signature(`${n}:${code}`))),403,"Code expired or incorrect.");
    const session=key();this.flow.run("UPDATE wa_pm_web_auth SET otp=NULL,session=?,expires=? WHERE id=?",digest(session),Date.now()+10*ms,n);
    return session;
  }
  authorised(id,token) {
    const c=this.flow.get(id),u=this.actor(c);
    const r=this.flow.one("SELECT * FROM wa_pm_web_auth WHERE session=? AND case_id=?",digest(token||""),id);
    requireValue(r&&r.expires>Date.now()&&r.actor===u.user_id&&r.identity===this.signature(u.whatsapp),401,"Verify the PM’s WhatsApp to open this case.");
    return {c,u,r};
  }
  view(id,token) {
    const {c,u,r}=this.authorised(id,token);
    const drafts=c.scope.vendors.map(v=>({id:v.id,name:v.name,...(c.scope.drafts?.[v.id]||{to:v.email,...renderRfq(this.flow.template,c,v,u)})}));
    const snap=digest(JSON.stringify([c.id,c.boq_rev,c.scope,drafts]));
    this.flow.run("UPDATE wa_pm_web_auth SET reviewed=? WHERE id=?",snap,r.id);
    return {id,revision:c.boq_rev,snapshot:snap,stage:c.stage,project:c.scope.project,site:c.scope.site,needed:c.scope.needBy,deadline:c.scope.deadline,
      boq:scopeSummary(c),pm:u.name,demo:!!c.demo,drafts,receipts:this.flow.all("SELECT target,state,accepted FROM wa_flow_outbox WHERE case_id=? AND kind='email' ORDER BY target",id)};
  }
  approve(id,token,body) {
    return this.flow.tx(()=>{
      const {c,u,r}=this.authorised(id,token);
      requireValue(!r.consumed&&c.stage==="BOQ_REVIEW",409,"This dispatch is already confirmed or no longer pending. Refresh for receipts.");
      requireValue(body.confirm===true&&body.revision===c.boq_rev&&r.reviewed&&r.reviewed===body.snapshot,409,"Read the current BOQ and RFQ drafts before confirming.");
      const state=this.view(id,token);requireValue(state.snapshot===r.reviewed,409,"The RFQ changed; review the current drafts.");
      const ids=state.drafts.map(v=>v.id);
      const result=this.flow.dispatch(c,u,[`B${c.boq_rev}`,...ids],"web");
      this.flow.event(c,"web","inbound",u.user_id,"agent",{action:"confirm_rfq_dispatch",revision:c.boq_rev,vendors:ids,snapshot:state.snapshot,identity:"current_roster_whatsapp_otp"},"recorded");
      this.flow.run("UPDATE wa_pm_web_auth SET consumed=? WHERE id=?",Date.now(),r.id);
      return {message:result};
    });
  }
}

import {createHash,createHmac,randomBytes} from "node:crypto";
import {renderRfq,scopeSummary} from "../procurement/boq.mjs";
const digest=v=>createHash("sha256").update(v).digest("hex");
const key=()=>randomBytes(32).toString("hex");
const hour=3_600_000;
export class DeskError extends Error {constructor(status,message){super(message);this.status=status;}}
const need=(ok,status,message)=>{if(!ok)throw new DeskError(status,message);};
const expired="Open the newest private link in the assigned PM’s WhatsApp.";
export class PmApproval {
  constructor(flow,{users,secret,paused=()=>false}) {
    Object.assign(this,{flow,users,secret,paused});
    flow.db.exec(`CREATE TABLE IF NOT EXISTS wa_pm_review_links (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL, actor TEXT NOT NULL, identity TEXT NOT NULL,
      revision INTEGER NOT NULL, scope TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
      redeemed INTEGER, session TEXT UNIQUE, session_until INTEGER, reviewed TEXT, consumed INTEGER);
      CREATE INDEX IF NOT EXISTS wa_pm_link_case ON wa_pm_review_links(case_id,actor);`);
  }
  actor(c){
    const u=[...this.users().values()].find(u=>c&&u.user_id===c.pm_id&&u.role==="project_manager"&&u.project_id===c.project_id);
    need(u&&!this.paused(u.user_id),403,expired);return u;
  }
  identity(u){return createHmac("sha256",this.secret).update(JSON.stringify([u.user_id,u.project_id,u.whatsapp])).digest("hex");}
  issue(id,revision,recipient){
    // Only the verified outbound dispatcher calls this method. No HTTP endpoint
    // issues credentials. Only a token digest reaches SQLite, including audit logs.
    return this.flow.tx(()=>{
      const c=this.flow.get(id),u=this.actor(c);
      need(u.user_id===recipient.user_id&&u.whatsapp===recipient.whatsapp&&u.project_id===recipient.project_id,403,expired);
      need(c.stage==="BOQ_REVIEW"&&c.boq_rev===revision,409,"This RFQ revision no longer needs approval.");
      const token=key(),now=Date.now();
      this.flow.run("DELETE FROM wa_pm_review_links WHERE expires<?",now-24*hour);
      // New invitations invalidate prior links/sessions for this case.
      this.flow.run("UPDATE wa_pm_review_links SET expires=0,session=NULL WHERE case_id=? AND consumed IS NULL",id);
      this.flow.run("INSERT INTO wa_pm_review_links(id,case_id,actor,identity,revision,scope,created,expires) VALUES(?,?,?,?,?,?,?,?)",
        digest(token),id,u.user_id,this.identity(u),revision,digest(c.scope_json),now,now+24*hour);
      return token;
    });
  }
  valid(c,r,u){
    return r&&r.expires>Date.now()&&r.actor===u.user_id&&r.identity===this.identity(u)&&
      r.revision===c.boq_rev&&r.scope===digest(c.scope_json);
  }
  exchange(id,token){
    need(typeof token==="string"&&/^[a-f0-9]{64}$/.test(token),401,expired);
    return this.flow.tx(()=>{
      const c=this.flow.get(id),u=this.actor(c),r=this.flow.one("SELECT * FROM wa_pm_review_links WHERE id=? AND case_id=?",digest(token),id);
      need(this.valid(c,r,u)&&!r.redeemed&&!r.consumed&&c.stage==="BOQ_REVIEW",401,expired);
      const session=key(),now=Date.now();
      this.flow.run("UPDATE wa_pm_review_links SET redeemed=?,session=?,session_until=? WHERE id=?",now,digest(session),now+hour,r.id);
      return session;
    });
  }
  authorised(id,token){
    need(typeof token==="string"&&/^[a-f0-9]{64}$/.test(token),401,expired);
    const c=this.flow.get(id),u=this.actor(c),r=this.flow.one("SELECT * FROM wa_pm_review_links WHERE session=? AND case_id=?",digest(token),id);
    need(this.valid(c,r,u)&&r.session_until>Date.now(),401,expired);
    return {c,u,r};
  }
  view(id,token){
    const {c,u,r}=this.authorised(id,token);
    const drafts=c.scope.vendors.map(v=>({id:v.id,name:v.name,...(c.scope.drafts?.[v.id]||{to:v.email,...renderRfq(this.flow.template,c,v,u)})}));
    const snap=digest(JSON.stringify([c.id,c.boq_rev,c.scope,drafts]));
    this.flow.run("UPDATE wa_pm_review_links SET reviewed=? WHERE id=?",snap,r.id);
    return {id,revision:c.boq_rev,snapshot:snap,stage:c.stage,project:c.scope.project,site:c.scope.site,needed:c.scope.needBy,deadline:c.scope.deadline,
      boq:scopeSummary(c),pm:u.name,demo:!!c.demo,drafts,receipts:this.flow.all("SELECT target,state,accepted FROM wa_flow_outbox WHERE case_id=? AND kind='email' ORDER BY target",id)};
  }
  approve(id,token,body){
    return this.flow.tx(()=>{
      const {c,u,r}=this.authorised(id,token);
      need(!r.consumed&&c.stage==="BOQ_REVIEW",409,"This dispatch is already confirmed or no longer pending. Refresh for receipts.");
      need(body.confirm===true&&body.revision===c.boq_rev&&r.reviewed&&r.reviewed===body.snapshot,409,"Read the current BOQ and RFQ drafts before confirming.");
      const state=this.view(id,token);need(state.snapshot===r.reviewed,409,"The RFQ changed; review the current drafts.");
      const ids=state.drafts.map(v=>v.id);
      const result=this.flow.dispatch(c,u,[`B${c.boq_rev}`,...ids],"web");
      this.flow.event(c,"web","inbound",u.user_id,"agent",{action:"confirm_rfq_dispatch",revision:c.boq_rev,vendors:ids,snapshot:state.snapshot,identity:"assigned_pm_private_whatsapp_link"},"recorded");
      this.flow.run("UPDATE wa_pm_review_links SET consumed=? WHERE id=?",Date.now(),r.id);
      return {message:result};
    });
  }
}

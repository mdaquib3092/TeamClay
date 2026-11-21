import {createHash} from "node:crypto";
import {captureScope,CaseInputError} from "./boq.mjs";
import {businessTable,MasterDataError} from "./master-data.mjs";
import {VendorDataError} from "./vendor-data.mjs";
import {projectScope} from "./stock-lookup.mjs";
import {orderText,orderIntent,terseRequisition,inquiry,logistics,lineFrom,bestPrevious,indiaDay,suggestedDeadline,unitLabel} from "./order-fields.mjs";
import {rfqMinimum} from "../roles.mjs";

const hash=s=>createHash("sha256").update(s).digest("hex");
const week=7*86400000;
const yes=/^(?:yes|yep|yeah|confirm(?:ed)?|submit(?: (?:the |this |my )?(?:request|requirement|rfq))?|send (?:it|this|that|the request|the requirement)(?: to (?:the |my )?(?:pm|project manager))?|go ahead|looks good|haan|han|हाँ|हां|হ্যাঁ)(?: please| sir| thanks)?[.! ]*$/i;
const no=/^(?:cancel|discard|forget|stop|drop)(?: (?:this|the|my|current))?(?: (?:order|request|requirement|draft|rfq))?[.! ]*$|^(?:never mind|nevermind|रद्द करो)$/i;
const unsure=/^(?:(?:i )?(?:do not|don't|dont) know|not sure|unknown|no idea|can you (?:suggest|help)|pata nahi|पता नहीं)[.!? ]*$/i;
const blankLine=()=>({code:null,choices:[],n:null,unit:null,conflict:null,approx:false});
const activeKey=u=>[u.user_id,u.project_id,hash(u.whatsapp)];
const mName=(m)=>m.material_name||m.material_code;
const number=n=>new Intl.NumberFormat("en-IN",{maximumFractionDigits:3}).format(n);
const isYes=s=>yes.test(s.replace(/^(?:okay|ok)[, ]+/i,""))||
  /^(?:yes|haan|हाँ)[, ]+(?:please )?(?:go ahead|send it|submit it|that(?:'s| is) (?:right|correct)|send (?:it )?to (?:the )?pm)[.! ]*$/.test(s);
const knownError=e=>e instanceof CaseInputError||e instanceof MasterDataError||e instanceof VendorDataError;
const candidateNames=(line,catalog)=>line.choices.slice(0,6).filter(id=>catalog.has(id)).map((id,i)=>`${i+1}) ${mName(catalog.get(id))}`).join(", ");
function nextField(d,materials,today){
  for(const [i,l] of d.lines.entries()){
    const m=materials.get(l.code);
    if(!m)return {field:"material",i,question:l.choices.length?`Which material: ${candidateNames(l,materials)}?`:l.hint?`Which catalog name or code matches “${l.hint}”? You can also say “skip this item”.`:"Which material do you need? A name or size is enough."};
    const label=unitLabel(m.unit);
    if(l.conflict?.length>1)return {field:"quantity",i,question:`How many ${label} of ${mName(m)}: ${l.conflict.map(number).join(" or ")}?`};
    if(l.unit&&l.unit!==m.unit)return {field:"quantity",i,question:`${mName(m)} is ordered in ${label}. How many ${label} do you need?`};
    if(l.n==null)return {field:"quantity",i,question:`How many ${label} of ${mName(m)} do you need in total?`};
    if(!l.unit||l.approx)return {field:"basis",i,question:`Should I use ${number(l.n)} ${label} for ${mName(m)}?`};
  }
  if(!d.site)return {field:"site",question:"Where on site should it go? A tower, floor, or “project address” is enough."};
  if(!d.need||d.need<today)return {field:"need",question:"When do you need the material on site?"};
  if(d.askDue||d.due&&(d.due<today||d.due>d.need))return {field:"due",question:`When should vendors reply? Choose today through ${d.need}.`};
  return null;
}
function splitLines(input,catalog){
  const parts=input.split(/\s*(?:;|,(?!\d)|\band\b|\bplus\b|\balso\b| और | ও )\s*/);
  return parts.map((s,i)=>{
    const line=lineFrom(s,catalog),words=s.split("|")[0].trim(),label=words.replace(/^(?:please )?(?:add|include|another)\s+/,"").replace(/\b(?:\d+(?:\.\d+)?|bags?|packs?|mt|kg|cft|units?|some|of|for|at|in|by|the|as well|also|please)\b/g," ").trim().slice(0,70);
    if(i>0&&!line.choices.length&&label&&!/\b(?:repl(?:y|ies)|quot(?:es?|ations?)|bids?|vendors?|deliver(?:y|ed)?|need(?:ed)?|dates?|days?|weeks?|today|tomorrow|site|project|thanks|confirm|actually|instead|make it)\b/.test(label))line.hint=label;
    return {s,line};
  }).filter(x=>x.line.choices.length||x.line.explicitQty||x.line.unknownCode||x.line.hint);
}
function setMaterial(target,proposal){
  target.code=proposal.code;target.choices=proposal.choices;
}
function setQuantity(target,proposal,materials,unitWasAsked){
  if(!proposal.explicitQty)return;
  target.n=proposal.n;target.unit=proposal.unit||(unitWasAsked?materials.get(target.code)?.unit:null);
  target.approx=proposal.approx;target.conflict=proposal.conflict;
}
function applyLines(d,parts,wait,catalog){
  const materials=new Map(catalog.map(m=>[m.material_code,m]));
  const focus=wait?.i!=null?d.lines[wait.i]:null;
  let lastTarget=null;
  for(const {s,line} of parts){
    let proposal=line;
    if(focus&&!focus.code&&focus.choices.length){
      const narrow=lineFrom(s,catalog,{restrict:focus.choices});if(narrow.choices.length)proposal=narrow;
    }
    let target=proposal.code&&d.lines.find(l=>l.code===proposal.code);
    if(!target&&focus&&!focus.code)target=focus;
    if(!target&&!proposal.choices.length&&!proposal.unknownCode&&!proposal.hint)target=lastTarget||focus||(d.lines.length===1?d.lines[0]:null);
    if(!target)target=d.lines.find(l=>!l.code&&!l.choices.length);
    if(!target&&d.lines.length<10){target=blankLine();d.lines.push(target);}
    if(!target)throw new CaseInputError("Use up to ten materials per request. Start a second request for the rest.");
    if(proposal.choices.length||proposal.unknownCode){setMaterial(target,proposal);target.hint=null;}
    if(proposal.hint)target.hint=proposal.hint;
    setQuantity(target,proposal,materials,!!(focus===target&&["basis","quantity"].includes(wait?.field)));
    lastTarget=target;
  }
}
function bundles(flow,d,user,today){
  const groups=new Map(),catalog=new Map(businessTable(flow.root,"materials").map(m=>[m.material_code,m])),due=d.due||suggestedDeadline(today,d.need);
  for(const l of d.lines){
    const m=catalog.get(l.code);if(!m||m.unit!==l.unit)throw new CaseInputError("The material or unit changed. Please restate the item and quantity.");
    const list=groups.get(m.category)||[];list.push(`${l.code} ${l.n} ${l.unit}`);groups.set(m.category,list);
  }
  return [...groups].map(([segment,lines])=>{
    const fields=[lines.join("; "),d.site,d.need,due],scope=captureScope(flow.db,flow.root,user.project_id,fields);
    if(d.notes)scope.siteNotes=d.notes;
    return {segment,fields,scope};
  });
}
const signature=groups=>hash(JSON.stringify(groups.map(g=>g.scope)));
function recap(groups,pm){
  const s=groups[0].scope,lines=groups.flatMap(g=>g.scope.lines);
  const summary=lines.map(l=>`${l.name}: need ${number(l.requested)} ${unitLabel(l.unit)}, stock ${number(l.stock)}, RFQ ${number(l.qty)}.`).join("\n");
  const split=groups.length>1?` ${groups.length} separate material groups.`:"";
  const send=lines.some(l=>l.qty>0)?`Send this to ${pm} for RFQ review?`:"Stock covers the request. Record it without an RFQ?";
  return `${summary}\n${s.project} · ${s.site}\nNeeded ${s.needBy}; vendor replies by ${s.deadline}.${split}${s.siteNotes?`\nSite note: ${s.siteNotes}`:""}\n${send} Reply yes or tell me what to change.`;
}
const contextRef=/\b(?:it|this|that|same (?:material|item)|of those|of these)\b|इसका|इसी|এটা/;
const changeItem=/\b(?:instead|replace|change (?:the )?(?:item|material)|not .+ but|make it)\b/;
const commercial=/\b(?:place (?:an? |the )?order|purchase|procure|requisition|requirement|rfq|buy|order)\b|चाहिए|অর্ডার|দরকার/;
function plainSite(s){
  return s.length>=2&&s.length<=80&&/[\p{L}]/u.test(s)&&!/[?|;\r\n]/.test(s)&&
    !/\b(?:yes|no|ok|later|urgent|asap|not sure|unknown|don.t|approve|send|cancel|tomorrow|today|need|order|stock|day|quote|reply|hello|thanks)\b/.test(s);
}
export class SiteIntake {
  constructor(flow){this.flow=flow;}
  clear(user){this.flow.run("DELETE FROM wa_site_drafts WHERE actor=? AND project=? AND contact=?",...activeKey(user));}
  handle(msg,user,users,prior=[]){
    if(user.role!=="site_engineer"||!["text","voice"].includes(msg.channel)||!msg.id||!msg.user_text.trim()||msg.user_text.length>4000)return null;
    const member=users.get(user.whatsapp.slice(1));
    if(!member||member.user_id!==user.user_id||member.role!==user.role||member.project_id!==user.project_id)return null;
    const f=this.flow,key=activeKey(user),text=orderText(msg.user_text),ms=Date.now(),today=indiaDay(ms);
    const prev=f.one("SELECT reply FROM wa_flow_commands WHERE id=? AND actor=?",msg.id,user.user_id);if(prev)return prev.reply;
    const active=f.one("SELECT state FROM wa_site_drafts WHERE actor=? AND project=? AND contact=? AND touched>=?",...key,ms-week);
    if(!active&&!orderIntent(text)&&!terseRequisition(text))return null;
    if(active&&inquiry(text)&&!isYes(text))return null;
    if(!active&&!commercial.test(text)&&/^(?:i|we) (?:need|want) (?:to |help|information|details|advice|a list|an update|a status)/.test(text))return null;
    // All writes and the idempotency receipt share the case transaction,
    // including when one confirmed requisition splits across vendor segments.
    try{return f.tx(()=>{
      const save=(reply,cid=null)=>{
        f.run("INSERT INTO wa_flow_commands(id,actor,case_id,reply) VALUES(?,?,?,?)",msg.id,user.user_id,cid,reply);return reply;
      };
      if(active&&no.test(text)){this.clear(user);return save("Cancelled this requirement draft.");}
      const d=active?JSON.parse(active.state):{id:msg.id,lines:[blankLine()],turns:[],site:null,need:null,due:null,askDue:false,review:null,wait:null};
      const catalog=businessTable(f.root,"materials"),materials=new Map(catalog.map(m=>[m.material_code,m]));
      const proj=projectScope(f.root,user,text);if(proj.denied)return save(`Your assigned project is ${user.project_id}. Which delivery point in that project should I use?`);
      const wait=d.wait,stamp=Date.parse(msg.received_at)||ms;
      if(d.lastReceived&&stamp<d.lastReceived)return save("An earlier message arrived late. "+(wait?.question||"Please restate the latest change."));
      d.lastReceived=stamp;
      const store=(question,field)=>{
        d.wait=field;f.run(`INSERT INTO wa_site_drafts(actor,project,contact,state,touched) VALUES (?,?,?,?,?)
          ON CONFLICT(actor,project,contact) DO UPDATE SET state=excluded.state,touched=excluded.touched`,...key,JSON.stringify(d),ms);
        const first=user.name?.trim().split(/\s+/)[0];
        const addressed=/^(?:How|Where|When|Which|Should|Can|What)\b/.test(question)?question[0].toLowerCase()+question.slice(1):question;
        return save(!active&&first?`${first}, ${field.field==="review"?"here’s your requirement:\n":""}${addressed}`:question);
      };
      if(d.turns.length>=80){this.clear(user);return save("This draft expired. Start again with the material and quantity.");}
      d.turns.push({id:msg.message_id||msg.id,channel:msg.channel,text:msg.user_text,received:msg.received_at||new Date(ms).toISOString()});
      const pm=[...users.values()].find(u=>u.role==="project_manager"&&u.project_id===user.project_id)?.name||"your PM";
      if(wait?.field==="review"&&isYes(text)){
        const missing=nextField(d,materials,today);
        if(missing){d.review=null;return store(missing.question,missing);}
        const groups=bundles(f,d,user,today),sig=signature(groups);
        if(sig!==d.review){d.review=sig;const r=recap(groups,pm);return store(`The BOQ changed. ${r}`,{field:"review",question:r});}
        const results=[];
        for(const g of groups){
          const source={...msg,id:`guided:${d.id}:${g.segment}`,guided:true,user_text:d.turns.map(t=>t.text).join("\n")};
          const {c}=f.create(source,user,users,g.fields,false,null,d.notes);
          f.event(c,"whatsapp","inbound",user.user_id,"agent",{action:"submit_guided_requirement",confirmedBy:msg.message_id||msg.id,
            turns:d.turns,stockCheckedAt:new Date(ms).toISOString()},"recorded");
          let detail;
          if(c.stage==="IN_STOCK")detail="covered by stock; no RFQ needed";
          else if(!c.scope.vendors.length)detail=`BOQ queued for ${pm}; procurement needs eligible ${g.segment} vendors to generate individual emails`;
          else detail=`${c.scope.vendors.length} ${g.segment} RFQ draft${c.scope.vendors.length===1?"":"s"} queued for ${pm}’s review`;
          const minimum=rfqMinimum(c.project_id,c.demo);
          if(c.stage!=="IN_STOCK"&&c.scope.vendors.length>0&&c.scope.vendors.length<minimum)
            detail+=` (dispatch needs ${minimum} eligible vendors)`;
          results.push({id:c.id,detail});
        }
        this.clear(user);
        return save(results.map(r=>`${r.id}: ${r.detail}.`).join("\n"),results[0].id);
      }
      if(wait?.field==="review"&&/^(?:no|edit|change|not yet)[.! ]*$/.test(text))return store("What should I change: material, quantity, delivery point, or date?",{field:"edit",question:"What should I change?"});
      if(active&&wait.field!=="retry"&&/^(?:status|resume|continue|my draft|what(?:'s| is) next)[.!? ]*$/.test(text))return store(wait.question,wait);
      if(unsure.test(text)&&wait){
        const advice={material:"What will you use it for, or what name is on the bag or drawing?",quantity:"An estimate is fine to start. What quantity should the PM review?",basis:wait.question,
          site:"Can we use the registered project address?",siteDetail:"Can we use the registered project address?",need:"What is the latest day the site can accept delivery?",due:"Use the suggested quote deadline?",review:"What would you like to change: item, quantity, location or date?"};
        const question=advice[wait.field]||wait.question;
        if(["site","siteDetail","due"].includes(wait.field))wait.offered=true;
        return store(question,{...wait,question});
      }
      const note=/(?:^|[,;.]|\s)\s*((?:note|special instructions?|site requirements?)\s*:\s*|(?:must include|include|supply with|please include)\s+|no substitutions?\b)([^.;\n]{0,260})/i.exec(msg.user_text);
      let content=msg.user_text;
      if(note){
        const detail=(note[1]+note[2]).replace(/^(?:note|special instructions?|site requirements?)\s*:\s*/i,"").trim();
        if(detail){d.notes=detail;content=content.replace(note[0]," ");}
      }
      const {dates,issues,site,remaining}=logistics(content,indiaDay(stamp),wait?.field);
      if(site)d.site=site;
      else if(proj.named&&!d.site)d.site="project delivery address";
      if(Object.hasOwn(dates,"need"))d.need=issues.need?null:dates.need;
      if(Object.hasOwn(dates,"due")){d.due=issues.due?null:dates.due;d.askDue=!d.due;}
      if(wait?.offered&&isYes(text)){if(wait.field==="site"||wait.field==="siteDetail")d.site="project delivery address";if(wait.field==="due"){d.due=null;d.askDue=false;}}
      let parts=splitLines(remaining,catalog);
      if(wait?.field==="site"&&/^(?:the )?(?:tower|block|floor|wing|bay)[.! ]*$/.test(text)){
        const area=text.replace(/^the |[.! ]+$/g,""),question=`Which ${area} number or letter? Or say “project address”.`;
        return store(question,{field:"siteDetail",question,area});
      }
      if(wait?.field==="siteDetail"&&/^[a-z]?\d+[a-z]?$|^[a-z]$/.test(text)){d.site=`${wait.area} ${text}`;parts=[];}
      if(wait?.field==="material"&&/^(?:skip|drop|remove) (?:this|that) item[.! ]*$/.test(text)){
        d.lines.splice(wait.i,1);if(!d.lines.length)d.lines.push(blankLine());parts=[];
      }else if(wait?.field==="material"&&d.lines[wait.i]?.choices.length){
        const index=/^(?:option\s+)?([1-6])[.! ]*$/.exec(text),code=index&&d.lines[wait.i].choices[Number(index[1])-1];
        if(code)parts=[{s:code,line:lineFrom(code,catalog)}];
      }
      if(wait?.field==="site"&&!site&&!parts.length&&!Object.keys(dates).length&&plainSite(text))d.site=msg.user_text.trim();
      if(wait?.field==="basis"&&isYes(text)){const l=d.lines[wait.i];l.unit=materials.get(l.code).unit;l.approx=false;}
      if(wait?.field==="review"&&d.lines.length===1&&changeItem.test(text)&&parts.some(x=>x.line.code&&x.line.code!==d.lines[0].code)){
        const old=d.lines[0];old.code=null;old.choices=[];old.n=null;old.unit=null;old.conflict=null;old.approx=false;
      }
      if(wait?.field==="review"&&d.lines.length>1&&parts.length===1&&!parts[0].line.choices.length&&parts[0].line.explicitQty)
        return store("Which material should I change? Include its name and new quantity.",{field:"edit",question:"Which material and what quantity?"});
      if(!active&&!parts.some(p=>p.line.choices.length)&&contextRef.test(text)){
        const code=bestPrevious(prior,catalog);if(code){d.lines[0].code=code;d.lines[0].choices=[code];}
      }
      applyLines(d,parts,wait,catalog);
      // A new, unsupported standalone subject is a chat question, not a BOQ.
      if(!active&&!commercial.test(text)&&!parts.some(p=>p.line.choices.length||p.line.explicitQty)&&!d.lines[0].code)return null;
      const next=nextField(d,materials,today);
      if(next){d.review=null;return store(next.question,next);}
      let groups;
      try{groups=bundles(f,d,user,today);}
      catch(e){if(!knownError(e))throw e;const r=e.message+" Your draft is saved; send the corrected detail or say “resume” after the data is fixed.";d.review=null;return store(r,{field:"retry",question:r});}
      d.review=signature(groups);const r=recap(groups,pm);return store(r,{field:"review",question:r});
    });}catch(e){if(knownError(e))return e.message;throw e;}
  }
}

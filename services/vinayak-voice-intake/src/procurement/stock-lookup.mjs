import {businessTable,verifiedQuantity} from "./master-data.mjs";

const stockWords=/\b(?:stocks?|inventory|availability|available|balance|remaining|left|enough|shortfall|shortage|on[- ]hand|do we have|do i have|how much|how many|kitn[aei]|kina|koto|bacha)\b|कितन|उपलब्ध|मौजूद|বাকি|কত|মজুত/i;
const broadStock=/^(?:\/?stock|inventory)$|\b(?:all|every|full|entire|whole|everything|overview|summary|list|catalog|register|which items|what items|what materials|what stock|any stock|stock information|stock details|stock report|stock level|in stock|out of stock|no stock|zero|available materials|available items|total stock)\b|सभी|सारा|पूरा|সমস্ত|সব/i;
const stockMutation=/\b(?:update|set|change|edit|deduct|reserve|remove|reduce|increase|add|transfer|adjust)\b.{0,45}\b(?:stock|inventory|balance|qty|mat\d+)\b|\b(?:stock|inventory)\b.{0,25}\b(?:to|as)\s+\d/i;
const referenceQuestion=/\b(?:vendor|supplier|quote|quotation|staff|performance|recommend|specification|specs?|history|price|rate|cost|ordered|order status|transaction|forecast|trend|yesterday|last week|last month|as of|reorder|low|highest|lowest|average|median)\b/i;
const aliases={rebar:"tmt",rebars:"tmt",sariya:"tmt",saria:"tmt",sarda:"tmt",bars:"bar",rods:"tmt",rod:"tmt",cements:"cement",waterproof:"waterproofing",coatings:"coating",tiles:"tile",pipes:"pipe",bricks:"brick",blocks:"block",paints:"paint",bags:"bag",packs:"pack",tonnes:"mt",tons:"mt",tonne:"mt",kilograms:"kg",litres:"ltr",liters:"ltr",coils:"coil",sheets:"sheet",pieces:"nos"};
export const normalize=value=>String(value||"").normalize("NFKC").toLowerCase()
  .replace(/सीमेंट|सिमेंट|সিমেন্ট/g," cement ").replace(/स्टील|ইস্পাত|স্টিল/g," steel ").replace(/सरिया|सरिये|রড/g," tmt ")
  .replace(/स्टॉक|स्टाक|স্টক/g," stock ").replace(/वॉटरप्रूफिंग|ওয়াটারপ্রুফিং/g," waterproofing ")
  .replace(/\bmat[\s-]*(\d+)\b/g,(_,n)=>"mat"+n.padStart(3,"0")).replace(/(\d+(?:\.\d+)?)\s+mm\b/g,"$1mm")
  .replace(/\b[a-z]+\b/g,w=>Object.hasOwn(aliases,w)?aliases[w]:w).replace(/\s+/g," ").trim();
const words=text=>text.match(/[\p{L}\p{M}\p{N}]+(?:[.x][\p{L}\p{N}]+)*/gu)||[];
const contains=(s,t)=>t&&` ${words(s).join(" ")} `.includes(` ${words(normalize(t)).join(" ")} `);
const allProjects=u=>u.role==="hod"&&u.project_id==="ALL";
export function projectScope(root,user,text){
  const projects=businessTable(root,"projects"),allowed=projects.filter(p=>allProjects(user)||p.project_id===user.project_id);
  const named=projects.filter(p=>[p.project_id,p.project_name,p.project_id.replace(/^PRJ-/i,"")].some(v=>contains(text,v)));
  const ids=text.match(/\bprj-[a-z0-9_-]+/g)||[];
  if(named.some(p=>!allowed.includes(p))||ids.some(id=>!allowed.some(p=>p.project_id.toLowerCase()===id)))
    return {denied:`I can look up stock and project records only for your assigned scope (${user.project_id}).`};
  return {projects:named.length?named:allowed,named:named.length>0};
}
const generic=new Set(words("a an the i we my me our for in on at of are is was it by with from this that there any have has do does can could you kindly please tell show share list all every full entire total currently current what which material materials item items site project projects data csv file and stock stocks inventory how much many quantity quantities availability available information detail details list status balance remaining left on hand zero nonzero none empty out without only level levels as last updated latest today do us give get check present godown store stores and need to buy shortfall requested require required is there enough assess if report all data over here everything your my about about stock ka ki ke ke liye kitna kitni kitne hai hain batao dikhao kaun sa kon kitna kya mera hamare mein me par abhi sab pura bacha মাল মজুত সব কত আছে क्या स्टाक कितना कितनी कितने है हैं में का की के सभी सारा पूरा चाहिए"));
const dimUnit="bag|pack|kg|mt|ltr|cft|cum|nos|coil|sqft|sheet|rft|m";
const requested=new RegExp(`\\b(?:need(?:ed)?|requir(?:e|ed|ement(?: is)?)|want|enough(?: stock)? for|shortfall for|for)\\s+(\\d+(?:\\.\\d+)?)\\s*(${dimUnit})\\b`,"i");
const threshold=/\b(?:below|under|less than|above|over|more than|at least|at most)\s+(\d+(?:\.\d+)?)\b/;
function materialSelection(text,materials,projects){
  let q=text.replace(/(?:[a-z]:)?[^\s|]*stock\.csv/g," stock ").replace(requested," ").replace(threshold," ");
  for(const p of projects)for(const name of [p.project_id,p.project_name,p.project_id.replace(/^PRJ-/i,"")])if(name){
    const literal=normalize(name).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    q=q.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`,"gu")," ");
  }
  const indexed=materials.map(m=>({m,terms:new Set(words(normalize([m.material_name,m.category,m.unit].join(" "))))}));
  const lex=new Set(indexed.flatMap(x=>[...x.terms])),chosen=new Set(),unmatched=[];
  let specific=false;
  for(const part of q.split(/\b(?:and|or|versus|vs)\b|[,;&]|\s\/\s| और | ও /)){
    const codes=[...new Set(part.match(/\bmat\d+\b/g)||[])];
    if(codes.length){specific=true;for(const code of codes){const m=materials.find(x=>x.material_code.toLowerCase()===code);if(m)chosen.add(m);else unmatched.push(code.toUpperCase());}continue;}
    const tokens=words(part),keys=tokens.filter(t=>lex.has(t)||/^\d+(?:\.\d+)?mm$/.test(t));
    // "in stock" and other sentence words are not material names (e.g. the
    // word "in" is also the inch abbreviation in the door-frame name).
    const terms=keys.filter(k=>!generic.has(k));
    if(!terms.length)continue;
    specific=true;
    const matches=indexed.filter(({terms:set})=>terms.every(k=>set.has(k)));
    if(!matches.length)unmatched.push(terms.join(" "));
    for(const {m} of matches)chosen.add(m);
  }
  const leftover=words(q).filter(w=>!generic.has(w)&&!["no","none","positive","nil","informations","want","provide","send","notify","the","available","stocks","wanting","need","snapshot","recorded","whatsapp","csv","pls","please","hello","hi","right","now","am","looking","running","know","is","which","what","across","both","updated","timestamp","source","breakdown","number","count","give","entire","including","unavailable","not","anymore","would","like","report","levels","threshold","below","under","less","than","above","over","more","least","most","much","prices","say","stocklist"].includes(w));
  return {selected:materials.filter(m=>chosen.has(m)),specific,unmatched,leftover};
}
function stockView(root,projects){
  const materials=businessTable(root,"materials"),rows=businessTable(root,"stock");
  const permitted=new Set(projects.map(p=>p.project_id)),byKey=new Map(),unknownCodes=new Map();
  const known=new Set(materials.map(m=>m.material_code));
  for(const row of rows){
    if(!permitted.has(row.project_id))continue;
    byKey.set(`${row.project_id}/${row.material_code}`,row);
    if(!known.has(row.material_code))unknownCodes.set(row.material_code,{material_code:row.material_code,material_name:"Unmapped material",unit:null,category:null});
  }
  return {materials:[...materials,...unknownCodes.values()],byKey};
}
const markedZero=q=>/\b(?:zero|nil|empty|out[- ]of[- ]stock|no stock|unavailable|not available|stockout)\b/.test(q);
const markedPositive=q=>!markedZero(q)&&/\b(?:in[- ]stock|non[- ]?zero|positive|available (?:materials|items)|(?:materials|items) (?:are )?available|only available)\b/.test(q);
const fmt=n=>new Intl.NumberFormat("en-IN",{maximumFractionDigits:9}).format(n);
// Null means use grounded conversation for a nuanced question; a string is
// a fully computed answer and needs neither a language model nor an RFQ.
export function inventoryAnswer(root,user,input,prior="",earlier=[]){
  const text=normalize(input),last=normalize(prior);
  const refer=/\b(?:it|its|them|their|that one|this one|this material|that material|that item|same item|iska|iski|uska)\b|इसका|उसका|এটার/.test(text);
  const follow=/^(?:and\b|what about\b|how about\b|same (?:for|at)\b|और|আর)/.test(text)&&stockWords.test(last);
  const describe=/\b(?:material|know about|tell me about|details (?:of|about)|what is mat\d+)\b/.test(text)&&!stockWords.test(text);
  const explicit=/^\/?(?:data\s+)?stock(?:s|\.csv)?(?:\s|$)/.test(text);
  if(!stockWords.test(text)&&!follow&&!describe&&!explicit&&!/^\s*mat\d+\s*\??$/.test(text))return null;
  if(!explicit&&!follow&&referenceQuestion.test(text))return null;
  let scope=projectScope(root,user,text);
  if(scope.denied)return scope.denied;
  if(!scope.projects.length)return `No project in projects.csv matches your registered assignment (${user.project_id}).`;
  if(stockMutation.test(text))return "Stock enquiries are read-only. Edit the project row in stock.csv to record a stock change; ask STOCK afterwards for the new balance.";
  let {materials,byKey}=stockView(root,scope.projects);
  let pick=materialSelection(text,materials,scope.projects);
  if((follow||refer)&&!pick.specific&&!/\ball\b/.test(text)){
    for(const prev of [last,...earlier.map(normalize)]){
      if(!prev)continue;
      const previousScope=projectScope(root,user,prev);
      if(previousScope.denied)break;
      const candidate=materialSelection(prev,materials,previousScope.projects);
      if(candidate.specific){
        pick=candidate;
        if(!scope.named&&previousScope.named){scope=previousScope;({materials,byKey}=stockView(root,scope.projects));}
        break;
      }
    }
    if(!pick.specific&&refer)return "Which material do you mean? Send its name or code (for example STOCK MAT010), or just STOCK for the whole project.";
  }
  if(describe&&!pick.specific)return null;
  const zero=markedZero(text),positive=markedPositive(text),limit=threshold.exec(text);
  if(!pick.specific){
    if(pick.leftover.length&&!zero&&!positive&&!limit&&!follow)return null;
    if(!explicit&&!broadStock.test(text)&&!/\b(?:stocks?|inventory|balance|availab\w*)\b/.test(text)&&!zero&&!positive&&!limit&&!follow)return null;
    pick.selected=materials;
  }
  if(!pick.selected.length)return `No matching material${pick.unmatched.length?" for "+pick.unmatched.join(", "):""} in materials.csv. Send STOCK with an item name, category or material code.`;
  const target=requested.exec(text),sections=[];
  for(const p of scope.projects){
    const found=pick.selected.map(m=>{
      const s=byKey.get(`${p.project_id}/${m.material_code}`),qty=verifiedQuantity(s,m);
      return {m,s,qty};
    });
    const included=found.filter(({qty})=>{
      if(zero&&pick.selected.length>1)return qty===0;
      if(positive&&pick.selected.length>1&&!(qty>0))return false;
      if(!limit)return true;
      if(qty===null)return false;
      const n=Number(limit[1]);
      if(limit[0].startsWith("at least"))return qty>=n;
      if(limit[0].startsWith("at most"))return qty<=n;
      return /^(below|under|less)/.test(limit[0])?qty<n:qty>n;
    });
    const dates=new Set(included.map(x=>x.s?.last_updated||"not recorded")),common=dates.size===1?[...dates][0]:null;
    let title=`${p.project_name||p.project_id} (${p.project_id}) · ${included.length} ${pick.selected.length>1?(zero?"zero-stock ":positive?"in-stock ":""):""}item${included.length===1?"":"s"}`;
    if(common)title+=` · Stock updated: ${common}`;
    const lines=included.map(({m,s,qty})=>`${m.material_code} ${m.material_name||""}: ${qty===null?"unknown (no verified stock quantity/unit)":`${fmt(qty)} ${m.unit}`}${common?"":` · ${s?.last_updated||"date not recorded"}`}${describe&&m.specification?` · ${m.specification}`:""}`);
    if(!lines.length)lines.push("No matching recorded quantities.");
    if((zero||positive||limit)&&found.some(x=>x.qty===null))lines.push("Missing or unverified quantities are not counted.");
    if(target&&included.length===1&&pick.selected.length===1){
      const {m,qty}=included[0],need=Number(target[1]);
      if(qty!==null&&Number.isFinite(need)&&target[2]===m.unit)lines.push(`Requested ${fmt(need)} ${m.unit}; shortfall ${fmt(Math.max(0,Math.round((need-qty)*1e6)/1e6))} ${m.unit}.`);
      else if(target[2]!==m.unit)lines.push(`Requested unit ${target[2]} differs from stock unit ${m.unit}; no conversion assumed.`);
    }
    if(/\b(?:sum|total|combined)\b/.test(text)&&included.length>1){
      const totals=new Map();for(const {m,qty} of included)if(qty!==null)totals.set(m.unit,(totals.get(m.unit)||0)+qty);
      if(totals.size)lines.push(`Recorded totals by unit: ${[...totals].map(([u,n])=>`${fmt(n)} ${u}`).join("; ")}.`);
    }
    sections.push([title,...lines].join("\n"));
  }
  if(pick.unmatched.length)sections.push(`No matching material: ${pick.unmatched.join(", ")}.`);
  return sections.join("\n\n")+"\nSource: stock.csv + materials.csv.";
}

// Structured evidence for free-form analysis and multilingual follow-ups.
export function scopedStock(root,projects){
  const {materials,byKey}=stockView(root,projects);
  return projects.map(p=>({project:p.project_id,
    rows:materials.map(m=>{const s=byKey.get(`${p.project_id}/${m.material_code}`);return [m.material_code,verifiedQuantity(s,m),m.unit,s?.last_updated??null];})}));
}

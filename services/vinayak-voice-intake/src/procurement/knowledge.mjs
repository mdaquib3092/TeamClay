import fs from "node:fs";
import path from "node:path";
import {businessTable,MasterDataError} from "./master-data.mjs";
import {vendorDirectory,vendorPerformance,VendorDataError} from "./vendor-data.mjs";
import {inventoryAnswer,normalize,projectScope,scopedStock} from "./stock-lookup.mjs";

const titles={stock:"stock.csv",materials:"materials.csv",projects:"projects.csv",staff:"users.csv",
  vendors:"vendors.csv",performance:"vendor_performance.csv",replies:"sample_vendor_replies.csv",rfqs:"rfqs/ (archived)"};
const rules={
  stock:/\bstocks?\b|inventory|availab|on hand|remaining|shortfall|shortage|balance|how (?:much|many)|do we have|enough|kitn|कितन|কত|मौजूद|মজুত|स्टॉक|স্টক/i,
  materials:/\bmat[\s-]*\d+|material|specification|catalog|grade|cement|steel|tmt|rebar|brushbond|sariya|सीमेंट|সরিয়া|सामग्री|सामान/i,
  projects:/project|address|delivery location|site location|परियोजना|প্রকল্প/i,
  staff:/\bstaff\b|\bteam\b|\busers?\b|\bwho(?:'s| is| are)\b.{0,25}\b(?:pm|hod|engineer|manager)|assigned (?:engineer|manager|pm|hod)|कर्मचारी|কর্মী/i,
  vendors:/vendors?|suppliers?|distributors?|\bv\d+\b|वेंडर|विक्रेता|সরবরাহকারী/i,
  performance:/performance|on.?time|quality rating|track record|reliab|history|historical|reply rate|कार्यक्षमता/i,
  replies:/sample.vendor.repl|sample (?:quote|rate|price|repl)|historical (?:quote|rate|price|repl)|reference (?:rate|quote)|पुरान.{0,10}भाव/i,
  rfqs:/archived?|exported|rfqs\/|rfq-demo-/i,
};
const compact=(s,max=220)=>typeof s==="string"?s.replace(/\s+/g," ").slice(0,max):s;
const commercial=u=>["project_manager","hod"].includes(u.role);
function readArchive(root,projects){
  const folder=path.join(root,"data/rfqs"),result=[];
  if(!fs.existsSync(folder))return result;
  if(!fs.lstatSync(folder).isDirectory())throw new Error("Archive unavailable");
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^RFQ-[\w-]{1,80}$/.test(entry.name))continue;
    const file=path.join(folder,entry.name,"requirement.json"),s=fs.lstatSync(file);
    if(!s.isFile()||s.size>128000)throw new Error("Archive unavailable");
    const r=JSON.parse(fs.readFileSync(file,"utf8"));
    if(!projects.some(p=>p.project_id===r.project_id)||r.rfq_id!==entry.name)continue;
    result.push({id:entry.name,project:r.project_id,demo:r.demo===true,title:compact(r.title),needBy:r.requested_delivery_date,
      vendorIds:r.vendor_ids,lines:(r.lines||[]).map(l=>({code:l.material_code,required:l.required_quantity,recordedStock:l.recorded_stock,rfqQty:l.rfq_quantity,unit:l.unit,stockAt:l.stock_snapshot_at}))});
  }
  return result;
}
const tablesFor=(text,prior)=>{
  const hit=s=>Object.keys(rules).filter(k=>rules[k].test(s));
  const data=hit(text);
  const follow=/^(?:and\b|what about\b|how about\b|same\b|what else\b|what is (?:its|their)|what are (?:its|their)|और|আর)/i.test(text);
  if(follow)data.push(...hit(prior));
  return new Set(data);
};
function sourceGuide(user){
  return `Available procurement data for ${user.project_id}:\nSTOCK — quantities, units and stock update times (stock.csv).\nMATERIALS — names, codes, units and specifications.\nPROJECTS — assigned projects and delivery addresses.\nSTAFF — staff roles and project assignments.\nVENDORS — suppliers by segment.${commercial(user)?"\nPERFORMANCE — unverified supplier history.\nSAMPLE REPLIES — historical examples, not live bids.\nARCHIVED RFQS — project-scoped RFQ exports.":""}\nTry “Show all stock”, “PPC cement stock” or “Stock MAT020”.`;
}
const commands=new Map([["materials","materials"],["projects","projects"],["staff","staff"],["users","staff"],["vendors","vendors"],["performance","performance"],["sample replies","replies"],["archived rfqs","rfqs"]]);
const exactCommands=/^\/?(?:data\s+)?(materials|projects|staff|users|vendors|performance|sample replies|archived rfqs)(?:\.csv)?(?:\s+(.+?))?[?.!]*$/i;
function directList(k,rows,filter){
  const tokens=normalize(filter).split(/\s+/).filter(s=>s&&!["all","list","show","me","please"].includes(s));
  const rowsFound=rows.filter(r=>tokens.every(t=>normalize(JSON.stringify(r)).includes(t)));
  const displays={
    materials:r=>`${r.material_code} · ${r.material_name} · ${r.category} · ${r.unit} · ${r.specification||"spec not recorded"}`,
    projects:r=>`${r.project_id} · ${r.project_name} · ${r.address||"address not recorded"}`,
    staff:r=>`${r.id} · ${r.name} · ${r.role} · ${r.project}`,
    vendors:r=>`${r.id} · ${r.name} · ${r.segments.join(", ")}${r.email?" · "+r.email:""}${r.paymentTerms?" · "+r.paymentTerms:""}`,
    performance:r=>`${r.id}: ${r.data?`${r.data.orders} orders; on time ${r.data.onTime??"unknown"}%; quality ${r.data.quality??"unknown"}/5; average reply ${r.data.replyHours??"unknown"} h; reply rate ${r.data.replyRate??"unknown"}%; updated ${r.data.updated||"unknown"}`:"no usable history"}`,
    replies:r=>`${r.vendor_id} ${r.material_code}: ${r.rate??"unknown"}/${r.unit??"unknown"}; GST included: ${r.gst_included??"unknown"}; freight as recorded ${r.freight??"unknown"}; ${r.delivery_days??"unknown"} days; ${r.payment_terms||"payment unknown"}`,
    rfqs:r=>`${r.id} · ${r.project} · ${r.title} · needed ${r.needBy}. ${(r.lines||[]).map(l=>`${l.code} ${l.rfqQty} ${l.unit}`).join("; ")}`,
  };
  return `${titles[k]}${k==="replies"||k==="performance"?" · unverified reference data, not a live quotation":""} · ${rowsFound.length} records\n${rowsFound.length?rowsFound.map(displays[k]).join("\n"):"No matching records."}`;
}

export class ProcurementKnowledge {
  constructor(root){this.root=root;}
  lookup(user,input,{users,prior="",earlier=[]}={}){
    if(!["site_engineer","project_manager","hod"].includes(user?.role)||!user.project_id)return null;
    const text=normalize(input),last=normalize(prior);
    if(/^\/?(?:data|data help|data sources|sources|what (?:files|data) (?:can you (?:read|see)|do you have)[?.!]*)$/i.test(text))return {reply:sourceGuide(user)};
    const root=this.root;
    try{
      const stock=inventoryAnswer(root,user,input,prior,earlier);
      if(stock!==null)return {reply:stock};
    }catch(e){return {reply:e instanceof MasterDataError?e.message:"I couldn't verify stock.csv and its material and project mappings. Please check the current files."};}
    const shortcut=exactCommands.exec(text),direct=shortcut&&commands.get(shortcut[1]);
    if(direct&&!commercial(user)&&["performance","replies","rfqs"].includes(direct))return {reply:"Commercial quotation and performance records are available to the assigned PM and HOD."};
    // Omitted domains remain absent, not evidence that a table is empty.
    const wanted=tablesFor(text,last);
    if(direct)wanted.add(direct);
    if(!wanted.size){
      if(!text||/^(?:hi|hello|hey|thanks|thank you|ok|okay|bye)[\s.!]*$/.test(text))return null;
      // Material-name-only questions (and non-English questions without a
      // recognised keyword) can still be answered with catalog/stock facts.
      let matches=false;
      try{matches=businessTable(root,"materials").some(m=>normalize(m.material_name).split(/[^a-z0-9]+/).some(w=>w.length>=4&&new RegExp(`\\b${w}\\b`).test(text)));}catch{}
      if(matches||/[^\x00-\x7F]/.test(text)||/\b(?:enough|packs|bags|remaining|kitn|koto|have any)\b/.test(text)){wanted.add("stock");wanted.add("materials");}
      else return null;
    }
    if(wanted.has("materials")&&!direct&&!wanted.has("replies"))wanted.add("stock");
    if(wanted.has("stock"))wanted.add("projects");
    if(wanted.has("stock")||wanted.has("replies"))wanted.add("materials");
    if(wanted.has("performance")||wanted.has("replies"))wanted.add("vendors");
    if(!commercial(user))for(const key of ["performance","replies","rfqs"])wanted.delete(key);
    if(!wanted.size)return {reply:"That source is available to the assigned procurement manager or HOD."};
    let projects;
    try{const scope=projectScope(root,user,text);if(scope.denied)return {reply:scope.denied};projects=scope.projects;}
    catch{return {reply:"I couldn't verify the project scope from projects.csv."};}
    const tables={},unavailable={};
    const load=(key,fn)=>{if(wanted.has(key))try{tables[key]=fn();}catch(e){unavailable[key]=e instanceof MasterDataError||e instanceof VendorDataError?e.message:`Cannot read ${titles[key]}.`;}};
    load("projects",()=>projects);
    load("stock",()=>scopedStock(root,projects));
    load("materials",()=>businessTable(root,"materials"));
    load("staff",()=>[...(users?.values()||[])].filter(u=>projects.some(p=>p.project_id===u.project_id)||(u.role==="hod"&&u.project_id==="ALL"))
      .map(u=>({id:u.user_id,name:u.name,role:u.role,project:u.project_id})));
    load("vendors",()=>vendorDirectory(root).map(({id,name,segments,email,paymentTerms})=>({id,name,segments,...(commercial(user)?{email,paymentTerms}:{})})));
    load("performance",()=>[...vendorPerformance(root)].map(([id,data])=>({id,data})));
    load("replies",()=>businessTable(root,"sample_vendor_replies").map(r=>({...r,raw_message:compact(r.raw_message,600),activeVendor:tables.vendors?.some(v=>v.id===r.vendor_id)??null})));
    load("rfqs",()=>readArchive(root,projects));
    if(direct)return {reply:unavailable[direct]||directList(direct,tables[direct]||[],shortcut[2]||"")};
    const evidence=JSON.stringify({project_scope:projects.map(p=>p.project_id),sources:Object.fromEntries([...wanted].map(k=>[k,titles[k]])),
      stock_columns:["material_code","qty_available","unit","last_updated"],tables,unavailable});
    if(evidence.length>75000)return {reply:"That request spans a large number of records. Ask by project, material code or supplier. DATA lists the available lookups."};
    return {evidence};
  }
}

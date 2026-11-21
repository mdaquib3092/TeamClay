/* =====================================================================
   DEMO DATA. REQ-1001 comes from the brief. REQ-1002..1008, vendors 5-15
   and their quotes are invented SAMPLE data. Strings written as [text]
   render as grey italic placeholders (see <Txt/>).
   ===================================================================== */
export const P = t => `[${t}]`;
export const STEPS = ["In stock","Drafts to send","RFQ sent","Replies in","With HOD","Approved","Sent back"];
export const CHIP = {"In stock":"s-stock","Drafts to send":"s-pm","RFQ sent":"s-rfq","Replies in":"s-replies","With HOD":"s-hod","Approved":"s-approved","Sent back":"s-back"};
export const USERS = {
  debashis:{name:"Debashis",role:"PM",project:"Amara",home:"pm-inbox",blurb:"Project manager · Amara"},
  anirban:{name:"Anirban",role:"PM",project:"Aquina",home:"pm-inbox",blurb:"Project manager · Aquina"},
  vikram:{name:"Vikram",role:"HOD",project:"All projects",home:"hod-list",blurb:"Head of department"},
  admin:{name:"Admin",role:"Admin",project:"System",home:"admin-data",blurb:"Data, integrations, monitoring"}
};
export const VM = {
  "Eastern Rebar Traders":{cat:"Steel",terms:"15 days credit",ot:"92%",q:"4.6",rp:"~3 h"},
  "Shree Balaji Steel Agency":{cat:"Steel",terms:"Advance",ot:"80%",q:"3.8",rp:"~1 h"},
  "Howrah Iron & Steel":{cat:"Steel",terms:"30 days credit",ot:"63%",q:"4.9",rp:"~21 h"},
  "Bengal Structural Supplies":{cat:"Steel",terms:null,isNew:true},
  "Maa Tara Building Materials":{cat:"Cement",terms:"7 days credit",ot:"88%",q:"4.4",rp:"~2 h"},
  "Rajarhat Cement Agency":{cat:"Cement",terms:"15 days credit",ot:"85%",q:"4.2",rp:"~4 h"},
  "Dum Dum Traders":{cat:"Cement",terms:"Advance",ot:"60%",q:"3.6",rp:"~20 h"},
  "New Town Blocks & Bricks":{cat:"Blocks",terms:"15 days credit",ot:"90%",q:"4.5",rp:"~5 h"},
  "Barasat AAC Udyog":{cat:"Blocks",terms:"7 days credit",ot:"75%",q:"4.0",rp:"~2 h"},
  "Hooghly Sand Suppliers":{cat:"Sand & aggregates",terms:"Advance",ot:"82%",q:"4.1",rp:"~3 h"},
  "Ganga Aggregates":{cat:"Sand & aggregates",terms:"7 days credit",ot:"78%",q:"4.3",rp:"~6 h"},
  "Bally Stone Crushers":{cat:"Sand & aggregates",terms:"15 days credit",ot:"70%",q:"3.9",rp:"~8 h"},
  "Sonarpur Aggregates":{cat:"Sand & aggregates",terms:"Advance",isNew:true},
  "Salkia Hardware Stores":{cat:"Hardware",terms:"15 days credit",ot:"86%",q:"4.2",rp:"~5 h"},
  "Bowbazar Electricals":{cat:"Electrical",terms:"30 days credit",ot:"94%",q:"4.7",rp:"~2 h"}
};
export const CEMENT = ["Maa Tara Building Materials","Rajarhat Cement Agency","Dum Dum Traders"];
export const REQS = [
 {id:"REQ-1001",project:"Amara",pm:"debashis",title:"TMT 12mm 10 MT + TMT 16mm 8 MT",short:"TMT 12mm + 16mm",qty:"10 MT + 8 MT",needBy:"28 Nov",by:"Sourav",via:"WhatsApp voice",
  origLabel:"Original (Bengali)",orig:P("Original Bengali voice transcript"),english:"Need TMT 12mm 10 MT and TMT 16mm 8 MT at Amara by 28 Nov.",
  stock:[["TMT 12mm","0.4 MT","9.6 MT","10 MT"],["TMT 16mm","0 MT","8 MT","8 MT"]],rfqLines:["TMT 12mm, Fe500D — 10 MT","TMT 16mm, Fe500D — 8 MT"],
  vendors:["Eastern Rebar Traders","Shree Balaji Steel Agency","Howrah Iron & Steel","Bengal Structural Supplies"],
  quotes:{
   "Eastern Rebar Traders":{rank:1,quoted:"₹59,800/MT + ₹650 freight",landed:"₹60,450",u:"MT",total:"₹10.83 L",days:"3 days",terms:"15 days credit",score:"92.2",reason:"Lowest landed cost with strong on-time and quality record.",flags:[]},
   "Shree Balaji Steel Agency":{rank:2,quoted:"₹61.50/kg",landed:"₹61,500",u:"MT",extra:"Freight free",total:"₹11.01 L",diff:"+1.6%",days:"1 day",terms:"Advance",score:"91.9",reason:"Fastest delivery, but 1.6% costlier, wants full advance, lower quality.",flags:[["Unit converted kg→MT",""],["Wants advance","warn"]]},
   "Howrah Iron & Steel":{rank:3,quoted:"₹71,980/MT incl. GST",landed:"₹61,500",u:"MT",extra:"₹61,000 ex-GST + ₹500 freight",total:"₹11.03 L",diff:"+1.8%",days:"5 days",terms:"30 days credit",score:"81.2",reason:"Best credit and quality, but slowest delivery and weak on-time record.",flags:[["GST was included",""]]},
   "Bengal Structural Supplies":{unranked:true,said:"16mm offered in Fe550D",reason:"Not ranked: 16mm offered in Fe550D, not the Fe500D asked for.",flags:[["Substitute spec","warn"],["New vendor",""]]}},
  rec:"Eastern Rebar Traders",stage:"hod",replied:4,
  qa:[["Shree Balaji fast hai, use kyun nahi?","Shree Balaji is 1.6% costlier, wants full advance, and quality averages 3.8/5 vs 4.6.","quotes + vendor history"]]},

 {id:"REQ-1002",sample:true,project:"Amara",pm:"debashis",title:"Cement OPC 53 · 400 bags",short:"Cement OPC 53",qty:"400 bags",needBy:"30 Nov",by:"Rakesh",via:"WhatsApp text",
  origLabel:"Original (WhatsApp text)",orig:"Cement OPC 53 400 bag lagbe, 30 tarikh er moddhe Amara site e.",english:"Need 400 bags of OPC 53 cement at Amara site by 30 Nov.",
  stock:[["Cement OPC 53","0 bags","400 bags","400 bags"]],rfqLines:["Cement OPC 53 grade — 400 bags (50 kg)"],vendors:CEMENT,
  quotes:{
   "Maa Tara Building Materials":{rank:1,quoted:"₹362/bag + ₹4 freight",landed:"₹366",u:"bag",total:"₹1.46 L",days:"2 days",terms:"7 days credit",score:"90.5",reason:"Lowest landed cost with a reliable on-time record.",flags:[]},
   "Rajarhat Cement Agency":{rank:2,quoted:"₹370/bag, freight included",landed:"₹370",u:"bag",total:"₹1.48 L",diff:"+1.1%",days:"1 day",terms:"15 days credit",score:"88.1",reason:"Fastest with better credit, but 1.1% costlier.",flags:[]},
   "Dum Dum Traders":{rank:3,quoted:"₹460/bag incl. GST",landed:"₹369.38",u:"bag",extra:"₹359.38 ex-GST + ₹10 freight",total:"₹1.48 L",diff:"+0.9%",days:"4 days",terms:"Advance",score:"74.0",reason:"Close on price once GST is removed, but slow, wants advance, weak record.",flags:[["GST was included",""],["Wants advance","warn"]]}},
  rec:"Maa Tara Building Materials",stage:"drafts",replied:0,
  qa:[["Dum Dum sasta nahi hai?","No. Its ₹460/bag included 28% GST. Ex-GST it lands at ₹369.38/bag, 0.9% above Maa Tara, and it wants advance.","quotes + vendor history"]]},

 {id:"REQ-1003",sample:true,project:"Amara",pm:"debashis",title:"AAC blocks 600×200×200 mm · 3,000 nos",short:"AAC blocks",qty:"3,000 nos",needBy:"27 Nov",by:"Pritam",via:"WhatsApp text",
  origLabel:"Original (WhatsApp text)",orig:"AAC block 600x200x200 3000 pcs chai, 27 Nov er moddhe.",english:"Need 3,000 AAC blocks (600×200×200 mm) by 27 Nov.",
  stock:[["AAC block 600×200×200 mm","0 nos","3,000 nos","3,000 nos"]],rfqLines:["AAC block 600×200×200 mm — 3,000 nos"],vendors:["New Town Blocks & Bricks","Barasat AAC Udyog"],
  quotes:{
   "New Town Blocks & Bricks":{rank:1,quoted:"₹58/block + ₹2 freight",landed:"₹60",u:"block",total:"₹1.80 L",days:"4 days",terms:"15 days credit",score:"89.4",reason:"Lower cost and stronger record; delivery fits 27 Nov.",flags:[]},
   "Barasat AAC Udyog":{rank:2,quoted:"₹61/block, freight free",landed:"₹61",u:"block",total:"₹1.83 L",diff:"+1.7%",days:"2 days",terms:"7 days credit",score:"85.0",reason:"Faster, but 1.7% costlier with a weaker on-time record.",flags:[]}},
  rec:"New Town Blocks & Bricks",stage:"approved",replied:2,decision:{text:"Approved on WhatsApp at 17:02",via:"WhatsApp"},qa:[]},

 {id:"REQ-1004",sample:true,project:"Amara",pm:"debashis",title:"Binding wire 18 gauge · 200 kg",short:"Binding wire 18 g",qty:"200 kg",needBy:"22 Nov",by:"Sourav",via:"WhatsApp text",
  origLabel:"Original (WhatsApp text)",orig:"Binding wire 18 gauge 200 kg lagbe kal.",english:"Need 200 kg of 18-gauge binding wire tomorrow.",
  stock:[["Binding wire 18 gauge","350 kg","0 kg","—"]],stage:"instock",vendors:[],quotes:{},replied:0,qa:[],
  stockReply:"In stock: 200 kg of 350 kg available in Amara store. No RFQ needed."},

 {id:"REQ-1005",sample:true,project:"Aquina",pm:"anirban",title:"River sand · 1,200 cft",short:"River sand",qty:"1,200 cft",needBy:"29 Nov",by:"Moumita",via:"WhatsApp voice",
  origLabel:"Original (Bengali)",orig:P("Original Bengali voice transcript"),english:"Need 1,200 cft of river sand at Aquina by 29 Nov.",
  stock:[["River sand","0 cft","1,200 cft","1,200 cft"]],rfqLines:["River sand (coarse) — 1,200 cft"],vendors:["Hooghly Sand Suppliers","Ganga Aggregates","Sonarpur Aggregates"],
  quotes:{
   "Hooghly Sand Suppliers":{rank:2,quoted:"₹48/cft + ₹4 freight",landed:"₹52",u:"cft",total:"₹62,400",diff:"+4.0%",days:"1 day",terms:"Advance",score:"84.6",reason:"Fastest, but 4% costlier and wants advance.",flags:[["Wants advance","warn"]]},
   "Ganga Aggregates":{rank:1,quoted:"₹50/cft, freight free",landed:"₹50",u:"cft",total:"₹60,000",days:"2 days",terms:"7 days credit",score:"90.3",reason:"Lowest landed cost, with credit.",flags:[]},
   "Sonarpur Aggregates":{unranked:true,said:"No stock until 5 Dec",reason:"Not ranked: no stock until 5 Dec, after the needed-by date.",flags:[["New vendor",""]]}},
  rec:"Ganga Aggregates",stage:"sent",replied:1,qa:[]},

 {id:"REQ-1006",sample:true,project:"Aquina",pm:"anirban",title:"Stone chips 20 mm · 800 cft",short:"Stone chips 20 mm",qty:"800 cft",needBy:"1 Dec",by:"Moumita",via:"WhatsApp text",
  origLabel:"Original (WhatsApp text)",orig:"20mm stone chips 800 cft, 1 Dec er moddhe.",english:"Need 800 cft of 20 mm stone chips by 1 Dec.",
  stock:[["Stone chips 20 mm","0 cft","800 cft","800 cft"]],rfqLines:["Stone chips 20 mm — 800 cft"],vendors:["Ganga Aggregates","Bally Stone Crushers"],
  quotes:{
   "Ganga Aggregates":{rank:1,quoted:"₹62/cft + ₹3 freight",landed:"₹65",u:"cft",total:"₹52,000",days:"3 days",terms:"7 days credit",score:"88.7",reason:"Lower cost and better quality record.",flags:[]},
   "Bally Stone Crushers":{rank:2,quoted:"₹66/cft, freight included",landed:"₹66",u:"cft",total:"₹52,800",diff:"+1.5%",days:"2 days",terms:"15 days credit",score:"83.2",reason:"Faster, but 1.5% costlier with a weaker on-time record.",flags:[]}},
  rec:"Ganga Aggregates",stage:"sentback",replied:2,decision:{text:"Sent back by Vikram in the web app",reason:"Only two quotes. Ask Sonarpur Aggregates as well."},qa:[]},

 {id:"REQ-1007",sample:true,project:"Aquina",pm:"anirban",title:"PVC conduit 25 mm · 500 m",short:"PVC conduit 25 mm",qty:"500 m",needBy:"3 Dec",by:"Subhajit",via:"WhatsApp text",
  origLabel:"Original (WhatsApp text)",orig:"25mm PVC conduit 500 m dorkar.",english:"Need 500 m of 25 mm PVC conduit.",
  stock:[["PVC conduit 25 mm","800 m","0 m","—"]],stage:"instock",vendors:[],quotes:{},replied:0,qa:[],
  stockReply:"In stock: 500 m of 800 m available in Aquina store. No RFQ needed."},

 {id:"REQ-1008",sample:true,project:"Aquina",pm:"anirban",title:"Cement OPC 53 · 250 bags",short:"Cement OPC 53",qty:"250 bags",needBy:"2 Dec",by:"Subhajit",via:"WhatsApp voice",
  origLabel:"Original (Bengali)",orig:P("Original Bengali voice transcript"),english:"Need 250 bags of OPC 53 cement at Aquina by 2 Dec.",
  stock:[["Cement OPC 53","0 bags","250 bags","250 bags"]],rfqLines:["Cement OPC 53 grade — 250 bags (50 kg)"],vendors:CEMENT,
  quotes:{
   "Maa Tara Building Materials":{rank:1,quoted:"₹364/bag + ₹4 freight",landed:"₹368",u:"bag",total:"₹92,000",days:"2 days",terms:"7 days credit",score:"90.8",reason:"Lowest landed cost with a reliable record.",flags:[]},
   "Rajarhat Cement Agency":{rank:2,quoted:"₹370/bag, freight included",landed:"₹370",u:"bag",total:"₹92,500",diff:"+0.5%",days:"1 day",terms:"15 days credit",score:"89.0",reason:"Fastest with better credit, 0.5% costlier.",flags:[]},
   "Dum Dum Traders":{rank:3,quoted:"₹460/bag incl. GST",landed:"₹369.38",u:"bag",extra:"₹359.38 ex-GST + ₹10 freight",total:"₹92,345",diff:"+0.4%",days:"4 days",terms:"Advance",score:"74.6",reason:"GST removed: close on price, but slow and wants advance.",flags:[["GST was included",""],["Wants advance","warn"]]}},
  rec:"Maa Tara Building Materials",stage:"drafts",replied:0,qa:[]}
];

export const initialReqs = () => REQS.map(r=>({...r, sent: ["drafts","instock"].includes(r.stage)?[]:[...r.vendors]}));

/* ---------- derived helpers (pure) ---------- */
export const STATUS = {instock:"In stock",drafts:"Drafts to send",sent:"RFQ sent",hod:"With HOD",approved:"Approved",sentback:"Sent back"};
export const statusOf = r => STATUS[r.stage];
export const hasReport = r => ["hod","approved","sentback"].includes(r.stage);
export const repliedVendors = r => hasReport(r) ? r.vendors : r.stage==="sent" ? r.vendors.slice(0,r.replied) : [];
export const ranked = r => Object.entries(r.quotes).map(([v,q])=>({v,...q})).sort((a,b)=>(a.rank||99)-(b.rank||99));
export const recQ = r => r.quotes[r.rec];
export const pmName = r => USERS[r.pm].name;
export const nextStep = r => ({instock:"Served from stock",drafts:`Send ${r.vendors.length-r.sent.length} RFQ drafts`,sent:`Waiting for vendors · ${r.replied} of ${r.vendors.length}`,
  hod:"Waiting for HOD",approved:"Done · "+r.rec,sentback:"HOD sent back"}[r.stage]);

/* ---------- emails drafted by Clay ---------- */
export function rfqMail(r,v){
  return {to:`${v} <[email]>`, subj:`RFQ · ${r.id} · ${r.title} · Vinayak ${r.project}`,
  body:`Dear ${P("contact name")},

Vinayak Group requests your best quotation for:

${r.rfqLines.map((l,i)=>`  ${i+1}. ${l}`).join("\n")}

Delivery to: ${P(r.project+" site address")}
Needed by: ${r.needBy}

Please reply to this email with:
  • Rate per unit, ex-GST
  • Freight, if any
  • Delivery days
  • Payment terms

Please quote the exact grade asked for. If you can only offer a different grade, say so clearly.

Reply by: ${P("reply deadline")}

Regards,
${pmName(r)}
Project Manager, Vinayak ${r.project}
Vinayak Group`};
}
export function hodMail(r){
  const q = recQ(r), nx = ranked(r).find(x=>x.rank===2);
  return {to:"Vikram (HOD)", subj:`Approval needed · ${r.id} · ${r.rec} · ${q.total}`,
  body:`Vikram,

Clay has ranked ${r.vendors.length} quotes for ${r.id} (Vinayak ${r.project}).
${r.title} · needed by ${r.needBy}

Recommended: ${r.rec}
${q.total} ex-GST · ${q.days} · ${q.terms} · score ${q.score}
${nx?`\nNext best: ${nx.v}, ${nx.total} (${nx.diff}), ${nx.terms.toLowerCase()}.\n`:""}
Approve or send back: ${P("approval link")}
You can also reply on WhatsApp.

Clay recommends. People decide.
— Clay, for ${pmName(r)} (PM, Vinayak ${r.project})`};
}
export function replyText(r,v){
  const q = r.quotes[v];
  return q.unranked ? `${q.said}. ${P("rest of reply")}` : `Quote: ${q.quoted}${q.extra&&!q.extra.includes("ex-GST")?" · "+q.extra.toLowerCase():""} · delivery ${q.days} · ${q.terms}.`;
}

/* ---------- activity log, derived from request state ---------- */
export function logRows(reqs){
  const L = [];
  reqs.forEach(r=>{
    L.push(["WhatsApp","In",r.by,"Clay",r.id,r.english,"Received"]);
    L.push(["WhatsApp","Out","Clay",r.by,r.id,r.stockReply||`Short on stock. RFQ drafted for ${pmName(r)}.`,"Delivered"]);
    r.vendors.forEach(v=>{ if(r.sent.includes(v)) L.push(["Email","Out",pmName(r)+" (via Clay)",v,r.id,"RFQ: "+r.title,"Delivered"]); });
    repliedVendors(r).forEach(v=>L.push(["Email","In",v,"Clay",r.id,replyText(r,v),"Parsed"]));
    if(hasReport(r)){ L.push(["Email","Out","Clay","Vikram",r.id,`Approval needed: ${r.rec} · ${recQ(r).total}`,"Delivered"]);
      L.push(["WhatsApp","Out","Clay","Vikram",r.id,`Approval needed: ${r.rec} · ${recQ(r).total}`,"Read"]);
      r.qa.forEach(([q,a])=>{ L.push(["WhatsApp","In","Vikram","Clay",r.id,q,"Received"]); L.push(["WhatsApp","Out","Clay","Vikram",r.id,a,"Delivered"]); }); }
    if(r.stage==="approved" && r.decision.via==="WhatsApp") L.push(["WhatsApp","In","Vikram","Clay",r.id,"Approve","Received"]);
  });
  return L;
}

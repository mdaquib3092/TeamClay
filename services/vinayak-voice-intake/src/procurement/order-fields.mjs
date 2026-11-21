import {normalize} from "./stock-lookup.mjs";

const day=86400000;
export const indiaDay=ms=>new Date(ms+19800000).toISOString().slice(0,10);
const move=(iso,n)=>new Date(Date.parse(iso)+n*day).toISOString().slice(0,10);
export const suggestedDeadline=(today,need)=>[need,move(today,1)].sort()[0];
const units={bag:"bag",sack:"bag",sacks:"bag",bori:"bag",boriya:"bag",pack:"pack",packet:"pack",packets:"pack",kit:"pack",kits:"pack",kg:"kg",kgs:"kg",kilo:"kg",kilos:"kg",kilogram:"kg",mt:"mt",ton:"mt",tons:"mt",tonne:"mt",tonnes:"mt",litre:"ltr",liter:"ltr",ltr:"ltr",ltrs:"ltr",cft:"cft",cum:"cum",nos:"nos",piece:"nos",coil:"coil",sqft:"sqft",sheet:"sheet",rft:"rft",m:"m",metre:"m",meter:"m",meters:"m",metres:"m"};
const spoken={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100,thousand:1000};
const numberWords=new RegExp(`\\b(?:${Object.keys(spoken).join("|")})(?:[ -]+(?:and[ -]+)?(?:${Object.keys(spoken).join("|")}))*\\b`,"g");
export function orderText(input){
  return normalize(input).replace(/[’‘]/g,"'").replace(/[०-९০-৯]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x9e6?0x9e6:0x966)))
    .replace(/पी\s*पी\s*सी|পি\s*পি\s*সি|\bp[\s.]+p[\s.]+c\b/gi,"ppc").replace(/ओ\s*पी\s*सी|ও\s*পি\s*সি|\bo[\s.]+p[\s.]+c\b/gi,"opc")
    .replace(/बैग|बोरियां|बोरियाँ|बोरी|ব্যাগ|বস্তা/g," bag ").replace(/पैक|প্যাক/g," pack ")
    .replace(/सीएफटी/g," cft ").replace(/किलो|কেজি/g," kg ").replace(/दस|দশ/g,"10").replace(/कृपया/g," please ")
    .replace(/पचास|পঞ্চাশ/g,"50").replace(/सौ|একশো/g,"100").replace(/कल|আগামীকাল/g," tomorrow ").replace(/आज|আজ/g," today ")
    .replace(/\bmetric ton(?:ne)?s?\b/g,"mt").replace(/\bcubic (?:feet|foot)\b/g,"cft").replace(/\bsquare (?:feet|foot)\b/g,"sqft")
    .replace(/\bcubic met(?:er|re)s?\b/g,"cum").replace(/\bportland pozzolana\b/g,"ppc")
    .replace(/\b(fe|sdr)\s*[- ]\s*(\d+)/g,"$1$2").replace(/\b(\d+) millimet(?:er|re)s?\b/g,"$1mm")
    .replace(/(\d),(?=\d{3}\b)/g,"$1").replace(numberWords,s=>{
      let sum=0,group=0;for(const w of s.split(/[ -]+/)){if(w==="and")continue;const n=spoken[w];if(n===100)group=(group||1)*100;else if(n===1000){sum+=(group||1)*1000;group=0;}else group+=n;}return String(sum+group);
    }).replace(/\s+/g," ").trim();
}
const month=/jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/.source;
const calendar=new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${month})(?:[ ,]+\\d{4})?|(?:${month})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:[ ,]+\\d{4})?|day after tomorrow|tomorrow|today|next week|(?:next |this |coming )?(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)|(?:in |within |after )?\\d+\\s+(?:days?|weeks?)(?: from now| from today)?)(?![\\p{L}\\p{N}])|(?<![\\w+])\\+\\d{1,3}\\b`,"giu");
const monthNames="jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function resolveDate(s,today){
  if(s==="today")return today;if(s==="tomorrow")return move(today,1);if(s==="day after tomorrow")return move(today,2);if(s==="next week")return move(today,7);
  if(s[0]==="+")return move(today,Number(s.slice(1)));
  const relative=/(\d+)\s+(days?|weeks?)/.exec(s);if(relative){const n=Number(relative[1])*(relative[2].startsWith("week")?7:1);return n<=999?move(today,n):null;}
  const week=/^(?:next |this |coming )?(sun|mon|tue|wed|thu|fri|sat)/.exec(s);
  if(week){const target=["sun","mon","tue","wed","thu","fri","sat"].indexOf(week[1]),n=(target-new Date(today).getUTCDay()+7)%7;return move(today,n||(/next|coming/.test(s)?7:0));}
  let y,m,d;
  if(/^\d{4}-/.test(s))[y,m,d]=s.split("-").map(Number);
  else if(/^\d+[/.]/.test(s))[d,m,y]=s.split(/[/.]/).map(Number);
  else{
    const a=s.match(/\d+/g),name=new RegExp(month,"i").exec(s)?.[0];if(!a||!name)return null;
    d=Number(a[0]);m=monthNames.indexOf(name.slice(0,3))+1;y=Number(a[1]||today.slice(0,4));
    if(!a[1]&&m<Number(today.slice(5,7)))y++;
  }
  const iso=`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  return /^\d{4}-\d\d-\d\d$/.test(iso)&&Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().startsWith(iso)?iso:null;
}
const replyLabel=/\b(?:quotes?|quotations?|vendor repl(?:y|ies)|responses?|bids?|rfqs?|reply|replies|respond|prices?)\s*(?:(?:should|must|can|to|are|be|come|in|back|due|needed|deadline|from vendors|by|on|within|in|please)\s*)*(?:[:=-]\s*)?$/i;
export function logistics(input,today,wait){
  const q=orderText(input),dates={},issues={};let last=0,stripped="";
  for(const a of q.matchAll(calendar)){
    const left=q.slice(last,a.index),key=replyLabel.test(left)?"due":
      /\b(?:delivery|deliver|material|need(?:ed)?|required|on[- ]site|arrival|chahiye)\b/.test(left)?"need":
      wait==="due"&&!Object.hasOwn(dates,"due")?"due":"need";
    const value=resolveDate(a[0],today);
    if(!value||value<today||Object.hasOwn(dates,key)&&value!==dates[key]){dates[key]=null;issues[key]=true;}
    else dates[key]=value;
    stripped+=left+" | ";last=a.index+a[0].length;
  }
  stripped+=q.slice(last);
  // A floor/tower number is not an order quantity. Stop before another
  // field, including relative dates, and keep the project address separate.
  let site=null;
  const address=/\b(?:project address|registered (?:site|address)|usual (?:project )?address|main (?:site )?gate|site gate|project gate)\b/.exec(stripped);
  const siteRe=/\b(?:(?:tower|block)\s+(?:[a-z]\d*|\d+[a-z]?)|basement(?:\s+(?:lift pit|slab|store|parking|waterproofing|level\s+\d+))?|podium(?:\s+(?:slab|deck|level\s+\d+))?|main (?:store|gate)|site store|north gate|south gate|east gate|west gate|floor\s+[a-z0-9-]+|(?:ground|first|second|third|\d+(?:st|nd|rd|th)?)\s+floor|lift pit|warehouse\s+[a-z0-9-]+)(?:\s*[-,]\s*(?:bay|floor|wing|level|block|tower)\s+[a-z0-9-]+)?\b/i;
  const label=/\b(?:deliver(?:y)?\s+(?:point|location|address|to|at)|drop(?:[- ]?off)?(?:\s+(?:point|at))?|location|site area|at)\s*[:=-]?\s+(?!by\b|on\b|in\b|least\b|most\b|\d+[/])([^|,;.!?\n]{1,100})/i.exec(stripped);
  const point=address||siteRe.exec(stripped);
  if(point){site=point[0];stripped=stripped.replace(point[0]," | ");}
  else if(label){
    const candidate=label[1].split(/\s+(?:by|need(?:ed)?|required|quotes?|reply|within|for delivery)\b/)[0].trim();
    if(candidate&&candidate.length<81){site=candidate;stripped=stripped.replace(candidate," | ");}
  }
  return {dates,issues,site,remaining:stripped};
}
const qtyUnits=Object.keys(units).sort((a,b)=>b.length-a.length).join("|");
const countRegex=new RegExp(`(?<![\\p{L}\\d.+-])([+-]?\\d+(?:\\.\\d+)?)\\s*(${qtyUnits})(?![\\p{L}\\d])`,"giu");
const token=s=>s.match(/[a-z0-9]+(?:[.x][a-z0-9]+)*/g)||[];
const common=new Set([...Object.keys(units),"for","in","is","of","to","and","with","length","grade","size","on","at","per","i","need","a","the"]);
function candidates(text,catalog,restrict){
  let pool=restrict?.length?catalog.filter(m=>restrict.includes(m.material_code)):catalog;
  const codes=text.match(/\bmat\d+\b/g);
  if(codes)return [...new Set(codes.flatMap(c=>pool.filter(m=>m.material_code.toLowerCase()===c)))];
  const data=pool.map(m=>({m,name:token(orderText(m.material_name||"")),cat:token(orderText(m.category||""))}));
  const known=new Set(data.flatMap(x=>[...x.name,...x.cat]));
  const grade=/\b(?:opc|grade)\s*(\d{2})\b/.exec(text);
  const tokens=[...new Set([...token(text).filter(w=>!common.has(w)&&(known.has(w)||/^\d+(?:\.\d+)?mm$|^fe\d+[a-z]*$|^sdr\d+$/.test(w))),...(grade?[grade[1]]:[])])];
  if(!tokens.length)return [];
  const byName=data.filter(x=>tokens.every(w=>x.name.includes(w)));
  return (byName.length?byName:data.filter(x=>tokens.every(w=>x.name.includes(w)||x.cat.includes(w)))).map(x=>x.m);
}
const validQty=n=>Number.isFinite(n)&&n>0&&n<=1e6&&Math.abs(n*1000-Math.round(n*1000))<1e-6;
export function lineFrom(input,catalog,options={}){
  let text=orderText(input),approx=/\b(?:about|around|approximately|approx|roughly|estimate[ds]?)\s+\d/.test(text);
  // Shield an explicitly labelled pack size, not an arbitrary differently
  // dimensioned request. Never silently convert kg to bags or MT.
  text=text.replace(/\b\d+(?:\.\d+)?\s*kg\s+(?:each|per (?:bag|pack))\b|\b(?:bag|pack) size\s*[:=]?\s*\d+(?:\.\d+)?\s*kg\b/g," ");
  const measures=[...text.matchAll(countRegex)].map(m=>({n:Number(m[1]),u:units[m[2]]}));
  const remainder=text.replace(countRegex," ").replace(/\b\d+(?:\.\d+)?\s*mm\b/g,s=>s.replace(/\s/g,""));
  const optionsFound=candidates(remainder,catalog,options.restrict);
  const bareSource=remainder.replace(/\b(?:is\s+\d+(?:-\d+)?|(?:opc|grade|gauge|sdr)\s*\d+|\d+\s*gauge|\d+\s+grade|mat\d+|fe\d+[a-z]*|\d+(?:\.\d+)?(?:mm|sqmm)|\d+(?:x\d+)+(?:\.\d+)?)\b/g," ");
  const bare=[...bareSource.matchAll(/(?<![\p{L}\d.])([+-]?\d+(?:\.\d+)?)(?![\p{L}\d.])/gu)].map(m=>Number(m[1]));
  const amounts=[...new Set([...measures.map(x=>x.n),...bare])];
  const unitSet=[...new Set(measures.map(x=>x.u))];
  const conflict=amounts.length>1||unitSet.length>1||/\b(?:between|either)\b.{0,25}\d|(?:\d)\s*[-–]\s*\d/.test(text);
  const n=amounts.length===1&&validQty(amounts[0])&&!conflict?amounts[0]:null;
  const unsupported=/\b\d+(?:\.\d+)?\s*(pallets?|truckloads?|trucks?|cartons?|drums?|bundles?)\b/.exec(text);
  return {choices:optionsFound.map(m=>m.material_code),code:optionsFound.length===1?optionsFound[0].material_code:null,
    n,unit:unsupported?unsupported[1]:unitSet.length===1?unitSet[0]:null,conflict:conflict?amounts.slice(0,4).sort((a,b)=>a-b):null,approx,
    explicitQty:amounts.length>0||measures.length>0,unknownCode:!!text.match(/\bmat\d+\b/)&&!optionsFound.length};
}
export const orderIntent=text=>{
  if(/\b(?:do not|don't|dont|not yet|never|no need to)\b.{0,25}\b(?:order|raise|buy|procure|need|create)\b|\b(?:sample message|example order|hypothetical|just an example|how (?:do|can|would) (?:i|we)|what if|if (?:we|i) need|order (?:history|status)|track (?:my|the) order|need to know|want to know|need (?:help|information) (?:about|on)|i ordered|we ordered)\b/.test(text))return false;
  if(/\b(?:how (?:much|many)|do we have|in stock|check (?:the )?stock|stock of|stock balance|available|enough|what is|what's)\b/.test(text)&&!/\b(?:place (?:an? |the )?order|please (?:order|procure)|raise (?:an? )?rfq)\b/.test(text))return false;
  return /\b(?:place|start|make|create|raise|prepare|generate|submit|put (?:in|through))\s+(?:(?:a|an|the|my|this|that|new|material|purchase|site)\s+)*(?:order|requisition|requirement|request|rfq)\b|\b(?:i|we|site)\s+(?:would like|want|need|require)(?:\s|$)|\b(?:can you|could you|please|help me|help us|need to)\s+(?:please\s+)?(?:order|buy|purchase|procure|arrange|get (?:me|us))\b|^(?:(?:hi|hello|please|kindly|okay|ok|sir)[\s,]+)*(?:order|buy|procure|purchase|arrange|need|require|get (?:me|us)|new order|new requirement|new request)\b|\b(?:chahiye|mangwa(?:na|o)|order (?:karna|karo)|requirement hai)\b|चाहिए|मंगाना|अॉर्डर|অর্ডার|দরকার/.test(text);
};
export function terseRequisition(text){
  return /\b(?:\d+(?:\.\d+)?\s*(?:bags?|packs?|mt|kg|ltr|cft|cum|sheets?|coils?|nos|tonnes?)|mat\d+\s*[-:x]?\s*\d+)\b/.test(text)&&
    !/[?]|\b(?:stock|available|enough|have|ordered|received|delivered|invoiced|example|sample|if|could|would|can i|how|why|what is|was|used|paid|price|rate|last|not|cancel|do not|don't)\b/.test(text)&&
    /^(?:\d|mat\d|material|boq|requirement|ppc|opc|cement|tmt|steel|rebar|river sand|brushbond)/.test(text);
}
export const inquiry=text=>/\b(?:stock|inventory|availability|enough|how (?:much|many)|do we have|show|who|what is|what's|where is|status of)\b/.test(text)&&!orderIntent(text);
export const bestPrevious=(prior,catalog)=>{
  for(const s of prior||[]){const c=candidates(orderText(s),catalog);if(c.length)return c.length===1?c[0].material_code:null;}
  return null;
};
export const unitLabel=u=>({bag:"bags",pack:"packs",ltr:"litres",nos:"pieces",sheet:"sheets",coil:"coils"}[u]||u);

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runScenario} from "./rfq-rehearsal.mjs";
import {samples} from "../src/procurement/samples.mjs";

const read=url=>fs.readFileSync(new URL(url,import.meta.url),"utf8");
export async function publicSamples(templateRoot=fileURLToPath(new URL("../../../",import.meta.url))) {
  const team=["site_engineer","project_manager","hod"].map((role,i)=>({
    role,name:["Site engineer","Project manager","HOD"][i],user_id:["S","P","H"][i],project_id:i===2?"ALL":"P",whatsapp:`+1202555010${i+1}`,
  }));
  // No live root, database, roster, transport or environment file is passed.
  // The rehearsal constructs its own demo catalog and in-memory database.
  return Promise.all(samples.map(async s=>{
    const run=await runScenario({key:s.key,team,templateRoot});
    if(run.stage!=="APPROVED"||run.record.vendors.some(v=>!v.email.endsWith("@example.test")))throw Error("Invalid public rehearsal");
    return {key:s.key,label:s.label,title:s.title,steps:run.steps,pick:s.pick,reason:s.reason,
      lines:run.record.lines.map(({code,name,requested,stock,qty,unit})=>({code,name,requested,stock,qty,unit})),
      vendors:run.record.vendors.map(({id,name,history})=>({id,name,history})),replies:s.replies};
  }));
}
export async function cloudRelease(root) {
  const dist=path.join(root,"Frontend/dist");
  const files={"/":fs.readFileSync(path.join(dist,"index.html"),"utf8").replaceAll('href="./assets/','href="/desk/assets/').replaceAll('src="./assets/','src="/desk/assets/')};
  for(const name of fs.readdirSync(path.join(dist,"assets")))if(/^[\w.-]+\.(js|css)$/.test(name))files["/assets/"+name]=fs.readFileSync(path.join(dist,"assets",name),"utf8");
  const source=`const FILES=${JSON.stringify(files)};\nconst PM_PAGE=${JSON.stringify(read("../src/cloud/pm.html"))};\nconst PUBLIC_SAMPLES=${JSON.stringify(await publicSamples(root))};\n${read("../src/cloud/edge.mjs")}`;
  return {main:"cloud/edge.mjs",source,modules:[
    {filename:"cloud/public-desk.mjs",content:read("../src/cloud/public-desk.mjs"),contentType:"application/javascript+module"},
    {filename:"procurement/quote-terms.mjs",content:read("../src/procurement/quote-terms.mjs"),contentType:"application/javascript+module"},
  ]};
}

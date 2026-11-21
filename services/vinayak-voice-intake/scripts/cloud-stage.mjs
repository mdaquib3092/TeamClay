// Short-lived loopback handoff for deploying with Cloudflare MCP; never serves
// from the public origin or includes Gmail, WhatsApp or model credentials.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {randomBytes} from "node:crypto";
import {loadGmailConfig} from "../../vinayak-procurement/integrations/gmail/config.mjs";
const home=path.join(os.homedir(),"Library/Application Support/TeamClay/Cloudflare");
process.umask(0o077); fs.mkdirSync(home,{recursive:true,mode:0o700});
const originKey=path.join(home,"origin.key");
if(!fs.existsSync(originKey))fs.writeFileSync(originKey,randomBytes(48).toString("base64url"),{flag:"wx",mode:0o600});
const gmail=await loadGmailConfig(), nonce=randomBytes(24).toString("hex");
const port=18794, dist=path.join(os.homedir(),"Downloads/TeamClay/Frontend/dist");
const server=http.createServer(async(req,res)=>{
  const done=(status,data)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
  if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin||req.headers["sec-fetch-site"]||!req.url.startsWith(`/${nonce}/`))return done(403,{});
  const route=req.url.slice(nonce.length+2);
  try{
    if(route==="settings"&&req.method==="GET")return done(200,{owner:gmail.expectedEmail,key:fs.readFileSync(originKey,"utf8")});
    if(route==="token"&&req.method==="POST"){
      let token="";for await(const chunk of req){token+=chunk;if(token.length>5000)return done(413,{});}
      const j=JSON.parse(Buffer.from(token,"base64").toString());
      if(j.t!=="f8796cf9-f0f9-43c8-a7cf-9d0fcfbab633"||j.a!=="d326e176c8f3338028cf9250b369f0ce"||!j.s)return done(400,{});
      fs.writeFileSync(path.join(home,"tunnel.token"),token,{mode:0o600});return done(200,{stored:true});
    }
    if(route==="release"&&req.method==="GET"){
      const assets={"/":fs.readFileSync(path.join(dist,"index.html"),"utf8").replaceAll('href="./assets/','href="/desk/assets/').replaceAll('src="./assets/','src="/desk/assets/')};
      for(const name of fs.readdirSync(path.join(dist,"assets")))if(/^[\w.-]+\.(js|css)$/.test(name))assets["/assets/"+name]=fs.readFileSync(path.join(dist,"assets",name),"utf8");
      const worker=fs.readFileSync(new URL("../src/cloud/edge.mjs",import.meta.url),"utf8");
      const pm=fs.readFileSync(new URL("../src/cloud/pm.html",import.meta.url),"utf8");
      return done(200,{source:`const FILES=${JSON.stringify(assets)};\nconst PM_PAGE=${JSON.stringify(pm)};\n${worker}`});
    }
    if(route==="close"&&req.method==="POST"){done(200,{closed:true});server.close();return;}
    done(404,{});
  }catch{done(500,{error:"Staging artifact unavailable"});}
});
server.listen(port,"127.0.0.1",()=>console.log(`http://127.0.0.1:${port}/${nonce}`));
setTimeout(()=>server.close(),40*60_000).unref();

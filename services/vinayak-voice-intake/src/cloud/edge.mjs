// FILES and PM_PAGE are injected from the production build during MCP upload.
const ORIGIN="http://127.0.0.1:8791", HOST="clay-procurement.teamclay-d326e1.workers.dev";
const ISS="https://teamclay-d326e1.cloudflareaccess.com", AUD="37bf7443167d110bdf159c20a997eb046615b80bc122e4024fea673d015aab47";
const deskRead=/^\/(?:api\/(?:integration|workspace|source|sources|capabilities|export)|local-api\/(?:catalog|status|roles|messages|voice-notes|procurement\/(?:cases|samples\/(?:cement|steel|waterproofing))))$/;
const deskWrite=/^\/api\/(?:integration|actions|extract)$/;
const headers={"cache-control":"private,no-store","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer","permissions-policy":"camera=(),geolocation=()"};
const htmlHeaders={...headers,"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
function bytes(s){return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));}
let cached;
async function owner(request,env){
  try{
    const token=request.headers.get("Cf-Access-Jwt-Assertion")||"";
    const parts=token.split(".");if(parts.length!==3||token.length>16000)return false;
    const [hdr,claims]=parts.slice(0,2).map(s=>JSON.parse(new TextDecoder().decode(bytes(s))));
    const now=Date.now()/1000;
    if(hdr.alg!=="RS256"||!hdr.kid||claims.iss!==ISS||!Array.isArray(claims.aud)||!claims.aud.includes(AUD)||!Number.isFinite(claims.exp)||claims.exp<=now||claims.nbf>now+30||typeof claims.email!=="string"||claims.email.toLowerCase()!==env.OWNER_EMAIL)return false;
    if(!cached||cached.until<Date.now()){
      const r=await fetch(ISS+"/cdn-cgi/access/certs",{redirect:"error"});if(!r.ok)return false;
      cached={until:Date.now()+300000,keys:(await r.json()).keys};
    }
    const key=cached.keys.find(k=>k.kid===hdr.kid&&k.kty==="RSA");if(!key)return false;
    const pk=await crypto.subtle.importKey("jwk",key,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5",pk,bytes(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  }catch{return false;}
}
function fail(status,error){return Response.json({error},{status,headers});}
async function origin(request,env,target,pm=false){
  const h=new Headers({"x-clay-origin":env.ORIGIN_KEY});
  if(pm){const cookies=(request.headers.get("cookie")||"").split(";").map(s=>s.trim()).filter(s=>/^__Secure-clay-(?:challenge|session)=[a-f0-9]{64}$/.test(s));h.set("cookie",cookies.join("; "));}
  if(request.headers.has("content-type"))h.set("content-type",request.headers.get("content-type"));
  const reply=await env.PRIVATE_ORIGIN.fetch(ORIGIN+target,{method:request.method,headers:h,body:request.method==="POST"?request.body:undefined,redirect:"manual"});
  const output=new Headers(headers);for(const k of ["content-type","content-disposition"])if(reply.headers.has(k))output.set(k,reply.headers.get(k));
  if(pm)for(const c of reply.headers.getAll("Set-Cookie"))if(c.startsWith("__Secure-clay-"))output.append("set-cookie",c);
  return new Response(reply.body,{status:reply.status,headers:output});
}
export default {async fetch(request,env){
  try{
    const u=new URL(request.url);if(u.hostname!==HOST||u.protocol!=="https:")return fail(404,"Not found.");
    if(!["GET","POST","HEAD"].includes(request.method))return fail(405,"Method not allowed.");
    const p=u.pathname;
    if(request.method==="POST"&&(request.headers.get("origin")!==u.origin||request.headers.get("sec-fetch-site")==="cross-site"))return fail(403,"Submit from the Clay dashboard.");
    if(p==="/"&&request.method==="GET")return Response.redirect(u.origin+"/desk/#live-cases",302);
    if(p==="/healthz"&&request.method==="GET")return origin(request,env,"/healthz");
    // This unauthenticated shell contains no vendor/case information. All data
    // and mutations on its API require the case-bound PM verification session.
    if(/^\/pm\/CASE-[A-F0-9]{12}\/?$/.test(p)&&request.method==="GET"){
      if(!p.endsWith("/"))return Response.redirect(u.origin+p+"/",302);
      const nonce=crypto.randomUUID().replaceAll("-","");
      return new Response(PM_PAGE.replace('id="pm-script"',`id="pm-script" nonce="${nonce}"`),{headers:{...htmlHeaders,
        "content-security-policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`}});
    }
    const m=/^\/pm\/CASE-[A-F0-9]{12}\/(challenge|verify|review|approve)$/.exec(p);
    if(m){
      if(u.search||(m[1]==="review"?request.method!=="GET":request.method!=="POST"))return fail(405,"Use the PM review form.");
      if(request.method==="POST"&&Number(request.headers.get("content-length")||0)>4200)return fail(413,"Submission too large.");
      if(["challenge","verify"].includes(m[1])&&env.LOGIN_LIMIT&&!(await env.LOGIN_LIMIT.limit({key:request.headers.get("cf-connecting-ip")||"unknown"})).success)return fail(429,"Try again in a minute.");
      return origin(request,env,p,true);
    }
    if(p!=="/desk"&&!p.startsWith("/desk/"))return fail(404,"Not found.");
    if(!(await owner(request,env)))return fail(403,"Sign in to the owner’s Cloudflare Access workspace.");
    if(p==="/desk")return Response.redirect(u.origin+"/desk/#live-cases",302);
    const relative=p.slice(5)||"/";
    if(request.method==="GET"&&Object.hasOwn(FILES,relative)){
      const isPage=relative==="/";return new Response(FILES[relative],{headers:isPage?htmlHeaders:{...headers,"content-type":relative.endsWith(".js")?"text/javascript; charset=utf-8":"text/css; charset=utf-8"}});
    }
    if((request.method==="GET"&&deskRead.test(relative))||(request.method==="POST"&&deskWrite.test(relative)))return origin(request,env,relative+u.search);
    return fail(404,"Unknown workspace route.");
  }catch{return fail(503,"The private procurement origin could not be reached.");}
}};

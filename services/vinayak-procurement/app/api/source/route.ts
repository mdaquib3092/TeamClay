import sources from '@/lib/source-manifest.json';
import { identity,bindings,errorResponse,HttpError } from '@/lib/server';
export async function GET(request:Request){try{
 const user=await identity();const url=new URL(request.url);const name=url.searchParams.get('name');const id=url.searchParams.get('attachmentId');
 if(id){const {db,bucket}=bindings();if(!bucket)throw new HttpError(503,'File storage unavailable.');const entry=await db.prepare('SELECT * FROM attachments WHERE id = ? AND owner_id = ?').bind(id,user.userId).first<{object_key:string,name:string,media_type:string}>();if(!entry)throw new HttpError(404,'File not found.');const obj=await bucket.get(entry.object_key);if(!obj)throw new HttpError(404,'File not found.');const safeInline=/^(application\/pdf|text\/(plain|csv))(?:;|$)/i.test(entry.media_type);return new Response(obj.body,{headers:{'Content-Type':safeInline?entry.media_type:'application/octet-stream','Content-Disposition':`${safeInline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(entry.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});}
 if(!name||!sources.some(s=>s.name===name))throw new HttpError(404,'Source file not found.');
 return Response.redirect(new URL('/source/'+encodeURIComponent(name),request.url),302);
}catch(e){return errorResponse(e);}}

import type { WorkspaceAction } from '@/lib/types';
import { identity, mutateWorkspace, checkOrigin, json, errorResponse, HttpError } from '@/lib/server';
export async function POST(request: Request) {
 try {
  checkOrigin(request); const user=await identity();
  if(Number(request.headers.get('content-length')||0)>2000000) throw new HttpError(413,'This update is too large.');
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>2000000) throw new HttpError(413,'This update is too large.');
  let body:{revision:number;action:WorkspaceAction};
  try { body=JSON.parse(raw); } catch { throw new HttpError(400,'Submit a valid JSON workspace action.'); }
  if (!body || typeof body!=='object' || !body.action || typeof body.action.type !== 'string') throw new HttpError(400,'Choose a valid workspace action.');
  return json(await mutateWorkspace(user.userId,body.revision,body.action,user.displayName));
 } catch(e) { return errorResponse(e); }
}

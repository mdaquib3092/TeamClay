import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { createWorkspace, applyAction } from './domain';
import type { Workspace, WorkspaceAction } from './types';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function identity() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, 'Sign in to open your private procurement workspace.');
  return user;
}
export function bindings() {
  if (!env.DB) throw new HttpError(503, 'Workspace database is unavailable.');
  return { db: env.DB, bucket: env.BUCKET };
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Please submit this action from the procurement workspace.');
}
export async function readWorkspace(ownerId: string): Promise<Workspace> {
  const { db } = bindings();
  let row = await db.prepare('SELECT state FROM workspaces WHERE owner_id = ?').bind(ownerId).first<{state:string}>();
  if (!row) {
    const initial = createWorkspace();
    await db.prepare('INSERT OR IGNORE INTO workspaces (owner_id, revision, state, updated_at) VALUES (?, ?, ?, ?)')
      .bind(ownerId, initial.revision, JSON.stringify(initial), new Date().toISOString()).run();
    row = await db.prepare('SELECT state FROM workspaces WHERE owner_id = ?').bind(ownerId).first<{state:string}>();
  }
  if (!row) throw new HttpError(503, 'Could not open the workspace.');
  return JSON.parse(row.state);
}
export async function mutateWorkspace(ownerId: string, revision: number, action: WorkspaceAction, actor: string) {
  if (!Number.isInteger(revision) || revision < 0) throw new HttpError(400, 'A valid workspace revision is required.');
  const workspace = await readWorkspace(ownerId);
  if (workspace.revision !== revision) throw new HttpError(409, 'This workspace changed in another tab. Refresh before saving your changes.');
  let next: Workspace;
  try { next = applyAction(workspace, action, actor); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid action.'); }
  next.revision = revision + 1;
  const {db} = bindings();
  const saved = await db.prepare('UPDATE workspaces SET state = ?, revision = ?, updated_at = ? WHERE owner_id = ? AND revision = ?')
    .bind(JSON.stringify(next), next.revision, new Date().toISOString(), ownerId, revision).run();
  if (saved.meta.changes !== 1) throw new HttpError(409, 'Another change was saved first. Refresh and try again.');
  return next;
}
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'} }); }
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return json({error:error.message},error.status);
  console.error('Procurement request failed', error instanceof Error ? error.message : 'Unknown error');
  return json({error:'The request could not be completed. Please try again.'},500);
}

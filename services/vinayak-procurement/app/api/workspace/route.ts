import { identity, readWorkspace, json, errorResponse } from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET() { try { const user=await identity(); return json(await readWorkspace(user.userId)); } catch(e) { return errorResponse(e); } }

import { env } from 'cloudflare:workers';
import { json, identity, errorResponse } from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET() { try { await identity(); const config=env as unknown as Record<string,unknown>;return json({ai:!!config.OPENAI_API_KEY,extraction:['text','pdf','xlsx'],rfqTransport:'internal-test-inbox',erp:'export-only',approval:'in-app-human-review',history:'user-recorded'}); }catch(e){return errorResponse(e);} }

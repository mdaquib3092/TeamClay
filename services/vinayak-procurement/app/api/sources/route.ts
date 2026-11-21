import sources from '@/lib/source-manifest.json';
import { identity,json,errorResponse } from '@/lib/server';
export async function GET(){ try {await identity();return json({sources});}catch(e){return errorResponse(e);} }

import { compareQuotes, draftRfq, matchItems, parseQuote, parseRequirement, SCORE_WEIGHTS, MIN_RFQ_VENDORS } from '@/lib/domain';
import { checkOrigin, errorResponse, HttpError, identity, json, readWorkspace } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The alternate React frontend uses the same saved workspace and domain rules. */
export async function GET() {
  try {
    const user = await identity();
    const workspace = await readWorkspace(user.userId);
    return json({
      identity: { id: user.userId, name: user.displayName },
      workspace,
      comparisons: Object.fromEntries(workspace.requests.map(request => [request.id, compareQuotes(workspace, request.id)])),
      matches: Object.fromEntries(workspace.requests.map(request => [
        request.id,
        Object.fromEntries(request.lines.map(line => [line.id, matchItems(`${line.code} ${line.description} ${line.specification}`, workspace.items)])),
      ])),
      drafts: Object.fromEntries(workspace.requests.map(request => [
        request.id, Object.fromEntries(workspace.vendors.map(vendor => [vendor.id, draftRfq(request, vendor)])),
      ])),
      policy: {
        minimumRfqVendors: MIN_RFQ_VENDORS,
        weights: SCORE_WEIGHTS,
        rfqTransport: 'internal-test-inbox',
        approval: 'signed-in-owner-human-review',
        enterpriseRoles: false,
        workOrdersEnabled: false,
      },
    });
  } catch (error) { return errorResponse(error); }
}

/** Assistance creates drafts only; existing /api/actions performs every mutation. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await identity();
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 400_000) throw new HttpError(413, 'Use a shorter source text.');
    let body: { operation?: string; text?: string; requestId?: string };
    try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Submit a valid assistance request.'); }
    if (!body || typeof body.text !== 'string') throw new HttpError(400, 'Source text is required.');
    if (body.operation === 'parse_requirement') return json(parseRequirement(body.text));
    if (body.operation === 'parse_quote') {
      const workspace = await readWorkspace(user.userId);
      const requirement = workspace.requests.find(item => item.id === body.requestId);
      if (!requirement) throw new HttpError(404, 'Requirement not found.');
      return json(parseQuote(body.text, requirement));
    }
    throw new HttpError(400, 'Choose requirement or quotation assistance.');
  } catch (error) { return errorResponse(error); }
}

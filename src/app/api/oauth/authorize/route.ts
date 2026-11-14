import { NextResponse } from 'next/server';
import { syncIn, syncOut } from '@/lib/server/store';
import { actorForUser, errorResponse, getActorFromRequest, jsonResponse, publicOrigin } from '@/lib/server/api-helpers';
import { readCookie, verifySessionToken } from '@/lib/server/auth';
import { ServiceError } from '@/lib/server/services';
import { db } from '@/lib/server/db';
import { OAuthError, checkAuthRequest, createCode, mcpFirmEnabled, mcpServerEnabled, type AuthRequest } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

const params = (src: URLSearchParams | FormData): AuthRequest & { decision?: string } => ({
  client_id: String(src.get('client_id') ?? ''),
  redirect_uri: String(src.get('redirect_uri') ?? ''),
  code_challenge: String(src.get('code_challenge') ?? ''),
  code_challenge_method: String(src.get('code_challenge_method') ?? ''),
  scope: String(src.get('scope') ?? ''),
  state: String(src.get('state') ?? ''),
  decision: String(src.get('decision') ?? ''),
});

/** For the consent page: is this request valid, and who is asking for what. Requires a Workpaper session. */
export async function GET(req: Request) {
  if (!mcpServerEnabled()) return jsonResponse({ error: 'Outside assistants are not available on this server.' }, 404);
  try {
    await syncIn();
    const actor = getActorFromRequest(req);
    const r = params(new URL(req.url).searchParams);
    const { client, scope } = await checkAuthRequest(r);
    return jsonResponse({
      client_name: client.client_name,
      redirect_host: new URL(r.redirect_uri).host,
      scope: scope.split(' '),
      user: actor.name,
      role: actor.role,
      practice: db.firms.find((f) => f.id === actor.firmId)?.name,
      practice_enabled: mcpFirmEnabled(actor.firmId),
    });
  } catch (err) {
    if (err instanceof OAuthError) return jsonResponse({ error: err.message }, 400);
    return errorResponse(err);
  }
}

/** The person's decision, posted by the consent page's form; answers with a redirect back to the assistant. */
export async function POST(req: Request) {
  if (!mcpServerEnabled()) return jsonResponse({ error: 'Not found' }, 404);
  // A same-site form post only: another site cannot approve on the user's behalf
  const origin = req.headers.get('origin');
  if (origin && origin !== publicOrigin(req)) return jsonResponse({ error: 'Cross-site request refused.' }, 403);
  try {
    await syncIn();
    // Read-only members may connect too (they get read tools only), so not getActorFromRequest, which refuses their POSTs
    const session = verifySessionToken(readCookie(req));
    if (!session) throw new ServiceError('Please sign in.', 401, 'UNAUTHENTICATED');
    const actor = actorForUser(session.uid);
    const r = params(await req.formData());
    await checkAuthRequest(r); // invalid client or redirect: never redirect anywhere
    const back = new URL(r.redirect_uri);
    if (r.state) back.searchParams.set('state', r.state);
    if (r.decision !== 'allow' || !mcpFirmEnabled(actor.firmId)) {
      back.searchParams.set('error', 'access_denied');
    } else {
      back.searchParams.set('code', await createCode(r, actor));
      db.logAudit(actor.firmId, actor, 'MCP_CONNECTION_APPROVED', 'users', actor.id, null, { client_id: r.client_id, scope: r.scope });
      await syncOut();
    }
    return NextResponse.redirect(back.toString(), 303);
  } catch (err) {
    if (err instanceof OAuthError) return jsonResponse({ error: err.message }, 400);
    return errorResponse(err);
  }
}

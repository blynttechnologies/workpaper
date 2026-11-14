import { NextResponse } from 'next/server';
import { OAuthError, mcpServerEnabled, registerClient } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

/** Dynamic client registration (RFC 7591): public clients only (PKCE, no secret). */
export async function POST(req: Request) {
  if (!mcpServerEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const c = await registerClient(await req.json().catch(() => ({})));
    return NextResponse.json(
      {
        client_id: c.client_id,
        client_name: c.client_name,
        redirect_uris: c.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_id_issued_at: Math.floor(Date.parse(c.created_at) / 1000),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof OAuthError) return NextResponse.json({ error: err.error, error_description: err.message }, { status: err.status });
    throw err;
  }
}

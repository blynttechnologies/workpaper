import { NextResponse } from 'next/server';
import { OAuthError, limited, mcpServerEnabled, registerClient } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

/** Dynamic client registration (RFC 7591): public clients only (PKCE, no secret). */
export async function POST(req: Request) {
  if (!mcpServerEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // The last address in the list is the one the Function URL itself saw; earlier ones are whatever the caller sent
  const ip = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || 'unknown';
  if (limited(`register:${ip}`, 10)) return NextResponse.json({ error: 'Too many registrations. Wait a minute.' }, { status: 429, headers: { 'Retry-After': '60' } });
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

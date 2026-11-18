import { NextResponse } from 'next/server';
import { OAuthError, exchangeCode, mcpServerEnabled, refreshTokens } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

/** Token endpoint: authorization_code (with PKCE) and refresh_token grants. Form-encoded, as OAuth requires; JSON also accepted. */
export async function POST(req: Request) {
  if (!mcpServerEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const type = req.headers.get('content-type') || '';
  const p: Record<string, string> = type.includes('application/json')
    ? // Every value as text, as a form would send it: a number or object where a token belongs is then just a wrong token
      Object.fromEntries(Object.entries((await req.json().catch(() => ({}))) ?? {}).map(([k, v]) => [k, String(v)]))
    : Object.fromEntries(new URLSearchParams(await req.text()));
  const headers = { 'Cache-Control': 'no-store' };
  try {
    if (p.grant_type === 'authorization_code') return NextResponse.json(await exchangeCode(p), { headers });
    if (p.grant_type === 'refresh_token') return NextResponse.json(await refreshTokens(p), { headers });
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  } catch (err) {
    if (err instanceof OAuthError) return NextResponse.json({ error: err.error, error_description: err.message }, { status: err.status, headers });
    throw err;
  }
}

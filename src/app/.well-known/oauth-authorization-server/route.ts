import { NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/server/api-helpers';
import { SCOPES, mcpServerEnabled } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

/** OAuth authorisation server metadata (RFC 8414) for outside assistants connecting to the MCP server. */
export async function GET(req: Request) {
  if (!mcpServerEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const origin = publicOrigin(req);
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES,
  });
}

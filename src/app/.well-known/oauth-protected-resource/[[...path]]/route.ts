import { NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/server/api-helpers';
import { SCOPES, mcpServerEnabled } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

/** Protected resource metadata (RFC 9728) for the MCP endpoint, at the bare path and at /api/mcp. */
export async function GET(req: Request) {
  if (!mcpServerEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const origin = publicOrigin(req);
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Blynt Workpaper',
  });
}

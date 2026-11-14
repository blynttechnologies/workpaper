import { NextResponse } from 'next/server';
import { mcpServerEnabled, revoke } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

/** Token revocation (RFC 7009): always 200, whether or not the token existed. */
export async function POST(req: Request) {
  if (!mcpServerEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const p = Object.fromEntries(new URLSearchParams(await req.text()));
  if (p.token) await revoke(p.token);
  return new NextResponse(null, { status: 200 });
}

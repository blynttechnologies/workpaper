import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { syncIn } from '@/lib/server/store';
import { publicOrigin } from '@/lib/server/api-helpers';
import { logError } from '@/lib/server/log-error';
import { handleMcp } from '@/lib/server/mcp/server';
import { limited, mcpServerEnabled, verifyAccessToken } from '@/lib/server/mcp/oauth';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers });

/** MCP endpoint for ChatGPT and Microsoft Copilot. Bearer token from Workpaper's OAuth server; off unless MCP_ENABLED=1. */
export async function POST(req: Request) {
  if (!mcpServerEnabled()) return json({ error: 'Not found' }, 404);
  const token = /^Bearer (.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  const grant = token ? await verifyAccessToken(token) : null;
  if (!grant) {
    const metadata = `${publicOrigin(req)}/.well-known/oauth-protected-resource/api/mcp`;
    return json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}"` });
  }
  if (limited(crypto.createHash('sha256').update(token!).digest('hex'), 120)) return json({ error: 'Too many requests. Wait a minute.' }, 429, { 'Retry-After': '60' });

  let msg;
  try {
    msg = await req.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  if (Array.isArray(msg)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported' } }, 400);
  try {
    await syncIn();
    const reply = await handleMcp(msg, grant);
    return reply ? json(reply) : new NextResponse(null, { status: 202 });
  } catch (err) {
    logError('mcp', err);
    return json({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: 'Something went wrong in Workpaper. Try again.' } });
  }
}

// Stateless server: no server-to-client stream and no sessions to end
export async function GET() {
  return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
}
export const DELETE = GET;

import crypto from 'crypto';
import { db } from '../db';
import { actorForUser } from '../api-helpers';
import { ServiceError } from '../services';
import { validate } from '../ai/validate';
import { logRequest } from '../ai/usage';
import { AiError } from '../ai/types';
import { TOOLS } from './tools';
import { channelOf, mcpFirmEnabled, type Grant } from './oauth';

/**
 * The Workpaper MCP server: JSON-RPC over HTTP (stateless, one JSON response per request), so it runs on
 * Lambda behind a buffered Function URL. Methods: initialize, ping, tools/list, tools/call, notifications.
 * Every call is checked against the token's user as they are now (role, practice, assigned clients),
 * the practice's MCP switch and tool list, and the token's scope; and every tool call is logged.
 */

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: RpcRequest['id'], result: unknown): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** The tools this user may see: the practice's switched-off tools and write tools for read-only roles or tokens are left out. */
export function toolsFor(grant: Grant) {
  const actor = actorForUser(grant.user_id);
  const off = new Set(db.firms.find((f) => f.id === actor.firmId)?.settings?.ai?.mcp?.disabled_tools ?? []);
  const canWrite = actor.role !== 'readonly' && grant.scope.split(' ').includes('workpaper.draft');
  return TOOLS.filter((t) => !off.has(t.name) && (!t.write || canWrite));
}

/** Handles one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleMcp(msg: RpcRequest, grant: Grant): Promise<RpcResponse | null> {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
  if (msg.id === undefined) return null; // notifications/initialized and other notifications

  let actor;
  try {
    actor = actorForUser(grant.user_id);
  } catch {
    return fail(msg.id, -32001, 'This Workpaper account no longer has access.');
  }
  // A token is bound to the practice it was issued in
  if (actor.firmId !== grant.firm_id) return fail(msg.id, -32001, 'This connection is for another practice.');
  if (!mcpFirmEnabled(actor.firmId)) return fail(msg.id, -32001, 'Your practice has not turned on outside assistants. An admin can turn them on in the AI Control Centre.');

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'blynt-workpaper', title: 'Blynt Workpaper', version: '1.0.0' },
        instructions:
          'Tools for Blynt Workpaper, a UK accounting working-paper system. You act as the signed-in Workpaper user and see only their clients. ' +
          'Figures come from Workpaper and are authoritative. You cannot approve, sign off or post anything: create_reconciliation_draft leaves an ' +
          'unconfirmed draft that a person confirms inside Workpaper.',
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, {
        tools: toolsFor(grant).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false },
        })),
      });
    case 'tools/call':
      return ok(msg.id, await callTool(grant, actor, String(msg.params?.name ?? ''), msg.params?.arguments ?? {}));
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function callTool(grant: Grant, actor: ReturnType<typeof actorForUser>, name: string, args: Record<string, unknown>) {
  const channel = channelOf(grant.client_name);
  const started = Date.now();
  const tool = toolsFor(grant).find((t) => t.name === name);
  const engagementId = typeof args.engagement_id === 'string' ? args.engagement_id : undefined;
  const log = (status: 'ok' | 'error' | 'blocked', code?: string) =>
    logRequest({
      id: `mcp_${crypto.randomUUID()}`,
      firm_id: actor.firmId,
      user_id: actor.id,
      channel,
      kind: 'tool',
      module: 'mcp',
      task: name || '(none)',
      provider: grant.client_name,
      model: '',
      status,
      error_code: code,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: null,
      latency_ms: Date.now() - started,
      engagement_id: engagementId,
      created_at: new Date(started).toISOString(),
    });
  const result = (body: unknown, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, ...(isError ? { isError: true } : {}) });

  if (!tool) {
    await log('blocked', 'not_allowed');
    return result({ error: `The tool ${name} is not available to you.` }, true);
  }
  const problems = validate(tool.inputSchema, args);
  if (problems.length) {
    await log('error', 'invalid_input');
    return result({ error: `Invalid input: ${problems.join('; ')}` }, true);
  }
  try {
    const body = await tool.run(actor, args as Record<string, any>, channel);
    await log('ok');
    return result(body);
  } catch (err) {
    if (err instanceof ServiceError || err instanceof AiError) {
      await log(err instanceof ServiceError && err.status === 403 ? 'blocked' : 'error', err instanceof ServiceError ? err.code : err.code);
      return result({ error: err.message }, true);
    }
    await log('error', 'server_error');
    throw err;
  }
}

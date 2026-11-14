// @vitest-environment node
import crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({
  syncIn: async () => {},
  syncOut: async () => {},
  currentVersion: () => 1,
  hasDatabase: () => false,
  query: async () => [],
  freshWrite: async (fn: () => unknown) => fn(),
  readFile: async () => null,
  saveFile: async () => {},
}));

import { db } from '@/lib/server/db';
import { handleMcp } from '@/lib/server/mcp/server';
import { registerClient, checkAuthRequest, createCode, exchangeCode, refreshTokens, verifyAccessToken, revoke, channelOf, validRedirect, type Grant } from '@/lib/server/mcp/oauth';
import { memoryRequests } from '@/lib/server/ai/usage';
import { providers } from '@/lib/server/ai/gateway';

const firmId = 'firm_blynt_uk';
const verifier = 'v'.repeat(50);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

const grant = (user_id: string, scope = 'workpaper.read workpaper.draft', client_name = 'ChatGPT'): Grant => ({ client_id: 'c', client_name, user_id, firm_id: firmId, scope });
let n = 0;
const rpc = async (g: Grant, method: string, params?: unknown) => (await handleMcp({ jsonrpc: '2.0', id: ++n, method, params }, g))!;
const call = async (g: Grant, name: string, args: Record<string, unknown>) => {
  const r = (await rpc(g, 'tools/call', { name, arguments: args })) as any;
  return r.result as { structuredContent: any; isError?: boolean };
};
const enable = (extra: Record<string, unknown> = {}) => {
  const f = db.firms.find((x) => x.id === firmId)!;
  f.settings = { ...f.settings, ai: { mcp: { enabled: true, disabled_tools: [], ...extra } } };
};

beforeEach(() => {
  db.seed(true);
  memoryRequests.length = 0;
  // No model calls in these tests
  providers.anthropic = { ...providers.anthropic, configured: () => false };
  providers.openai = { ...providers.openai, configured: () => false };
});

describe('OAuth for outside assistants', () => {
  it('registers public clients with safe redirects only', async () => {
    expect(validRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true);
    expect(validRedirect('http://localhost:6274/cb')).toBe(true);
    expect(validRedirect('http://evil.example/cb')).toBe(false);
    await expect(registerClient({ client_name: 'X', redirect_uris: ['http://evil.example/cb'] })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
  });

  it('code + PKCE gives tokens once; refresh tokens rotate; revoked tokens stop working', async () => {
    const c = await registerClient({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/cb'] });
    const req = { client_id: c.client_id, redirect_uri: 'https://chatgpt.com/cb', code_challenge: challenge, code_challenge_method: 'S256', scope: 'workpaper.read admin.everything' };
    expect((await checkAuthRequest(req)).scope).toBe('workpaper.read'); // unknown scopes dropped
    await expect(checkAuthRequest({ ...req, redirect_uri: 'https://other.example/cb' })).rejects.toMatchObject({ error: 'invalid_request' });
    await expect(checkAuthRequest({ ...req, code_challenge_method: 'plain' })).rejects.toMatchObject({ error: 'invalid_request' });

    const code = await createCode(req, { id: 'usr_test_preparer', firmId });
    await expect(exchangeCode({ code, client_id: c.client_id, redirect_uri: req.redirect_uri, code_verifier: 'w'.repeat(50) })).rejects.toMatchObject({ error: 'invalid_grant' });
    const code2 = await createCode(req, { id: 'usr_test_preparer', firmId });
    const t = await exchangeCode({ code: code2, client_id: c.client_id, redirect_uri: req.redirect_uri, code_verifier: verifier });
    expect(t).toMatchObject({ token_type: 'Bearer', scope: 'workpaper.read' });
    await expect(exchangeCode({ code: code2, client_id: c.client_id, redirect_uri: req.redirect_uri, code_verifier: verifier })).rejects.toMatchObject({ error: 'invalid_grant' });
    expect(await verifyAccessToken(t.access_token)).toMatchObject({ user_id: 'usr_test_preparer', firm_id: firmId });

    const t2 = await refreshTokens({ refresh_token: t.refresh_token, client_id: c.client_id });
    await expect(refreshTokens({ refresh_token: t.refresh_token, client_id: c.client_id })).rejects.toMatchObject({ error: 'invalid_grant' });
    await revoke(t2.access_token);
    expect(await verifyAccessToken(t2.access_token)).toBeNull();
  });

  it('tells ChatGPT and Copilot apart by the name they registered with', () => {
    expect(channelOf('ChatGPT')).toBe('chatgpt');
    expect(channelOf('Microsoft Copilot Studio')).toBe('copilot');
    expect(channelOf('Some client')).toBe('mcp');
  });
});

describe('MCP server', () => {
  it('is closed until the practice turns outside assistants on', async () => {
    const r = await rpc(grant('usr_test_preparer'), 'tools/list');
    expect(r.error?.message).toMatch(/not turned on/);
    enable();
    expect((await rpc(grant('usr_test_preparer'), 'initialize', { protocolVersion: '2025-06-18' })).result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'blynt-workpaper' } });
  });

  it('lists write tools only for roles and tokens that may draft, and never switched-off tools', async () => {
    enable({ disabled_tools: ['generate_report'] });
    const names = async (g: Grant) => ((await rpc(g, 'tools/list')).result as any).tools.map((t: any) => t.name);
    const full = await names(grant('usr_test_preparer'));
    expect(full).toContain('create_reconciliation_draft');
    expect(full).not.toContain('generate_report');
    expect(await names(grant('usr_test_preparer', 'workpaper.read'))).not.toContain('create_reconciliation_draft');
    db.memberships.find((m) => m.user_id === 'usr_test_reviewer')!.role = 'readonly';
    expect(await names(grant('usr_test_reviewer'))).not.toContain('create_reconciliation_draft');
    // Calling a hidden tool is blocked and logged
    const r = await call(grant('usr_test_preparer', 'workpaper.read'), 'create_reconciliation_draft', {});
    expect(r.isError).toBe(true);
    expect(memoryRequests.at(-1)).toMatchObject({ kind: 'tool', status: 'blocked', task: 'create_reconciliation_draft', channel: 'chatgpt' });
  });

  it('sees only the user’s assigned clients and never another practice', async () => {
    enable();
    db.firms.push({ id: 'firm_other', name: 'Other LLP', created_at: '2026-01-01' } as any);
    db.clients.push({ id: 'cli_other', firm_id: 'firm_other', name: 'Other Client Ltd' } as any);
    db.engagements.push({ id: 'eng_other', client_id: 'cli_other', firm_id: 'firm_other', period_start: '2025-01-01', period_end: '2025-12-31', framework: 'FRS 102 1A', status: 'fieldwork' } as any);
    db.workpapers.push({ id: 'wp_other', engagement_id: 'eng_other', ref: 'B-10', data_json: {}, status: 'in_progress' } as any);
    db.memberships.find((m) => m.user_id === 'usr_test_preparer')!.client_ids = ['cli_harlow'];

    const s = await call(grant('usr_test_preparer'), 'search_workpapers', { query: '' });
    const engs = new Set(s.structuredContent.workpapers.map((w: any) => w.engagement_id));
    expect([...engs].every((e) => String(e).startsWith('eng_harlow'))).toBe(true);
    expect((await call(grant('usr_test_preparer'), 'find_missing_documents', { engagement_id: 'eng_other' })).isError).toBe(true);
    expect((await call(grant('usr_test_preparer'), 'find_missing_documents', { engagement_id: 'eng_acme_fy26' })).isError).toBe(true);
    expect((await call(grant('usr_test_preparer'), 'get_workpaper_status', { workpaper_id: 'wp_other' })).isError).toBe(true);
    // A token issued in one practice cannot be used after moving to another
    expect((await rpc({ ...grant('usr_test_preparer'), firm_id: 'firm_other' }, 'tools/list')).error).toBeDefined();
  });

  it('a deactivated user’s token stops working at once', async () => {
    enable();
    db.memberships.find((m) => m.user_id === 'usr_test_preparer')!.status = 'deactivated';
    expect((await rpc(grant('usr_test_preparer'), 'tools/list')).error?.message).toMatch(/no longer has access/);
  });

  it('create_reconciliation_draft leaves an unconfirmed figure that blocks sign-off, and never overwrites one', async () => {
    enable();
    const r = await call(grant('usr_test_preparer', undefined, 'Microsoft Copilot'), 'create_reconciliation_draft', { workpaper_id: 'wp_b10', statement_balance: '£124,918.17', statement_date: '2026-09-30', source: 'Barclays Sep 2026.pdf' });
    expect(r.structuredContent).toMatchObject({ filled: true, field: 'statement_p' });
    const wp = db.workpapers.find((w) => w.id === 'wp_b10')!;
    expect(wp.data_json.statement_p).toBe('12491817');
    expect(wp.data_json.values_to_confirm_count).toBe(1);
    expect(wp.data_json.confidence_gate_items.at(-1)).toMatchObject({ confirmed: false, reason: expect.stringMatching(/confirm it against the statement/) });
    expect(db.audit_logs.at(-1)).toMatchObject({ action: 'MCP_RECONCILIATION_DRAFT', actor_id: 'usr_test_preparer' });
    expect(memoryRequests.at(-1)).toMatchObject({ channel: 'copilot', status: 'ok' });

    const again = await call(grant('usr_test_preparer'), 'create_reconciliation_draft', { workpaper_id: 'wp_b10', statement_balance: '1.00', statement_date: '2026-09-30', source: 'x' });
    expect(again.structuredContent.filled).toBe(false);
    expect(wp.data_json.statement_p).toBe('12491817');
  });

  it('refuses drafts on a locked engagement, on a non-bank paper, and with bad input', async () => {
    enable();
    const locked = db.workpapers.find((w) => w.engagement_id === 'eng_harlow_fy25' && w.ref.startsWith('F-'))!;
    db.workpapers.push({ ...locked, id: 'wp_b10_locked', ref: 'B-10', data_json: {} });
    expect((await call(grant('usr_test_preparer'), 'create_reconciliation_draft', { workpaper_id: 'wp_b10_locked', statement_balance: '1.00', statement_date: '2026-09-30', source: 'x' })).structuredContent.error).toMatch(/locked/);
    expect((await call(grant('usr_test_preparer'), 'create_reconciliation_draft', { workpaper_id: 'wp_f10', statement_balance: '1.00', statement_date: '2026-09-30', source: 'x' })).structuredContent.error).toMatch(/not a bank reconciliation/);
    expect((await call(grant('usr_test_preparer'), 'create_reconciliation_draft', { workpaper_id: 'wp_b10', statement_balance: 'lots', statement_date: '2026-09-30', source: 'x' })).isError).toBe(true);
    expect((await call(grant('usr_test_preparer'), 'search_workpapers', { query: 1 })).structuredContent.error).toMatch(/Invalid input/);
  });

  it('read tools answer from Workpaper’s own data', async () => {
    enable();
    const g = grant('usr_test_reviewer');
    const client = await call(g, 'get_client_summary', { client_name: 'harlow' });
    expect(client.structuredContent.client.name).toMatch(/Harlow/);
    expect(client.structuredContent.latest.engagement_id).toBe('eng_harlow_fy26');
    const acct = await call(g, 'get_account_details', { engagement_id: 'eng_harlow_fy26', account: '1010' });
    expect(acct.structuredContent.accounts[0]).toMatchObject({ code: '1010', balance_p: '95535000', blynt_code: '6000' });
    const ex = await call(g, 'retrieve_review_exceptions', { engagement_id: 'eng_harlow_fy26' });
    expect(ex.structuredContent.review_notes.some((x: any) => x.ref === 'F-10')).toBe(true);
    const status = await call(g, 'get_workpaper_status', { workpaper_id: 'wp_f10' });
    expect(status.structuredContent).toMatchObject({ ref: 'F-10', procedures: { total: 4 } });
    // No AI set up: the report still gives the facts
    const rep = await call(g, 'generate_report', { engagement_id: 'eng_harlow_fy26', kind: 'status' });
    expect(rep.structuredContent.facts.engagement.id).toBe('eng_harlow_fy26');
  });

  it('answers notifications with nothing and unknown methods with an error', async () => {
    enable();
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, grant('usr_test_preparer'))).toBeNull();
    expect((await rpc(grant('usr_test_preparer'), 'resources/list')).error?.code).toBe(-32601);
  });
});

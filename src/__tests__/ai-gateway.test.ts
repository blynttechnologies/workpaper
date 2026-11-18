// @vitest-environment node
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
import { providers, run, tuning, routeFor, aiAvailable, testProvider } from '@/lib/server/ai/gateway';
import { validate } from '@/lib/server/ai/validate';
import { costUsd } from '@/lib/server/ai/pricing';
import { memoryRequests, summarise } from '@/lib/server/ai/usage';
import { AiError, type Provider, type ProviderCall, type ProviderResult, type TaskDef } from '@/lib/server/ai/types';

const firmId = 'firm_blynt_uk';
const ctx = { firmId, userId: 'usr_test_preparer' };
const original = { ...providers };

/** A stand-in provider: answers from a queue (a reply, or an error to throw), records every call. */
function fake(id: 'anthropic' | 'openai', model: string) {
  const queue: (Partial<ProviderResult> | AiError)[] = [];
  const calls: ProviderCall[] = [];
  const p: Provider = {
    id,
    label: id,
    configured: () => true,
    defaultModel: () => model,
    async call(c) {
      calls.push(c);
      const next = queue.shift();
      if (!next) throw new AiError('no reply queued', 'provider');
      if (next instanceof AiError) throw next;
      return { text: '', toolCalls: [], stop: 'end', inputTokens: 1000, outputTokens: 500, model: c.model, ...next };
    },
  };
  return { p, queue, calls };
}

const schemaTask: TaskDef<{ q: string }, { answer: string; n: number }> = {
  id: 'test_task',
  module: 'test',
  version: '1',
  system: 'sys',
  build: ({ q }) => [{ type: 'text', text: q }],
  schema: { type: 'object', properties: { answer: { type: 'string' }, n: { type: 'integer' } }, required: ['answer', 'n'], additionalProperties: false },
  maxTokens: 1000,
  effort: 'low',
};

let A: ReturnType<typeof fake>;
let O: ReturnType<typeof fake>;

beforeEach(() => {
  db.seed(true);
  memoryRequests.length = 0;
  tuning.retryDelayMs = 0;
  A = fake('anthropic', 'claude-opus-5-5');
  O = fake('openai', 'gpt-test');
  providers.anthropic = A.p;
  providers.openai = O.p;
  providers.gemini = { ...O.p, id: 'gemini', configured: () => false };
});

const setAi = (ai: any) => {
  const firm = db.firms.find((f) => f.id === firmId)!;
  firm.settings = { ...firm.settings, ai };
};

describe('output validation', () => {
  it('accepts a matching value and names every problem otherwise', () => {
    const s = schemaTask.schema!;
    expect(validate(s, { answer: 'x', n: 2 })).toEqual([]);
    expect(validate(s, { answer: 'x', n: 2.5 })).toEqual(['$.n: expected integer']);
    expect(validate(s, { answer: 'x' })).toEqual(['$.n: missing']);
    expect(validate(s, { answer: 'x', n: 1, extra: true })).toEqual(['$.extra: not allowed']);
    expect(validate({ type: 'array', items: { type: 'string', enum: ['a'] } }, ['a', 'b'])).toEqual(['$[1]: not one of a']);
  });
});

describe('routing', () => {
  it('goes to Claude first by default, with OpenAI as the fallback, and follows practice settings', () => {
    expect(routeFor(schemaTask, {})).toEqual({ order: ['anthropic', 'openai'], mode: 'single' });
    expect(routeFor(schemaTask, { routes: { test_task: { provider: 'openai', mode: 'review' } } })).toEqual({ order: ['openai', 'anthropic'], mode: 'review' });
    expect(routeFor(schemaTask, { routes: { test_task: { fallback: false } } }).order).toEqual(['anthropic']);
    expect(routeFor(schemaTask, { providers: { anthropic: { enabled: false } } }).order).toEqual(['openai']);
  });

  it('refuses when no provider is set up, without calling anything', async () => {
    providers.anthropic = { ...A.p, configured: () => false };
    providers.openai = { ...O.p, configured: () => false };
    expect(aiAvailable(firmId, schemaTask)).toBe(false);
    await expect(run(schemaTask, { q: 'hi' }, ctx)).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('single mode, retries and fallback', () => {
  it('returns validated output and logs tokens, cost, firm and user', async () => {
    A.queue.push({ text: '{"answer":"yes","n":3}' });
    const r = await run(schemaTask, { q: 'hi' }, ctx);
    expect(r).toMatchObject({ output: { answer: 'yes', n: 3 }, provider: 'anthropic', model: 'claude-opus-5-5', mode: 'single', taskVersion: '1' });
    expect(A.calls[0]).toMatchObject({ model: 'claude-opus-5-5', system: 'sys', effort: 'low', maxTokens: 1000 });
    expect(memoryRequests).toHaveLength(1);
    // Opus 5.5 at $4 / $20 per million: 1000 in + 500 out
    expect(memoryRequests[0]).toMatchObject({ firm_id: firmId, user_id: 'usr_test_preparer', task: 'test_task', module: 'test', status: 'ok', input_tokens: 1000, output_tokens: 500, cost_usd: 0.014 });
  });

  it('retries an output that does not match the schema, then succeeds', async () => {
    A.queue.push({ text: 'not json' }, { text: '{"answer":"x"}' }, { text: '{"answer":"x","n":1}' });
    const r = await run(schemaTask, { q: 'hi' }, ctx);
    expect(r.output.n).toBe(1);
    expect(memoryRequests.map((x) => x.status)).toEqual(['error', 'error', 'ok']);
    expect(memoryRequests.map((x) => x.error_code)).toEqual(['invalid_output', 'invalid_output', undefined]);
  });

  it('falls back to the other provider when the first keeps failing, and records where it came from', async () => {
    A.queue.push(new AiError('down', 'provider', true), new AiError('down', 'provider', true), new AiError('down', 'provider', true));
    O.queue.push({ text: '{"answer":"from openai","n":1}' });
    const r = await run(schemaTask, { q: 'hi' }, ctx);
    expect(r.provider).toBe('openai');
    expect(A.calls).toHaveLength(3);
    expect(memoryRequests.at(-1)).toMatchObject({ provider: 'openai', fallback_from: 'anthropic', status: 'ok' });
  });

  it('does not retry a refusal on the same provider, but does fall back', async () => {
    A.queue.push({ stop: 'refusal' });
    O.queue.push({ text: '{"answer":"ok","n":1}' });
    const r = await run(schemaTask, { q: 'hi' }, ctx);
    expect(A.calls).toHaveLength(1);
    expect(r.provider).toBe('openai');
  });

  it('a cut-off answer is an error, never a partial result', async () => {
    providers.openai = { ...O.p, configured: () => false };
    A.queue.push({ stop: 'max_tokens', text: '{"answer":"tru' });
    await expect(run(schemaTask, { q: 'hi' }, ctx)).rejects.toMatchObject({ code: 'truncated' });
    // The provider billed for it, so the error row carries the tokens and the cost
    expect(memoryRequests[0]).toMatchObject({ status: 'error', error_code: 'truncated', input_tokens: 1000, output_tokens: 500, cost_usd: 0.014 });
  });

  it('stops at the practice monthly limit and logs the blocked request', async () => {
    setAi({ monthly_limit_usd: 0.01 });
    A.queue.push({ text: '{"answer":"a","n":1}' });
    await run(schemaTask, { q: 'one' }, ctx); // $0.014 spent
    await expect(run(schemaTask, { q: 'two' }, ctx)).rejects.toMatchObject({ code: 'limit' });
    expect(memoryRequests.at(-1)).toMatchObject({ status: 'blocked', error_code: 'limit' });
    expect(A.calls).toHaveLength(1);
  });

  it('a practice with no limit of its own gets the server default; its own limit wins', async () => {
    vi.stubEnv('AI_DEFAULT_LIMIT_USD', '0.01');
    A.queue.push({ text: '{"answer":"a","n":1}' }, { text: '{"answer":"b","n":2}' });
    await run(schemaTask, { q: 'one' }, ctx); // $0.014 spent, over the default
    await expect(run(schemaTask, { q: 'two' }, ctx)).rejects.toMatchObject({ code: 'limit' });
    setAi({ monthly_limit_usd: 5 });
    expect((await run(schemaTask, { q: 'three' }, ctx)).output.n).toBe(2);
    vi.unstubAllEnvs();
  });
});

describe('multi-AI modes', () => {
  it('review mode: both providers answer independently and agreement is reported', async () => {
    setAi({ routes: { test_task: { mode: 'review' } } });
    A.queue.push({ text: '{"answer":"a","n":1}' });
    O.queue.push({ text: '{"answer":"a","n":1}' });
    const same = await run(schemaTask, { q: 'hi' }, ctx);
    expect(same).toMatchObject({ mode: 'review', agreement: true, second: { provider: 'openai' } });

    A.queue.push({ text: '{"answer":"a","n":1}' });
    O.queue.push({ text: '{"answer":"b","n":2}' });
    const diff = await run(schemaTask, { q: 'hi' }, ctx);
    expect(diff.agreement).toBe(false);
    // Both calls share a parent id so the Control Centre can pair them
    const last = memoryRequests.slice(-2);
    expect(last[0].parent_id).toBe(last[1].parent_id);
  });

  it('review mode with one provider failing still returns the other, as single', async () => {
    setAi({ routes: { test_task: { mode: 'review' } } });
    A.queue.push(new AiError('bad', 'bad_request'));
    O.queue.push({ text: '{"answer":"o","n":1}' });
    const r = await run(schemaTask, { q: 'hi' }, ctx);
    expect(r).toMatchObject({ provider: 'openai', mode: 'single' });
  });

  it('collaborate mode: the second provider checks the first one’s draft and its answer wins', async () => {
    setAi({ routes: { test_task: { mode: 'collaborate' } } });
    A.queue.push({ text: '{"answer":"draft","n":1}' });
    O.queue.push({ text: '{"answer":"checked","n":2}' });
    const r = await run(schemaTask, { q: 'hi' }, ctx);
    expect(r).toMatchObject({ output: { answer: 'checked' }, provider: 'openai', mode: 'collaborate', second: { provider: 'anthropic', output: { answer: 'draft' } } });
    const reviewerSaw = O.calls[0].messages[0];
    expect(reviewerSaw.role === 'user' && reviewerSaw.content.some((p) => p.type === 'text' && p.text.includes('"draft"'))).toBe(true);
  });
});

describe('tool calling', () => {
  const toolTask: TaskDef<{ q: string }, string> = {
    id: 'tool_task',
    module: 'test',
    version: '1',
    system: 's',
    build: ({ q }) => [{ type: 'text', text: q }],
    tools: () => ({
      defs: [{ name: 'lookup', description: 'd', schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false } }],
      run: async (_n, input) => `found ${(input as { code: string }).code}`,
    }),
    maxTokens: 1000,
    effort: 'low',
  };

  it('runs allowed tools, refuses bad input and unknown tools, and feeds results back', async () => {
    A.queue.push(
      { stop: 'tool', toolCalls: [{ id: 't1', name: 'lookup', input: { code: '4000' } }, { id: 't2', name: 'delete_everything', input: {} }, { id: 't3', name: 'lookup', input: { code: 1 } }] },
      { text: 'Done' }
    );
    const r = await run(toolTask, { q: 'go' }, ctx);
    expect(r.output).toBe('Done');
    const results = A.calls[1].messages.at(-1)!;
    expect(results.role).toBe('tool');
    if (results.role === 'tool') {
      expect(results.results[0]).toEqual({ id: 't1', output: 'found 4000' });
      expect(results.results[1]).toMatchObject({ isError: true, output: 'There is no tool called delete_everything.' });
      expect(results.results[2]).toMatchObject({ isError: true });
    }
  });

  it('a task without tools cannot run one the model asks for', async () => {
    providers.openai = { ...O.p, configured: () => false };
    A.queue.push({ stop: 'tool', toolCalls: [{ id: 'x', name: 'lookup', input: {} }] });
    await expect(run(schemaTask, { q: 'hi' }, ctx)).rejects.toMatchObject({ code: 'tool' });
  });
});

describe('cost and usage', () => {
  it('prices Claude models and leaves unknown models unpriced', () => {
    expect(costUsd('claude-sonnet-5-5', 1_000_000, 100_000)).toBe(3);
    expect(costUsd('some-model', 10, 10)).toBeNull();
  });

  it('summarises by provider and module, counting failures', () => {
    const base = { firm_id: firmId, user_id: 'u', channel: 'app', kind: 'model' as const, task: 't', input_tokens: 10, output_tokens: 5, latency_ms: 100, created_at: '2026-11-14T00:00:00Z' };
    const s = summarise([
      { ...base, id: '1', module: 'documents', provider: 'anthropic', model: 'm', status: 'ok', cost_usd: 0.5 },
      { ...base, id: '2', module: 'documents', provider: 'openai', model: 'g', status: 'error', cost_usd: 0 },
      { ...base, id: '3', module: 'review', provider: 'openai', model: 'g', status: 'ok', cost_usd: null },
    ]);
    expect(s.total).toMatchObject({ requests: 3, failed: 1, cost_usd: 0.5, unpriced: 1 });
    expect(s.by_module.documents.requests).toBe(2);
    expect(s.by_provider.openai.failed).toBe(1);
    expect(s.failures).toHaveLength(1);
  });

  it('a connection test is one small logged call', async () => {
    A.queue.push({ text: 'ready' });
    const t = await testProvider(ctx, 'anthropic');
    expect(t).toMatchObject({ ok: true, reply: 'ready' });
    expect(memoryRequests[0]).toMatchObject({ task: 'ping', module: 'admin' });
  });
});

describe('OpenAI adapter errors', () => {
  it('an empty credit balance is a plain message with no retries; a real rate limit is retried', async () => {
    const { openaiProvider } = await import('@/lib/server/ai/providers/openai');
    const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
    const c = { model: 'gpt-6.1-sol', system: 's', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }], maxTokens: 10, effort: 'low' as const, timeoutMs: 1000 };
    reply(429, { error: { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'You have no credits remaining.' } });
    await expect(openaiProvider.call(c)).rejects.toMatchObject({ code: 'provider', retryable: false, message: expect.stringMatching(/no credit left/) });
    reply(429, { error: { type: 'requests', message: 'Rate limit reached' } });
    await expect(openaiProvider.call(c)).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
    // A timeout goes straight to the next provider: three waits on one would outlast the Lambda
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(openaiProvider.call(c)).rejects.toMatchObject({ code: 'timeout', retryable: false });
    vi.restoreAllMocks();
  });
});

describe('Gemini adapter', () => {
  it('skips thought text, bills thinking as output, hands tool calls back with their name, and maps a bad key', async () => {
    const { geminiProvider } = await import('@/lib/server/ai/providers/gemini');
    const spy = vi.spyOn(globalThis, 'fetch');
    const reply = (status: number, body: unknown) => spy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
    const c = { model: 'gemini-4-hydrogen', system: 's', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }], maxTokens: 10, effort: 'low' as const, timeoutMs: 1000 };

    const modelContent = { role: 'model', parts: [{ text: 'thinking…', thought: true }, { functionCall: { id: 'fc1', name: 'search_standards', args: { q: 'leases' } }, thoughtSignature: 'sig' }] };
    reply(200, { candidates: [{ content: modelContent, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 7 } });
    const r = await geminiProvider.call(c);
    expect(r).toMatchObject({ text: '', stop: 'tool', inputTokens: 5, outputTokens: 10, toolCalls: [{ id: 'fc1', name: 'search_standards', input: { q: 'leases' } }] });

    reply(200, { candidates: [{ content: { role: 'model', parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }] });
    await geminiProvider.call({ ...c, messages: [...c.messages, { role: 'assistant', text: '', toolCalls: r.toolCalls, raw: r.raw }, { role: 'tool', results: [{ id: 'fc1', output: 'IAS 16' }] }] });
    const sent = JSON.parse(String(spy.mock.calls[1][1]!.body));
    expect(sent.contents[1]).toEqual(modelContent); // thought signature kept
    expect(sent.contents[2].parts[0]).toEqual({ functionResponse: { id: 'fc1', name: 'search_standards', response: { output: 'IAS 16' } } });

    reply(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } });
    await expect(geminiProvider.call(c)).rejects.toMatchObject({ code: 'not_configured' });
    reply(200, { candidates: [{ finishReason: 'SAFETY' }] });
    expect((await geminiProvider.call(c)).stop).toBe('refusal');
    vi.restoreAllMocks();
  });
});

describe('restore', () => {
  it('puts the real providers back', () => {
    Object.assign(providers, original);
    expect(providers.anthropic.id).toBe('anthropic');
  });
});

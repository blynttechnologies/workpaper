import crypto from 'crypto';
import { db } from '../db';
import type { AiSettings } from '../../types/models';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import { geminiProvider } from './providers/gemini';
import { validate } from './validate';
import { costUsd } from './pricing';
import { logRequest, monthSpendUsd } from './usage';
import { AiError, PROVIDER_IDS, type Mode, type Msg, type Provider, type ProviderId, type RunCtx, type RunResult, type TaskDef } from './types';

/**
 * The AI gateway. Every model call in Workpaper goes through run(): it picks the provider for the
 * task (practice settings, then the task's default), enforces the practice's monthly limit, retries
 * and falls back between providers, checks structured output against the task's schema, runs the
 * task's read-only tools, and logs one row per provider call. Modules name a task; they never
 * talk to a provider.
 *
 * The gateway only proposes. What happens to an output is decided by the caller through the
 * existing confidence gate, confirm flow and approval rules.
 */

// Replaceable in tests
export const providers: Record<ProviderId, Provider> = { anthropic: anthropicProvider, openai: openaiProvider, gemini: geminiProvider };
export const tuning = { maxAttempts: 3, retryDelayMs: 400, maxToolRounds: 6, timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 120_000 };

export function aiSettings(firmId: string): AiSettings {
  return db.firms.find((f) => f.id === firmId)?.settings?.ai ?? {};
}

const enabled = (s: AiSettings, id: ProviderId) => s.providers?.[id]?.enabled !== false;
const modelFor = (s: AiSettings, id: ProviderId) => s.providers?.[id]?.model || providers[id].defaultModel();
const usable = (s: AiSettings, id: ProviderId) => enabled(s, id) && providers[id].configured() && !!modelFor(s, id);

/** Each provider as the Control Centre shows it. */
export function providerStatus(firmId: string) {
  const s = aiSettings(firmId);
  return PROVIDER_IDS.map((id) => ({ id, label: providers[id].label, configured: providers[id].configured(), enabled: enabled(s, id), model: modelFor(s, id) || null }));
}

/** Providers to try, in order, and the mode, for one task in one practice. */
export function routeFor(task: Pick<TaskDef<unknown, unknown>, 'id' | 'provider' | 'mode'>, s: AiSettings): { order: ProviderId[]; mode: Mode } {
  const r = s.routes?.[task.id] ?? {};
  const primary = r.provider ?? task.provider ?? 'anthropic';
  const order = [primary, ...PROVIDER_IDS.filter((p) => p !== primary)].filter((p) => usable(s, p));
  return { order: r.fallback === false ? order.filter((p) => p === primary) : order, mode: r.mode ?? task.mode ?? 'single' };
}

/** True when at least one provider could run the task for this practice. */
export function aiAvailable(firmId: string, task: Pick<TaskDef<unknown, unknown>, 'id' | 'provider' | 'mode'>): boolean {
  return routeFor(task, aiSettings(firmId)).order.length > 0;
}

const newId = () => `air_${crypto.randomUUID()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CallMeta {
  mode: Mode;
  parentId: string;
  fallbackFrom?: ProviderId;
}

interface Called<O> {
  output: O;
  provider: ProviderId;
  model: string;
  requestId: string;
}

/** One provider: the tool loop, with retries on each model call. */
async function callProvider<I, O>(pid: ProviderId, task: TaskDef<I, O>, first: Msg[], ctx: RunCtx, meta: CallMeta): Promise<Called<O>> {
  const s = aiSettings(ctx.firmId);
  const provider = providers[pid];
  const model = modelFor(s, pid);
  const tools = task.tools?.(ctx);
  let history = first;

  for (let round = 0; round < tuning.maxToolRounds; round++) {
    let lastErr: AiError | null = null;
    for (let attempt = 0; attempt < tuning.maxAttempts; attempt++) {
      if (attempt) await sleep(tuning.retryDelayMs * 2 ** (attempt - 1));
      const started = Date.now();
      const requestId = newId();
      const log = (status: 'ok' | 'error', res?: { inputTokens: number; outputTokens: number; model: string }, err?: AiError) =>
        logRequest({
          id: requestId,
          firm_id: ctx.firmId,
          user_id: ctx.userId,
          channel: ctx.channel ?? 'app',
          kind: 'model',
          module: task.module,
          task: task.id,
          task_version: task.version,
          mode: meta.mode,
          provider: pid,
          model: res?.model ?? model,
          status,
          error_code: err?.code,
          input_tokens: res?.inputTokens ?? 0,
          output_tokens: res?.outputTokens ?? 0,
          cost_usd: res ? costUsd(res.model, res.inputTokens, res.outputTokens) : 0,
          latency_ms: Date.now() - started,
          parent_id: meta.parentId,
          fallback_from: meta.fallbackFrom,
          engagement_id: ctx.engagementId,
          created_at: new Date(started).toISOString(),
        });
      try {
        const res = await provider.call({
          model,
          system: task.system,
          messages: history,
          schema: task.schema,
          tools: tools?.defs,
          maxTokens: task.maxTokens,
          effort: task.effort,
          timeoutMs: task.timeoutMs ?? tuning.timeoutMs,
        });
        if (res.stop === 'tool' && tools && res.toolCalls.length) {
          await log('ok', res);
          const results = await Promise.all(
            res.toolCalls.map(async (tc) => {
              const def = tools.defs.find((d) => d.name === tc.name);
              if (!def) return { id: tc.id, output: `There is no tool called ${tc.name}.`, isError: true };
              const problems = validate(def.schema, tc.input);
              if (problems.length) return { id: tc.id, output: `Invalid input: ${problems.join('; ')}`, isError: true };
              try {
                return { id: tc.id, output: await tools.run(tc.name, tc.input) };
              } catch (e) {
                return { id: tc.id, output: (e as Error).message, isError: true };
              }
            })
          );
          history = [...history, { role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw }, { role: 'tool', results }];
          lastErr = null;
          break; // next round
        }
        if (res.stop === 'refusal') throw new AiError('The model declined this request.', 'refusal');
        if (res.stop === 'max_tokens') throw new AiError('The answer was cut off before it finished.', 'truncated');
        if (res.stop === 'tool') throw new AiError('The model asked for a tool this task does not have.', 'tool');
        const output = parse<O>(task, res.text);
        await log('ok', res);
        return { output, provider: pid, model: res.model, requestId };
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError((e as Error).message, 'provider');
        await log('error', undefined, err);
        lastErr = err;
        if (!err.retryable) throw err;
      }
    }
    if (lastErr) throw lastErr;
  }
  throw new AiError('The model kept calling tools without finishing.', 'tool');
}

function parse<O>(task: TaskDef<unknown, O>, text: string): O {
  if (!task.schema) return text.trim() as O;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AiError('The model did not return valid JSON.', 'invalid_output', true);
  }
  const problems = validate(task.schema, value);
  if (problems.length) throw new AiError(`The model's answer did not match the expected format: ${problems.slice(0, 3).join('; ')}`, 'invalid_output', true);
  return value as O;
}

/** Try each provider in order until one succeeds. */
async function withFallback<I, O>(order: ProviderId[], task: TaskDef<I, O>, msgs: Msg[], ctx: RunCtx, meta: CallMeta): Promise<Called<O>> {
  let lastErr: unknown = null;
  for (let i = 0; i < order.length; i++) {
    try {
      return await callProvider(order[i], task, msgs, ctx, { ...meta, fallbackFrom: i ? order[i - 1] : undefined });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new AiError('No AI provider is set up for this task.', 'not_configured');
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function run<I, O>(task: TaskDef<I, O>, input: I, ctx: RunCtx): Promise<RunResult<O>> {
  const s = aiSettings(ctx.firmId);
  const { order, mode } = routeFor(task, s);
  if (!order.length) throw new AiError('No AI provider is set up for this task.', 'not_configured');
  if (s.monthly_limit_usd != null && (await monthSpendUsd(ctx.firmId)) >= s.monthly_limit_usd) {
    await logRequest({
      id: newId(), firm_id: ctx.firmId, user_id: ctx.userId, channel: ctx.channel ?? 'app', kind: 'model', module: task.module, task: task.id,
      provider: order[0], model: modelFor(s, order[0]), status: 'blocked', error_code: 'limit', input_tokens: 0, output_tokens: 0, cost_usd: 0,
      latency_ms: 0, engagement_id: ctx.engagementId, created_at: new Date().toISOString(),
    });
    throw new AiError("This practice has reached its monthly AI spending limit. An admin can raise it in the AI Control Centre.", 'limit');
  }
  const parts = task.build(input);
  const msgs: Msg[] = [{ role: 'user', content: parts }];
  const parentId = newId();
  const result = (c: Called<O>, m: Mode, extra: Partial<RunResult<O>> = {}): RunResult<O> => ({ ...c, taskVersion: task.version, mode: m, ...extra });

  // Two independent reads; a disagreement goes to a person
  if (mode === 'review' && order.length > 1) {
    const [a, b] = await Promise.allSettled([
      withFallback([order[0]], task, msgs, ctx, { mode, parentId }),
      withFallback([order[1]], task, msgs, ctx, { mode, parentId }),
    ]);
    if (a.status === 'fulfilled' && b.status === 'fulfilled') {
      const agreement = task.agree ? task.agree(a.value.output, b.value.output) : sameJson(a.value.output, b.value.output);
      return result(a.value, mode, { agreement, second: { provider: b.value.provider, model: b.value.model, output: b.value.output } });
    }
    if (a.status === 'fulfilled') return result(a.value, 'single');
    if (b.status === 'fulfilled') return result(b.value, 'single');
    throw a.reason;
  }

  const draft = await withFallback(order, task, msgs, ctx, { mode, parentId });
  // A second model checks the first one's work against the same material
  const reviewer = order.find((p) => p !== draft.provider);
  if (mode === 'collaborate' && reviewer) {
    const shown = typeof draft.output === 'string' ? draft.output : JSON.stringify(draft.output);
    const check: Msg[] = [
      {
        role: 'user',
        content: [
          ...parts,
          { type: 'text', text: `Another model produced the draft below from the material above. Check it against the material, correct anything wrong or missing, and return the complete corrected result in the same format.\n<draft>\n${shown}\n</draft>` },
        ],
      },
    ];
    try {
      const checked = await callProvider(reviewer, task, check, ctx, { mode, parentId });
      return result(checked, mode, { second: { provider: draft.provider, model: draft.model, output: draft.output } });
    } catch {
      return result(draft, 'single'); // the reviewer failing must not lose the draft
    }
  }
  return result(draft, 'single');
}

/** Control Centre "Test connection": one tiny call to one provider. */
export async function testProvider(ctx: RunCtx, pid: ProviderId) {
  const s = aiSettings(ctx.firmId);
  if (!providers[pid].configured()) return { ok: false, error: 'No API key (and, for OpenAI, no OPENAI_MODEL) is set on the server.' };
  const started = Date.now();
  try {
    const r = await callProvider(pid, PING, [{ role: 'user', content: PING.build(null) }], ctx, { mode: 'single', parentId: newId() });
    return { ok: true, model: r.model, latency_ms: Date.now() - started, reply: r.output, configured_model: modelFor(s, pid) };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: (e as AiError).code };
  }
}

const PING: TaskDef<null, string> = {
  id: 'ping',
  module: 'admin',
  version: '1',
  system: 'Reply with the single word: ready',
  build: () => [{ type: 'text', text: 'Connection test.' }],
  maxTokens: 2000,
  effort: 'low',
};

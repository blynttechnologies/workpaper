import { hasDatabase, query } from '../store';
import { logError } from '../log-error';

/**
 * One row per AI provider call or outside-assistant tool call: who, what, which model, tokens, cost,
 * time and outcome. Prompt and document content are never stored. Kept in its own table, not the
 * workspace, so logging never collides with saves.
 */
export interface AiRequestRow {
  id: string;
  firm_id: string;
  user_id: string;
  channel: string;
  kind: 'model' | 'tool';
  module: string;
  task: string;
  task_version?: string;
  mode?: string;
  provider: string;
  model: string;
  status: 'ok' | 'error' | 'blocked';
  error_code?: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  latency_ms: number;
  parent_id?: string;
  fallback_from?: string;
  engagement_id?: string;
  created_at: string;
}

// Local development without a database, and tests
export const memoryRequests: AiRequestRow[] = [];

export async function logRequest(row: AiRequestRow): Promise<void> {
  try {
    if (!hasDatabase()) {
      memoryRequests.push(row);
      return;
    }
    await query('INSERT INTO ai_requests (id, firm_id, created_at, data) VALUES ($1, $2, $3, $4::jsonb)', [row.id, row.firm_id, row.created_at, JSON.stringify(row)]);
  } catch (err) {
    // A failed log line must not fail the work the user asked for
    logError('ai-usage', err, { request_id: row.id });
  }
}

/** One practice's rows since a date, newest first. */
export async function listRequests(firmId: string, sinceIso: string, limit = 5000): Promise<AiRequestRow[]> {
  if (!hasDatabase()) {
    return memoryRequests
      .filter((r) => r.firm_id === firmId && r.created_at >= sinceIso)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const rows = await query<{ data: AiRequestRow }>(
    'SELECT data FROM ai_requests WHERE firm_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT $3',
    [firmId, sinceIso, limit]
  );
  return rows.map((r) => r.data);
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

export async function monthSpendUsd(firmId: string): Promise<number> {
  const rows = await listRequests(firmId, monthStart(), 100000);
  return rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
}

type Bucket = { requests: number; failed: number; input_tokens: number; output_tokens: number; cost_usd: number; unpriced: number; latency_ms: number };

/** Totals for the Control Centre: overall and by provider, model, module, task and channel. */
export function summarise(rows: AiRequestRow[]) {
  const blank = (): Bucket => ({ requests: 0, failed: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, unpriced: 0, latency_ms: 0 });
  const add = (b: Bucket, r: AiRequestRow) => {
    b.requests += 1;
    if (r.status !== 'ok') b.failed += 1;
    b.input_tokens += r.input_tokens;
    b.output_tokens += r.output_tokens;
    if (r.cost_usd == null) {
      if (r.kind === 'model' && r.status === 'ok') b.unpriced += 1;
    } else b.cost_usd += r.cost_usd;
    b.latency_ms += r.latency_ms;
  };
  const total = blank();
  const by = { provider: {} as Record<string, Bucket>, model: {} as Record<string, Bucket>, module: {} as Record<string, Bucket>, task: {} as Record<string, Bucket>, channel: {} as Record<string, Bucket> };
  for (const r of rows) {
    add(total, r);
    for (const k of Object.keys(by) as (keyof typeof by)[]) add((by[k][String(r[k])] ??= blank()), r);
  }
  const avg = (b: Bucket) => ({ ...b, cost_usd: Math.round(b.cost_usd * 1e4) / 1e4, avg_latency_ms: b.requests ? Math.round(b.latency_ms / b.requests) : 0 });
  const map = (m: Record<string, Bucket>) => Object.fromEntries(Object.entries(m).map(([k, b]) => [k, avg(b)]));
  return {
    total: avg(total),
    by_provider: map(by.provider),
    by_model: map(by.model),
    by_module: map(by.module),
    by_task: map(by.task),
    by_channel: map(by.channel),
    failures: rows.filter((r) => r.status !== 'ok').slice(0, 50),
  };
}

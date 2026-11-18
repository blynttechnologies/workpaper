import { db } from '../db';
import { ServiceError } from '../services';
import { monthlyLimitUsd, providerStatus } from './gateway';
import { TASK_CATALOG } from './catalog';
import { costUsd } from './pricing';
import { listRequests, monthSpendUsd, summarise, type AiRequestRow } from './usage';
import { PROVIDER_IDS, type ProviderId } from './types';
import { TOOLS } from '../mcp/tools';
import { mcpServerEnabled } from '../mcp/oauth';
import type { AiSettings, UserRole } from '../../types/models';

/** AI Control Centre: who may use it, what it shows, and how settings are checked before saving. */

export const AI_ADMIN_ROLES: UserRole[] = ['admin', 'partner'];

export function requireAiAdmin(actor: { role: UserRole }) {
  if (!AI_ADMIN_ROLES.includes(actor.role)) throw new ServiceError('Only a partner or admin can open the AI Control Centre.', 403, 'FORBIDDEN');
}

// shortcut: totals are added up in Node from this many rows; sum in SQL if practices start reaching it
const USAGE_ROWS = 50_000;

export async function controlCentre(firmId: string, origin: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await listRequests(firmId, since, USAGE_ROWS);
  const s: AiSettings = db.firms.find((f) => f.id === firmId)?.settings?.ai ?? {};
  return {
    days,
    providers: providerStatus(firmId),
    settings: s,
    tasks: TASK_CATALOG.map((t) => ({ ...t, route: s.routes?.[t.id] ?? null })),
    // The limit in force: the practice's own, or the server default when it has set none
    limit_usd: monthlyLimitUsd(s),
    month_spend_usd: Math.round((await monthSpendUsd(firmId)) * 100) / 100,
    usage: summarise(rows),
    // True when the period has more requests than were read: the page then says its totals are partial
    usage_capped: rows.length >= USAGE_ROWS,
    recent: rows.slice(0, 100),
    mcp: {
      server_enabled: mcpServerEnabled(),
      practice_enabled: !!s.mcp?.enabled,
      url: `${origin}/api/mcp`,
      tools: TOOLS.map((t) => ({ name: t.name, title: t.title, write: !!t.write, enabled: !(s.mcp?.disabled_tools ?? []).includes(t.name) })),
    },
  };
}

const MODEL = /^[\w.:\-/]{1,100}$/;

/** Checks a settings update field by field; anything not recognised is refused rather than stored. */
export function parseSettings(body: any): AiSettings {
  const out: AiSettings = {};
  const bad = (m: string): never => {
    throw new ServiceError(m, 400);
  };
  // A null or a bare value where an object belongs is a 400, not a crash
  const isObj = (v: unknown) => !!v && typeof v === 'object';
  if (!isObj(body)) bad('Send the settings as an object');
  if (body.providers !== undefined) {
    out.providers = {};
    for (const [id, p] of Object.entries(body.providers ?? {}) as [string, any][]) {
      if (!PROVIDER_IDS.includes(id as never)) bad(`Unknown provider ${id}`);
      if (!isObj(p)) bad(`The settings for ${id} must be an object`);
      if (p.enabled !== undefined && typeof p.enabled !== 'boolean') bad('enabled must be true or false');
      if (p.model && !MODEL.test(p.model)) bad('That model name is not valid');
      // An unpriced model costs "nothing" in the log, so the monthly limit would never stop it
      if (p.model && costUsd(p.model, 1, 1) === null) bad(`No price is set for ${p.model}. Add it to AI_PRICES on the server first, so its cost counts towards the monthly limit.`);
      out.providers[id as ProviderId] = { ...(p.enabled !== undefined ? { enabled: p.enabled } : {}), ...(p.model ? { model: p.model } : {}) };
    }
  }
  if (body.routes !== undefined) {
    out.routes = {};
    for (const [task, r] of Object.entries(body.routes ?? {}) as [string, any][]) {
      if (!TASK_CATALOG.some((t) => t.id === task)) bad(`Unknown task ${task}`);
      if (!isObj(r)) bad(`The route for ${task} must be an object`);
      if (r.provider && !PROVIDER_IDS.includes(r.provider)) bad('Unknown provider');
      if (r.mode && !['single', 'review', 'collaborate'].includes(r.mode)) bad('Mode must be single, review or collaborate');
      if (r.fallback !== undefined && typeof r.fallback !== 'boolean') bad('fallback must be true or false');
      out.routes[task] = { ...(r.provider ? { provider: r.provider } : {}), ...(r.mode ? { mode: r.mode } : {}), ...(r.fallback !== undefined ? { fallback: r.fallback } : {}) };
    }
  }
  if (body.monthly_limit_usd !== undefined) {
    const v = body.monthly_limit_usd;
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000)) bad('The monthly limit must be a number of dollars, or empty for no limit');
    out.monthly_limit_usd = v;
  }
  if (body.mcp !== undefined) {
    const m = body.mcp ?? {};
    if (m.enabled !== undefined && typeof m.enabled !== 'boolean') bad('enabled must be true or false');
    const off = Array.isArray(m.disabled_tools) ? m.disabled_tools.map(String) : [];
    if (off.some((n: string) => !TOOLS.some((t) => t.name === n))) bad('Unknown tool');
    out.mcp = { enabled: !!m.enabled, disabled_tools: off };
  }
  return out;
}

/** Request log as CSV for audit export. No prompt or document content is ever in it. */
export function toCsv(rows: AiRequestRow[]): string {
  const cols: (keyof AiRequestRow)[] = ['created_at', 'id', 'user_id', 'channel', 'kind', 'module', 'task', 'task_version', 'mode', 'provider', 'model', 'status', 'error_code', 'input_tokens', 'output_tokens', 'cost_usd', 'latency_ms', 'engagement_id', 'parent_id', 'fallback_from'];
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    // Quote, and stop a spreadsheet treating a value as a formula
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

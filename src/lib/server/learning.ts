import { db } from './db';
import { learnFromCorrection, norm } from './gate';
import type { Actor } from './state-guard';

/**
 * Learning from the firm's own confirmed work (option 1): nothing leaves the firm's data and no model
 * is trained. Confirmed mappings become client rules, so the next pull maps them the same way, and the
 * latest confirmed mappings are given to the AI as worked examples. Runs nightly and on "Learn now".
 */

const SYSTEM = (firmId: string): Actor => ({ id: 'system_learning', name: 'Blynt learning', role: 'admin', firmId });

/**
 * Turns the confirmed mappings of the given engagements into client rules (code → Blynt account), the
 * most recently confirmed winning. Rules already saying the same are left alone. Logged as one entry.
 */
export function learnFromConfirmed(firmId: string, engagementIds: string[], actor: Actor = SYSTEM(firmId)) {
  const engs = db.engagements.filter((e) => e.firm_id === firmId && engagementIds.includes(e.id));
  // Latest confirmation per client and ledger code
  const latest = new Map<string, { clientId: string; code: string; blynt: string; name: string; at: string }>();
  for (const eng of engs) {
    for (const m of db.account_mappings) {
      if (m.engagement_id !== eng.id || m.status !== 'confirmed' || !m.blynt_code || !m.source_code) continue;
      const key = `${eng.client_id}\u0000${m.source_code}`;
      const at = m.confirmed_at ?? '';
      if (!latest.has(key) || at > latest.get(key)!.at) latest.set(key, { clientId: eng.client_id, code: m.source_code, blynt: m.blynt_code, name: m.source_name, at });
    }
  }
  let added = 0;
  let changed = 0;
  for (const l of latest.values()) {
    if (!db.blynt_accounts.some((a) => a.code === l.blynt)) continue;
    const pattern = `code:${l.code}`;
    const rule = db.learned_rules.find((r) => r.firm_id === firmId && r.type === 'mapping' && r.scope === 'client' && r.client_id === l.clientId && norm(r.pattern) === norm(pattern));
    if (rule?.target_value === l.blynt && rule.active) continue;
    learnFromCorrection(actor, { type: 'mapping', scope: 'client', pattern, target_value: l.blynt, client_id: l.clientId, explanation: `Learned from the confirmed mapping of ${l.code} ${l.name}` });
    if (rule) changed++;
    else added++;
  }
  const summary = { engagements: engs.length, confirmed: latest.size, rules_added: added, rules_changed: changed };
  db.logAudit(firmId, actor, 'LEARN_FROM_CONFIRMED', 'learned_rules', engs.length === 1 ? engs[0].id : firmId, null, summary);
  return summary;
}

/** Every firm's open engagements, once a night: the nightly run fires several times, so a firm that learned in the last 20 hours is skipped. */
export function learnNightly(now = Date.now()) {
  const out: Record<string, ReturnType<typeof learnFromConfirmed>> = {};
  const since = new Date(now - 20 * 3_600_000).toISOString();
  for (const firm of db.firms) {
    if (db.audit_logs.some((a) => a.firm_id === firm.id && a.action === 'LEARN_FROM_CONFIRMED' && a.actor_id === 'system_learning' && a.at > since)) continue;
    const ids = db.engagements.filter((e) => e.firm_id === firm.id && e.status !== 'locked').map((e) => e.id);
    if (ids.length) out[firm.id] = learnFromConfirmed(firm.id, ids);
  }
  return out;
}

/**
 * Worked examples for the AI: the client's own confirmed mappings first, then the firm's, latest first,
 * one per ledger account. Other firms' work is never included.
 */
export function mappingExamples(firmId: string, clientId: string | null | undefined, limit = 40) {
  const engClient = new Map(db.engagements.filter((e) => e.firm_id === firmId).map((e) => [e.id, e.client_id]));
  const names = new Map(db.blynt_accounts.map((a) => [a.code, a.name]));
  const confirmed = db.account_mappings
    .filter((m) => engClient.has(m.engagement_id) && m.status === 'confirmed' && m.blynt_code && names.has(m.blynt_code))
    .sort((a, b) => {
      const own = (m: typeof a) => (engClient.get(m.engagement_id) === clientId ? 0 : 1);
      return own(a) - own(b) || (b.confirmed_at ?? '').localeCompare(a.confirmed_at ?? '');
    });
  const seen = new Set<string>();
  const out: { client_account: string; type: string; blynt_code: string; blynt_name: string; same_client: boolean }[] = [];
  for (const m of confirmed) {
    const key = norm(`${m.source_name}|${m.blynt_code}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ client_account: `${m.source_code} ${m.source_name}`, type: m.source_type, blynt_code: m.blynt_code!, blynt_name: names.get(m.blynt_code!)!, same_client: engClient.get(m.engagement_id) === clientId });
    if (out.length >= limit) break;
  }
  return out;
}

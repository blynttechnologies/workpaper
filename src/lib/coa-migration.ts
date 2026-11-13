import { STANDARD_CHART, V2_TO_V3 } from './standard-chart';

/**
 * Chart v2 (three-digit codes) to v3 (four-digit). Saved workspaces are converted as they load, so
 * this runs on every import; it only touches three-digit values, which v3 never uses, so a converted
 * workspace passes through unchanged.
 *
 * Only Blynt codes change. Client ledger codes (source_code, transactions) and the append-only logs
 * keep what was recorded.
 */

// Collections that hold Blynt codes. tb_lines, transactions and the audit logs are left as recorded.
const COLLECTIONS = ['blynt_accounts', 'mapping_rules', 'account_mappings', 'adjustments', 'templates', 'workpapers', 'schedule_versions', 'learned_rules'] as const;
// Fields whose value (or list of values) is a Blynt code
const CODE_KEYS = new Set(['code', 'blynt_code', 'parent_code', 'class_code', 'expense_code', 'bank_account_code', 'dep', 'to', 'lead', 'leads', 'codes']);
const V2 = /^\d{3}$/;

/** The v3 code for every v2 code in the workspace: the standard map, then the practice's own accounts. */
function codeMap(accounts: { code: string; is_system?: boolean }[]): Map<string, string> {
  const map = new Map(Object.entries(V2_TO_V3));
  const taken = new Set([...STANDARD_CHART.map((a) => a.code), ...map.values(), ...accounts.map((a) => a.code).filter((c) => !V2.test(c))]);
  // A practice's own account moves to code × 10, or the next free number after it (421 → 4210, else 4211…)
  for (const { code } of accounts) {
    if (!V2.test(code) || map.has(code)) continue;
    let n = Number(code) * 10;
    while (taken.has(String(n)) && n < Number(code) * 10 + 9) n++;
    map.set(code, String(n));
    taken.add(String(n));
  }
  return map;
}

function convert(value: unknown, map: Map<string, string>, codeField = false): unknown {
  if (typeof value === 'string') {
    if (codeField && V2.test(value)) return map.get(value) ?? `${value}0`;
    const acc = /^acc_(\d{3})$/.exec(value); // bank and cash rows are keyed by code
    return acc ? `acc_${map.get(acc[1]) ?? `${acc[1]}0`}` : value;
  }
  if (Array.isArray(value)) return value.map((v) => convert(v, map, codeField));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Notes and settings kept per account are keyed by its code
      const key = V2.test(k) && map.has(k) ? map.get(k)! : k;
      out[key] = convert(v, map, CODE_KEYS.has(k));
    }
    return out;
  }
  return value;
}

/** Converts a saved workspace from chart v2 codes to v3 in place. */
export function migrateCodes(state: Record<string, unknown[] | undefined>) {
  const accounts = (state.blynt_accounts ?? []) as { code: string }[];
  const map = codeMap(accounts);
  for (const k of COLLECTIONS) {
    if (Array.isArray(state[k])) state[k] = convert(state[k], map) as unknown[];
  }
  // A learned mapping rule's target is a Blynt code; other rules hold free text
  for (const r of (state.learned_rules ?? []) as { type?: string; target_value?: string }[]) {
    if (r.type === 'mapping' && r.target_value && V2.test(r.target_value)) r.target_value = map.get(r.target_value) ?? `${r.target_value}0`;
  }
  return state;
}

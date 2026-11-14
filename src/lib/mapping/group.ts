import { asPence } from '../money';
import type { AccountMapping } from '../types/models';

// The ledger's own account types, in the order Xero and QuickBooks list a trial balance; others follow alphabetically
const TYPE_ORDER = ['revenue', 'sales', 'income', 'other income', 'direct costs', 'cost of sales', 'expense', 'expenses', 'overhead', 'overheads',
  'fixed asset', 'non-current asset', 'bank', 'current asset', 'inventory', 'prepayment', 'current liability', 'liability', 'non-current liability', 'equity'];
const typeRank = (t: string) => {
  const i = TYPE_ORDER.indexOf(t.toLowerCase());
  return i < 0 ? TYPE_ORDER.length : i;
};
const size = (m: Pick<AccountMapping, 'balance_p'>) => {
  const p = asPence(m.balance_p);
  return p < 0n ? -p : p;
};

/** Mapping lines grouped by ledger type; largest balance first within a group (debit or credit), or kept in the order given. */
export function groupMappings<T extends Pick<AccountMapping, 'source_type' | 'balance_p'>>(rows: T[], sortBy: 'amount' | 'code') {
  const byType = new Map<string, T[]>();
  for (const m of rows) {
    const t = m.source_type?.trim() || 'Other';
    byType.set(t, [...(byType.get(t) ?? []), m]);
  }
  return [...byType]
    .sort(([a], [b]) => typeRank(a) - typeRank(b) || a.localeCompare(b))
    .map(([type, list]) => ({
      type,
      total: list.reduce((s, m) => s + asPence(m.balance_p), 0n),
      rows: sortBy === 'code' ? list : [...list].sort((a, b) => (size(b) > size(a) ? 1 : size(b) < size(a) ? -1 : 0)),
    }));
}

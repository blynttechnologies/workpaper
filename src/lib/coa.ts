import { STANDARD_CHART } from './standard-chart';
import { BlyntAccount } from './types/models';
import { structureForCompanyType } from './practice-structure';

export interface CoaCategory {
  name: string;
  from: number;
  to: number;
  /** The standard account a new code is classified like when nothing more specific is chosen */
  other: string;
}

/** Number ranges of the chart. A new account must stay inside its category's range. */
export const CATEGORIES: CoaCategory[] = [
  { name: 'Revenue', from: 1000, to: 1999, other: '1400' },
  { name: 'Cost of sales', from: 2000, to: 2999, other: '2900' },
  { name: 'Staff costs', from: 3000, to: 3999, other: '3900' },
  { name: 'Administrative expenses', from: 4000, to: 4999, other: '4990' },
  { name: 'Finance income, investments and tax', from: 5000, to: 5999, other: '5100' },
  { name: 'Bank and cash', from: 6000, to: 6499, other: '6490' },
  { name: 'Fixed assets and investments', from: 6500, to: 6999, other: '6500' },
  { name: 'Current assets', from: 7000, to: 7499, other: '7490' },
  { name: 'Current liabilities', from: 7500, to: 7999, other: '7700' },
  { name: 'Long-term liabilities and provisions', from: 8000, to: 8499, other: '8300' },
  { name: 'Equity and reserves', from: 8500, to: 8999, other: '8800' },
];

export const categoryOf = (code: string | number) => CATEGORIES.find((c) => Number(code) >= c.from && Number(code) <= c.to) ?? null;

/** Standard accounts a new code in this category can be classified like. */
export const accountsIn = (cat: CoaCategory) => STANDARD_CHART.filter((a) => categoryOf(a.code) === cat);

/** The next free code after the base account, or from the start of the range when the rest is full. */
export function nextCode(existing: { code: string }[], cat: CoaCategory, base = cat.other): string | null {
  const used = new Set(existing.map((a) => Number(a.code)));
  const start = Math.max(cat.from, Number(base) + 1);
  for (let n = start; n <= cat.to; n++) if (!used.has(n)) return String(n);
  for (let n = cat.from; n < start; n++) if (!used.has(n)) return String(n);
  return null;
}

// Share capital, directors' loans and corporation tax exist only for limited companies
const COMPANY_ONLY = new Set(['5500', '7400', '7450', '7950', '7980', '8500', '8600', '8700']);

/** The chart for one client: their business type's accounts plus accounts added for them. No client means the whole chart. */
export function accountsForClient<T extends BlyntAccount>(accounts: T[], client?: { id: string; company_type?: string }): T[] {
  if (!client) return accounts;
  const structure = structureForCompanyType(client.company_type ?? '');
  return accounts.filter((a) => (!a.client_id || a.client_id === client.id) && (a.structure ? a.structure === structure : structure === 'ltd' || !COMPANY_ONLY.has(a.code)));
}

/** Expenses a client often splits finer than the chart, and the standard account a new one sits beside. */
const NEW_ACCOUNT_BASES: [RegExp, string][] = [
  [/clean|waste/i, '4040'],
  [/entertain/i, '3320'],
];
export const newAccountBase = (name: string) => NEW_ACCOUNT_BASES.find(([pattern]) => pattern.test(name))?.[1] ?? null;

const GENERIC_WORDS = new Set(['and', 'the', 'for', 'other', 'cost', 'costs', 'expense', 'expenses', 'fee', 'fees', 'charge', 'charges', 'account', 'accounts', 'business', 'general']);
const nameWords = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC_WORDS.has(w));

/** Existing accounts sharing a meaningful word with the name, closest first: possible duplicates. */
export function similarAccounts<T extends { code: string; name: string }>(existing: T[], name: string, limit = 3): T[] {
  const wanted = new Set(nameWords(name));
  return existing
    .map((account) => ({ account, shared: nameWords(account.name).filter((w) => wanted.has(w)).length }))
    .filter((m) => m.shared > 0)
    .sort((a, b) => b.shared - a.shared || Number(a.account.code) - Number(b.account.code))
    .slice(0, limit)
    .map((m) => m.account);
}

/**
 * A practice's own account. It inherits type, lead, statutory line and schedule from a standard
 * account in the same category (the chosen base, else the category's "Other" account).
 * shortcut: codes stay unique across the practice even for client-only accounts, because reports look an account up by code alone; give each client its own number space if practices run out.
 * Returns an error message when the code is not allowed.
 */
export function newAccount(existing: BlyntAccount[], code: string, name: string, firmId: string, baseCode?: string, clientId?: string): BlyntAccount | string {
  code = code.trim();
  name = name.trim();
  if (!/^\d{1,6}$/.test(code)) return 'The code must be a number.';
  if (!name) return 'Give the account a name.';
  const cat = categoryOf(code);
  if (existing.some((a) => a.code === code)) {
    const free = cat && nextCode(existing, cat, code);
    return `Code ${code} is already in the chart.${free ? ` Next free: ${free}.` : ''}`;
  }
  if (!cat) return `Code ${code} is outside every category of the chart.`;
  const want = baseCode ? categoryOf(baseCode) : cat;
  if (want !== cat) return want ? `Code ${code} must be within ${want.from}–${want.to} (${want.name}).` : `Code ${baseCode} is not a standard account.`;
  const parent = STANDARD_CHART.find((a) => a.code === baseCode) ?? STANDARD_CHART.find((a) => a.code === cat.other)!;
  const { used_by_count: _u, ...base } = parent;
  return { ...base, code, name, firm_id: firmId, parent_code: parent.code, is_control: false, is_system: false, ...(clientId ? { client_id: clientId } : {}) };
}

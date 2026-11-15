import { db } from '../server/db';
import { asPence } from '../money';
import type { LedgerTransaction } from '../types/models';
import { TEMPLATES } from './templates';
import type { Anchor, LeadFigure, PaperCheck } from './engine';

/**
 * Shared pieces for the redesigned papers: the ledger behind a set of chart codes, open items
 * cleared oldest first, and journals built from decisions (checked against what was sent).
 */

export interface PaperContext {
  wpId: string;
  engagementId: string;
  periodStart: string;
  periodEnd: string;
  priorId: string | null;
  data: Record<string, any>;
  leads: LeadFigure[];
  checks: PaperCheck[];
  anchors: Anchor[];
  totals: Record<string, bigint>;
  /** How many files are linked to a row of this paper. */
  files: (rowId: string) => number;
  /** Trial balance for a chart code or prefix, debit-positive, before and after accepted journals. */
  tb: (prefix: string, engagementId?: string) => { draft: bigint; adjustments: bigint; final: bigint; mapped: boolean };
}

/* ---------- Journals built from decisions ---------- */

export interface JLine {
  code: string;
  debit: bigint;
  credit: bigint;
  narrative: string;
}

/** A balanced pair: debit one code, credit another. A negative amount swaps the sides. */
export const pair = (dr: string, cr: string, amount: bigint, narrative: string): JLine[] =>
  amount === 0n
    ? []
    : amount < 0n
      ? pair(cr, dr, -amount, narrative)
      : [
          { code: dr, debit: amount, credit: 0n, narrative },
          { code: cr, debit: 0n, credit: amount, narrative },
        ];

export const journalSig = (lines: JLine[]) => lines.map((l) => `${l.code}:${l.debit}:${l.credit}`).join('|');

/** Passes when nothing is needed and nothing was sent, or what was sent matches the decisions now. */
/** Where a journal sent from a paper is now: Blynt's journals only, a draft in Xero, posted in Xero, or in the trial balance. */
export function journalWhere(id: string | undefined, ref: string | undefined): string {
  const j = id ? db.adjustments.find((a) => a.id === id) : undefined;
  if (j?.status === 'in_ledger') return `${ref} is posted in Xero and in the trial balance.`;
  if (j?.ledger?.status === 'POSTED') return `${ref} is posted in Xero. The next pull brings it into the trial balance.`;
  if (j?.ledger?.status === 'DRAFT') return `${ref} is a draft in Xero. Approve it there, and the next pull brings it in.`;
  if (j?.status === 'approved' || j?.status === 'posted') return `${ref} is approved in Blynt. Send it to Xero from the Journals page.`;
  return `Saved as ${ref} in Blynt's journals, not in Xero yet. Approve it on the Journals page, then send it to Xero.`;
}

/** True once the journal is posted in Xero and inside the imported trial balance, so the paper's figures already include it. */
export const journalInLedger = (id: string | undefined) => !!id && db.adjustments.find((a) => a.id === id)?.status === 'in_ledger';

export function journalCheck(sent: { id?: string; ref?: string; sig?: string } | undefined, lines: JLine[], label = 'Adjustments sent to journals'): PaperCheck {
  if (journalInLedger(sent?.id)) return { id: 'journal_sent', label, detail: journalWhere(sent!.id, sent!.ref), passed: true };
  const ok = sent ? sent.sig === journalSig(lines) : lines.length === 0;
  return {
    id: 'journal_sent',
    label,
    detail: ok
      ? sent
        ? journalWhere(sent.id, sent.ref)
        : 'The decisions need no journal.'
      : sent
        ? `The decisions changed after ${sent.ref} was sent. Remove ${sent.ref} on the Journals page and send again.`
        : 'Send the journal built from the decisions.',
    passed: ok,
  };
}

/* ---------- The ledger ---------- */

const mapped = (engagementId: string) => db.account_mappings.filter((m) => m.engagement_id === engagementId && m.blynt_code);

/** The code papers route an account by: a practice's own account goes wherever the standard account it was created beside goes. */
export function routeCode(code: string) {
  if (parents?.of !== db.blynt_accounts || parents.n !== db.blynt_accounts.length) {
    parents = { of: db.blynt_accounts, n: db.blynt_accounts.length, map: new Map(db.blynt_accounts.filter((a) => a.parent_code).map((a) => [a.code, a.parent_code!])) };
  }
  return parents.map.get(code) ?? code;
}
let parents: { of: unknown; n: number; map: Map<string, string> } | null = null;

/** Whether a chart code falls under a paper's lead code (a code or a prefix). */
export const inLead = (code: string | null | undefined, lead: string) => !!code && (code === lead || routeCode(code).startsWith(lead));

// Summary and planning papers read every code; they are not where an account is worked
export const NOT_A_SCHEDULE = new Set(['A-10', 'Z-10', 'Z-20', 'Z-30', 'Z-40', 'R-10', 'R-20']);

/** The schedule papers an account is worked on. */
export const papersForCode = (code: string) => TEMPLATES.filter((t) => !NOT_A_SCHEDULE.has(t.ref) && t.leads.some((l) => inLead(code, l.code)));

/** Ledger transactions on the client accounts mapped to any of these chart codes or prefixes. */
export function ledgerFor(engagementId: string, prefixes: string[]): LedgerTransaction[] {
  const codes = new Set(mapped(engagementId).filter((m) => prefixes.some((p) => inLead(m.blynt_code, p))).map((m) => m.source_code));
  return db.transactions.filter((t) => t.engagement_id === engagementId && codes.has(t.account_code));
}

/** The chart code a client account is mapped to. */
export function chartCodeOf(engagementId: string, sourceCode: string): string | null {
  return mapped(engagementId).find((m) => m.source_code === sourceCode)?.blynt_code ?? null;
}

/** True when the ledger has anything after the period end, so receipts and payments after it can be known. */
export const afterDateKnown = (engagementId: string, periodEnd: string) => db.transactions.some((t) => t.engagement_id === engagementId && t.date > periodEnd);

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

/** Cost and overhead codes in the chart, for expense pickers. */
export const expenseCodes = () => db.blynt_accounts.filter((a) => a.type === 'Cost of Sales' || a.type === 'Overhead').map((a) => ({ code: a.code, name: a.name }));
export const chartName = (code: string) => db.blynt_accounts.find((a) => a.code === code)?.name ?? code;

/**
 * Open items at the period end for one contact. `sign` is +1 for assets (invoices are debits)
 * and -1 for liabilities (bills are credits). Items in the other direction up to the period end
 * clear the oldest first; what they don't use is returned as `unused` (a balance the other way).
 */
export function openItems(txs: LedgerTransaction[], periodEnd: string, sign: 1n | -1n) {
  const before = txs.filter((t) => t.date <= periodEnd).sort((a, b) => a.date.localeCompare(b.date));
  let clearing = before.reduce((acc, t) => (sign * asPence(t.amount_p) < 0n ? acc - sign * asPence(t.amount_p) : acc), 0n);
  const open: { tx: LedgerTransaction; amount: bigint; days: number }[] = [];
  for (const t of before) {
    const amount = sign * asPence(t.amount_p);
    if (amount <= 0n) continue;
    const used = clearing < amount ? clearing : amount;
    clearing -= used;
    if (amount > used) open.push({ tx: t, amount: amount - used, days: daysBetween(t.date, periodEnd) });
  }
  return { open, unused: clearing, balance: open.reduce((acc, o) => acc + o.amount, 0n) - clearing };
}

/** Group by contact, sorted by name. */
export function byContact(txs: LedgerTransaction[]) {
  const m = new Map<string, LedgerTransaction[]>();
  for (const t of txs) {
    const k = t.contact || 'No name';
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
}

/** The expense code a contact's bills are most often posted to. */
export function usualExpenseCode(engagementId: string, contact: string): string | null {
  const counts = new Map<string, number>();
  for (const t of db.transactions) {
    if (t.engagement_id !== engagementId || t.contact !== contact) continue;
    const code = chartCodeOf(engagementId, t.account_code);
    if (code && /^[234]/.test(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24);

import { asPence, formatPence } from '../money';
import { db } from '../server/db';
import type { BankPayment } from '../server/xero';
import type { DebtorOpenItem, DebtorPayment } from '../types/models';
import { addDays, afterDateKnown, byContact, chartCodeOf, journalCheck, ledgerFor, openItems, pair, slug, usualExpenseCode, type JLine, type PaperContext } from './common';

/**
 * Trade creditors (K-10): one row per supplier from the creditors control account, the
 * supplier's statement balance against it, payments after the period end, and a search of the
 * weeks after the period end for bills that belong to this year. Amounts owed are positive.
 */

export type SupplierDecision = 'missing_invoice' | 'timing' | 'not_ours' | 'debtors' | 'leave';

export interface Supplier {
  id: string;
  name: string;
  ledger_p: string; // owed at the period end per ledger (negative: a debit balance)
  statement_p: string; // '' until entered
  paid_after_p: string;
  oldest_days?: number;
  invoices?: { ref: string; date: string; due?: string; days: number; amount_p: string; url?: string; total_p?: string; payments?: DebtorPayment[] }[];
  payments_after?: { date: string; desc: string; amount_p: string; url?: string }[];
  overdue?: boolean; // oldest_days counts days past the due date, not the bill's age
  aged?: { current_p: string; d30_p: string; d60_p: string; d90_p: string }; // not due, 1-30, 31-60 and over 60 days overdue
  expense_code?: string;
  vat_p?: string; // VAT inside a missing invoice
  decision?: SupplierDecision;
  reason?: string;
  dispute?: 'ask' | 'not_disputed';
  dispute_reason?: string;
  bank_check?: { to: string; matches: BankPayment[] }; // Xero bank payments after the period end that look like this supplier's
  // What the AI read off the attached statement (file: attachment id). balance_p '' when it could not read one. Nothing is filled in until someone uses it.
  ai_statement?: { file: string; balance_p: string; date?: string; page?: number; confidence?: number };
}

const plainName = (n: string) => n.toLowerCase().replace(/\b(ltd|limited|plc|llp)\b/g, '').replace(/[^a-z0-9]/g, '');

/** Bank payments that are to this supplier by name, or are for exactly an open invoice or the balance owed. */
export function bankMatches(s: Supplier, payments: BankPayment[]): BankPayment[] {
  const name = plainName(s.name);
  const amounts = new Set([s.ledger_p, ...(s.invoices ?? []).map((i) => i.amount_p)].filter((a) => asPence(a) > 0n).map((a) => asPence(a).toString()));
  return payments.filter((p) => {
    const payee = plainName(p.contact);
    return (!!name && !!payee && (payee.includes(name) || name.includes(payee))) || amounts.has(p.amount_p);
  });
}

export type SearchDecision = 'accrue' | 'creditor' | 'not_liability';

export interface SearchItem {
  id: string;
  date: string;
  contact: string;
  desc: string;
  amount_p: string;
  code: string;
  url?: string;
  decision?: SearchDecision;
}

export function supplierView(s: Supplier) {
  const ledger = asPence(s.ledger_p);
  const entered = s.statement_p !== '' && s.statement_p != null;
  const statement = entered ? asPence(s.statement_p) : null;
  const diff = statement === null ? null : statement - ledger;
  const paid = asPence(s.paid_after_p);
  const debit = ledger < 0n;
  const suggestion =
    debit
      ? { kind: 'debtors' as const, why: `${formatPence(-ledger)} is owed by the supplier, so it belongs in other debtors, not creditors.` }
      : diff !== null && diff > 0n
        ? { kind: 'missing_invoice' as const, why: `The statement shows ${formatPence(diff)} more than the ledger. If it is an invoice dated before the period end, add it to creditors.` }
        : diff !== null && diff < 0n
          ? { kind: 'timing' as const, why: `The ledger shows ${formatPence(-diff)} more than the statement. A payment made just before the period end that reached the supplier after their statement date explains this.` }
          : null;
  const decided = !suggestion || !!s.decision;
  const needsDispute = !debit && ledger > 0n && paid === 0n && (s.oldest_days ?? 0) > 60;
  const status: 'none' | 'difference' | 'debit' | 'dispute' | 'done' =
    debit ? (s.decision ? 'done' : 'debit') : !entered ? 'none' : diff !== 0n && !s.decision ? 'difference' : needsDispute && !s.dispute ? 'dispute' : 'done';
  return { s, ledger, statement, entered, diff, paid, debit, suggestion, decided, needsDispute, status };
}

/**
 * Suppliers at the period end; decisions already made are kept. From the bills Xero had open at the period
 * end when the last pull read them, as its Aged Payables does; otherwise from the creditors control account.
 */
export function suppliersFromLedger(engagementId: string, periodEnd: string, windowDays: number, existing: Supplier[] = []): Supplier[] | null {
  const open = db.engagements.find((e) => e.id === engagementId)?.creditor_open_items;
  if (open?.as_at === periodEnd && open.items.length) return suppliersFromOpenItems(open.items, engagementId, periodEnd, windowDays, existing);
  const tx = ledgerFor(engagementId, ['7500']);
  if (!tx.length) return null;
  const until = addDays(periodEnd, windowDays);
  const out: Supplier[] = [];
  for (const [name, txs] of byContact(tx)) {
    const { open, balance } = openItems(txs, periodEnd, -1n);
    const payments = txs.filter((t) => t.date > periodEnd && t.date <= until && asPence(t.amount_p) > 0n);
    if (balance === 0n && !payments.length) continue;
    const paid = payments.reduce((acc, t) => acc + asPence(t.amount_p), 0n);
    const prev = existing.find((x) => x.name === name);
    out.push({
      id: prev?.id ?? `sup_${out.length + 1}_${slug(name)}`,
      name,
      ledger_p: balance.toString(),
      statement_p: prev?.statement_p ?? '',
      paid_after_p: (balance > 0n ? (paid < balance ? paid : balance) : paid).toString(),
      oldest_days: open[0]?.days ?? 0,
      invoices: open.map((o) => ({ ref: o.tx.description, date: o.tx.date, days: o.days, amount_p: o.amount.toString(), ...(o.tx.external_url ? { url: o.tx.external_url } : {}) })),
      payments_after: payments.map((t) => ({ date: t.date, desc: t.description, amount_p: t.amount_p, ...(t.external_url ? { url: t.external_url } : {}) })),
      expense_code: prev?.expense_code ?? usualExpenseCode(engagementId, name) ?? undefined,
      ...(prev ? { vat_p: prev.vat_p, decision: prev.decision, reason: prev.reason, dispute: prev.dispute, bank_check: prev.bank_check } : {}),
    });
  }
  return out;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * One row per supplier from the open bills and credits. Days overdue count the due date as the first, so a
 * bill due on the period end is 1 day overdue. Paid after the period end is the money paid against these
 * bills within the window; credits applied after it are not money paid.
 */
export function suppliersFromOpenItems(items: DebtorOpenItem[], engagementId: string, periodEnd: string, windowDays: number, existing: Supplier[] = []): Supplier[] {
  const until = addDays(periodEnd, windowDays);
  const overdue = (it: DebtorOpenItem) => Math.max(0, daysBetween(it.due, periodEnd) + 1);
  const groups = new Map<string, DebtorOpenItem[]>();
  for (const it of items) groups.set(it.contact || 'No name', [...(groups.get(it.contact || 'No name') ?? []), it]);
  const out: Supplier[] = [];
  for (const [name, its] of Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const balance = its.reduce((acc, it) => acc + asPence(it.amount_p), 0n);
    if (balance === 0n) continue;
    const payments = its.flatMap((it) =>
      (it.payments ?? []).filter((p) => p.how === 'payment' && p.date > periodEnd && p.date <= until).map((p) => ({ date: p.date, desc: `Paid against ${it.ref}`, amount_p: p.amount_p, ...(it.url ? { url: it.url } : {}) }))
    ).sort((a, b) => a.date.localeCompare(b.date));
    const paid = payments.reduce((acc, p) => acc + asPence(p.amount_p), 0n);
    const owed = its.filter((it) => asPence(it.amount_p) > 0n);
    const aged = { current_p: 0n, d30_p: 0n, d60_p: 0n, d90_p: 0n };
    for (const it of its) {
      const d = overdue(it);
      aged[d === 0 ? 'current_p' : d <= 30 ? 'd30_p' : d <= 60 ? 'd60_p' : 'd90_p'] += asPence(it.amount_p);
    }
    const prev = existing.find((x) => x.name === name);
    out.push({
      id: prev?.id ?? `sup_${out.length + 1}_${slug(name)}`,
      name,
      ledger_p: balance.toString(),
      statement_p: prev?.statement_p ?? '',
      paid_after_p: (balance > 0n ? (paid < balance ? paid : balance) : 0n).toString(),
      oldest_days: owed.length ? Math.max(...owed.map(overdue)) : 0,
      overdue: true,
      aged: { current_p: aged.current_p.toString(), d30_p: aged.d30_p.toString(), d60_p: aged.d60_p.toString(), d90_p: aged.d90_p.toString() },
      invoices: its.map((it) => ({
        ref: `${it.kind === 'invoice' ? '' : `${it.kind[0].toUpperCase()}${it.kind.slice(1)} `}${it.ref}`,
        date: it.date, due: it.due, days: overdue(it), amount_p: it.amount_p,
        ...(it.url ? { url: it.url } : {}), ...(it.total_p ? { total_p: it.total_p } : {}), ...(it.payments?.length ? { payments: it.payments } : {}),
      })),
      payments_after: payments,
      expense_code: prev?.expense_code ?? usualExpenseCode(engagementId, name) ?? undefined,
      ...(prev ? { vat_p: prev.vat_p, decision: prev.decision, reason: prev.reason, dispute: prev.dispute, bank_check: prev.bank_check } : {}),
    });
  }
  return out;
}

/**
 * The search for unrecorded liabilities: costs posted after the period end, within the window
 * and over the minimum. Each needs a decision, since only the bill says which period it is for.
 */
export function searchAfterDate(engagementId: string, periodEnd: string, windowDays: number, minimum: bigint, existing: SearchItem[] = []): SearchItem[] {
  const until = addDays(periodEnd, windowDays);
  return ledgerFor(engagementId, ['2', '3', '4'])
    .filter((t) => t.date > periodEnd && t.date <= until && asPence(t.amount_p) >= minimum)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const id = `srch_${t.id}`;
      const prev = existing.find((x) => x.id === id);
      return { id, date: t.date, contact: t.contact, desc: t.description, amount_p: t.amount_p, code: chartCodeOf(engagementId, t.account_code) ?? '4990', ...(t.external_url ? { url: t.external_url } : {}), ...(prev?.decision ? { decision: prev.decision } : {}) };
    });
}

export function creditorsJournal(data: Record<string, any>): JLine[] {
  const lines: JLine[] = [];
  for (const v of ((data.suppliers ?? []) as Supplier[]).map(supplierView)) {
    if (v.s.decision === 'debtors' && v.debit) lines.push(...pair('7200', '7500', -v.ledger, `${v.s.name}: debit balance to other debtors`));
    if (v.s.decision === 'missing_invoice' && v.diff && v.diff > 0n) {
      const vat = asPence(v.s.vat_p);
      const net = v.diff - vat;
      lines.push({ code: v.s.expense_code || '4990', debit: net, credit: 0n, narrative: `${v.s.name}: invoice missing from the ledger` });
      if (vat > 0n) lines.push({ code: '7800', debit: vat, credit: 0n, narrative: `${v.s.name}: VAT on missing invoice` });
      lines.push({ code: '7500', debit: 0n, credit: v.diff, narrative: `${v.s.name}: invoice missing from the ledger` });
    }
  }
  for (const i of (data.search?.items ?? []) as SearchItem[]) {
    if (i.decision === 'accrue') lines.push(...pair(i.code, '7600', asPence(i.amount_p), `${i.contact || i.desc}: accrued, paid ${i.date}`));
    if (i.decision === 'creditor') lines.push(...pair(i.code, '7500', asPence(i.amount_p), `${i.contact || i.desc}: invoice for this year posted after the period end`));
  }
  return lines;
}

export function reviewCreditors(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const views = ((data.suppliers ?? []) as Supplier[]).map(supplierView);
  const control = -ctx.tb('7500').draft; // owed, before our journals
  const mapped = ctx.tb('7500').mapped;
  const aged = views.reduce((acc, v) => acc + v.ledger, 0n);
  const owedViews = views.filter((v) => v.ledger > 0n);
  const owed = owedViews.reduce((acc, v) => acc + v.ledger, 0n);
  const paid = owedViews.reduce((acc, v) => acc + (v.paid < v.ledger ? v.paid : v.ledger), 0n);
  const items: SearchItem[] = data.search?.items ?? [];
  const found = items.filter((i) => i.decision === 'accrue' || i.decision === 'creditor').reduce((acc, i) => acc + asPence(i.amount_p), 0n);
  const lines = creditorsJournal(data);
  const toCreditors = lines.filter((l) => l.code === '7500').reduce((acc, l) => acc + l.credit - l.debit, 0n);
  Object.assign(totals, {
    control,
    aged,
    difference: aged - control,
    owed,
    paid_after: paid,
    found,
    debit_balances: views.filter((v) => v.debit).reduce((acc, v) => acc - v.ledger, 0n),
    after_adjustments: control + toCreditors,
  });
  views.forEach((v) => anchors.push({ id: v.s.id, label: `${v.s.name} · statement` }));

  checks.push({
    id: 'control_tb',
    label: 'Aged creditors agree to TB 7500',
    detail: !mapped ? 'No confirmed trial balance mapping for trade creditors yet.' : `Aged creditors ${formatPence(aged)} · TB 7500 ${formatPence(control)} · difference ${formatPence(aged - control)}`,
    passed: mapped && aged === control,
  });
  const diffs = views.filter((v) => v.diff !== null && v.diff !== 0n && !v.debit);
  const unexplained = diffs.filter((v) => !v.s.decision);
  checks.push({
    id: 'differences',
    label: 'Statement differences explained',
    detail: unexplained.length ? `Explain the difference for ${unexplained.map((v) => v.s.name).join(', ')}.` : diffs.length ? `${diffs.length} difference(s), all explained.` : 'No statement differences.',
    passed: !unexplained.length,
  });
  const noStatement = owedViews.filter((v) => !v.entered || !ctx.files(v.s.id));
  checks.push({
    id: 'statements',
    label: `Statement on file for every supplier owed (${owedViews.length - noStatement.length}/${owedViews.length})`,
    detail: noStatement.length ? `Enter and attach the statement for ${noStatement.map((v) => v.s.name).join(', ')}.` : 'Every supplier owed money has a statement entered and attached.',
    passed: !noStatement.length,
  });
  const undecided = items.filter((i) => !i.decision);
  checks.push({
    id: 'search',
    label: 'Search for unrecorded liabilities done',
    detail: !data.search?.searched_at
      ? 'Run the search after the period end.'
      : !afterDateKnown(ctx.engagementId, ctx.periodEnd)
        ? 'The ledger has nothing after the period end yet. Import the later transactions, then search again.'
        : undecided.length
          ? `${undecided.length} item(s) still to decide.`
          : `${items.length} item(s) checked.`,
    passed: !!data.search?.searched_at && afterDateKnown(ctx.engagementId, ctx.periodEnd) && !undecided.length,
  });
  const debits = views.filter((v) => v.debit);
  const debitsOpen = debits.filter((v) => !v.s.decision || (v.s.decision === 'leave' && !v.s.reason?.trim()));
  checks.push({
    id: 'debit_balances',
    label: 'Debit balances dealt with',
    detail: debitsOpen.length ? `Move to debtors or explain: ${debitsOpen.map((v) => v.s.name).join(', ')}.` : debits.length ? 'Every debit balance is moved or explained.' : 'No debit balances.',
    passed: !debitsOpen.length,
  });
  const disputes = views.filter((v) => v.needsDispute && (!v.s.dispute || (v.s.dispute === 'not_disputed' && !v.s.dispute_reason?.trim())));
  checks.push({
    id: 'disputes',
    label: 'Unpaid balances checked for disputes',
    detail: disputes.length ? `Nothing paid since the period end and over 60 days old (ask the client, or give the reason it is not disputed): ${disputes.map((v) => v.s.name).join(', ')}.` : 'No old unpaid balances left unchecked.',
    passed: !disputes.length,
  });
  checks.push(journalCheck(data.journal, lines));

  return !mapped
    ? ''
    : `Trade creditors of ${formatPence(control)} ${aged === control ? 'agree to the aged creditors listing' : `differ from the aged creditors listing by ${formatPence(aged - control)}`}. ${formatPence(paid)} of ${formatPence(owed)} was paid after the period end.${
        found ? ` The search after the period end found ${formatPence(found)} of liabilities for this year, now recorded.` : ''
      }${toCreditors ? ` Adjustments change trade creditors to ${formatPence(control + toCreditors)}.` : ''}`;
}

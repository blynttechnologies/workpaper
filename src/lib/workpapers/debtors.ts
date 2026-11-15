import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { inLead } from './common';
import type { DebtorOpenItem } from '../types/models';

/**
 * Trade debtors (C-10): one line per customer, aged at the period end, with what was
 * received after it. Suggestions are rules, not guesses: a balance over 90 days that
 * receipts after the period end don't reach is suggested for a specific provision, and a
 * credit balance is suggested for creditors. Nothing changes until someone decides.
 */

export type DebtorDecision = 'provide' | 'no_provision' | 'creditors';

export interface DebtorLine {
  id: string;
  desc: string;
  ref?: string;
  current_p: string;
  d30_p: string;
  d60_p: string;
  d90_p: string;
  after_date_p: string;
  decision?: DebtorDecision;
  provision_p?: string;
  reason?: string;
  oldest_days?: number;
  invoices?: { ref: string; date: string; days: number; amount_p: string; url?: string }[];
  receipts?: { date: string; desc: string; amount_p: string; url?: string }[];
}

export type DebtorStatus = 'suggest' | 'credit' | 'provided' | 'moved' | 'no_provision' | 'collected' | 'recoverable' | 'nil';

export function debtorView(l: DebtorLine) {
  const cur = asPence(l.current_p);
  const d30 = asPence(l.d30_p);
  const d60 = asPence(l.d60_p);
  const d90 = asPence(l.d90_p);
  const total = cur + d30 + d60 + d90;
  const after = asPence(l.after_date_p);
  // Receipts after the period end are taken to pay the newer debts first, so only the old debt they don't reach is at risk
  const newer = cur + d30 + d60;
  const reachesOld = after > newer ? after - newer : 0n;
  const unpaidOld = d90 > reachesOld ? d90 - reachesOld : 0n;
  const suggestion =
    total < 0n
      ? { kind: 'creditors' as const, amount: -total, why: `A credit balance of ${formatPence(-total)} is owed to the customer, so it belongs in creditors.` }
      : unpaidOld > 0n
        ? {
            kind: 'provide' as const,
            amount: unpaidOld,
            why: `${formatPence(d90)} is in the oldest ageing column${after > 0n ? ` and receipts after the period end (${formatPence(after)}) only cover the newer invoices` : ' and nothing has been received since the period end'}.`,
          }
        : null;
  const provision = l.decision === 'provide' ? asPence(l.provision_p ?? suggestion?.amount ?? 0n) : 0n;
  const moved = l.decision === 'creditors' && total < 0n ? -total : 0n;
  const status: DebtorStatus =
    l.decision === 'provide'
      ? 'provided'
      : l.decision === 'creditors'
        ? 'moved'
        : l.decision === 'no_provision'
          ? 'no_provision'
          : total < 0n
            ? 'credit'
            : suggestion
              ? 'suggest'
              : total === 0n
                ? 'nil'
                : after < total
                  ? 'recoverable'
                  : 'collected';
  const needsDecision = (!!suggestion && !l.decision) || (l.decision === 'no_provision' && !l.reason?.trim());
  return { line: l, cur, d30, d60, d90, total, after, suggestion, provision, moved, status, needsDecision, stillDue: total > after ? total - after : 0n };
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Aged debtors from the ledger: the debtors control account's invoices, payments and credit
 * notes per customer. Payments and credits up to the period end clear the oldest invoices
 * first; what's left is aged by invoice date. Receipts after the period end are listed per
 * customer. Decisions already made on a customer are kept. Null when the ledger has nothing.
 */
export function agedDebtorsFromLedger(engagementId: string, existing: DebtorLine[] = []) {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) return null;
  const pe = eng.period_end;
  // The ledger's own open items at the period end give the true balance per customer, as Xero's Aged Receivables does
  if (eng.debtor_open_items?.as_at === pe && eng.debtor_open_items.items.length) {
    return { lines: agedFromOpenItems(eng.debtor_open_items.items, pe, existing), receiptsKnown: true, periodEnd: pe, basis: 'due' as const };
  }
  const codes = new Set(
    db.account_mappings.filter((m) => m.engagement_id === engagementId && inLead(m.blynt_code, '7100')).map((m) => m.source_code)
  );
  const tx = db.transactions.filter((t) => t.engagement_id === engagementId && codes.has(t.account_code));
  if (!tx.length) return null;

  const byContact = new Map<string, typeof tx>();
  for (const t of tx) byContact.set(t.contact || 'No customer name', [...(byContact.get(t.contact || 'No customer name') ?? []), t]);

  const lines: DebtorLine[] = [];
  for (const [contact, txs] of Array.from(byContact.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const before = txs.filter((t) => t.date <= pe).sort((a, b) => a.date.localeCompare(b.date));
    let credits = before.reduce((acc, t) => (asPence(t.amount_p) < 0n ? acc - asPence(t.amount_p) : acc), 0n);
    const open: { ref: string; date: string; days: number; amount: bigint; url?: string }[] = [];
    for (const t of before) {
      const amount = asPence(t.amount_p);
      if (amount <= 0n) continue;
      const paid = credits < amount ? credits : amount;
      credits -= paid;
      if (amount > paid) open.push({ ref: t.description, date: t.date, days: daysBetween(t.date, pe), amount: amount - paid, url: t.external_url });
    }
    const buckets = { current: -credits, d30: 0n, d60: 0n, d90: 0n }; // unused credits leave a credit balance
    for (const o of open) buckets[o.days <= 30 ? 'current' : o.days <= 60 ? 'd30' : o.days <= 90 ? 'd60' : 'd90'] += o.amount;
    const total = buckets.current + buckets.d30 + buckets.d60 + buckets.d90;
    // A credit note dated after the period end is not money received
    const receipts = txs.filter((t) => t.date > pe && asPence(t.amount_p) < 0n && !/creditnote/i.test(t.external_url ?? ''));
    if (total === 0n) continue;
    const received = receipts.reduce((acc, t) => acc - asPence(t.amount_p), 0n);
    const prev = existing.find((l) => l.desc === contact);
    lines.push({
      id: prev?.id ?? `deb_${lines.length + 1}_${contact.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
      desc: contact,
      ref: prev?.ref ?? '',
      current_p: buckets.current.toString(),
      d30_p: buckets.d30.toString(),
      d60_p: buckets.d60.toString(),
      d90_p: buckets.d90.toString(),
      after_date_p: (total > 0n ? (received < total ? received : total) : 0n).toString(),
      oldest_days: open.length ? open[0].days : 0,
      invoices: open.map((o) => ({ ref: o.ref, date: o.date, days: o.days, amount_p: o.amount.toString(), ...(o.url ? { url: o.url } : {}) })),
      receipts: receipts.map((t) => ({ date: t.date, desc: t.description, amount_p: (-asPence(t.amount_p)).toString(), ...(t.external_url ? { url: t.external_url } : {}) })),
      ...(prev?.decision ? { decision: prev.decision, provision_p: prev.provision_p, reason: prev.reason } : {}),
    });
  }
  // Without anything dated after the period end, receipts after it can't be known
  const receiptsKnown = db.transactions.some((t) => t.engagement_id === engagementId && t.date > pe);
  return { lines, receiptsKnown, periodEnd: pe, basis: 'invoice' as const, fromXero: tx.some((t) => t.source === 'Xero') };
}

/**
 * One line per customer from the open items, aged by how far past its due date each item was at the
 * period end: not yet due, 1 to 30 days overdue, 31 to 60, and over 60 (the provision column).
 * A credit is aged by its own date. Decisions already made on a customer are kept.
 */
export function agedFromOpenItems(items: DebtorOpenItem[], pe: string, existing: DebtorLine[] = []): DebtorLine[] {
  const byContact = new Map<string, DebtorOpenItem[]>();
  for (const it of items) byContact.set(it.contact || 'No customer name', [...(byContact.get(it.contact || 'No customer name') ?? []), it]);
  const lines: DebtorLine[] = [];
  for (const [contact, its] of Array.from(byContact.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const buckets = { current: 0n, d30: 0n, d60: 0n, d90: 0n };
    for (const it of its) {
      const overdue = daysBetween(it.due, pe);
      buckets[overdue <= 0 ? 'current' : overdue <= 30 ? 'd30' : overdue <= 60 ? 'd60' : 'd90'] += asPence(it.amount_p);
    }
    const total = buckets.current + buckets.d30 + buckets.d60 + buckets.d90;
    if (total === 0n) continue;
    const owed = its.filter((it) => asPence(it.amount_p) > 0n).sort((a, b) => a.due.localeCompare(b.due));
    const received = its.reduce((acc, it) => acc + asPence(it.received_after_p), 0n);
    const prev = existing.find((l) => l.desc === contact);
    lines.push({
      id: prev?.id ?? `deb_${lines.length + 1}_${contact.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
      desc: contact,
      ref: prev?.ref ?? '',
      current_p: buckets.current.toString(),
      d30_p: buckets.d30.toString(),
      d60_p: buckets.d60.toString(),
      d90_p: buckets.d90.toString(),
      after_date_p: (total > 0n ? (received < total ? received : total) : 0n).toString(),
      oldest_days: owed.length ? Math.max(0, daysBetween(owed[0].due, pe)) : 0,
      invoices: its.map((it) => ({ ref: `${it.kind === 'invoice' ? '' : `${it.kind[0].toUpperCase()}${it.kind.slice(1)} `}${it.ref}`, date: it.date, days: Math.max(0, daysBetween(it.due, pe)), amount_p: it.amount_p, ...(it.url ? { url: it.url } : {}) })),
      receipts: its
        .filter((it) => asPence(it.received_after_p) > 0n)
        .map((it) => ({ date: it.received_after_on ?? '', desc: `Paid against ${it.ref}`, amount_p: it.received_after_p, ...(it.url ? { url: it.url } : {}) })),
      ...(prev?.decision ? { decision: prev.decision, provision_p: prev.provision_p, reason: prev.reason } : {}),
    });
  }
  return lines;
}

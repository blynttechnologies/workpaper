import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { addDays, chartCodeOf, inLead, daysBetween, journalCheck, journalInLedger, ledgerFor, pair, type JLine, type PaperContext } from './common';
import { REVENUE_CODES } from './revenue';
import type { LedgerTransaction, ScheduleGate } from '../types/models';
import type { PaperCheck } from './engine';

/**
 * Prepayments and accrued income (C-20): the prepaid part of each cost that runs past the
 * period end, worked out by days or months; costs in the ledger that look like they run past
 * it, for a decision; last year's prepayments released; accrued income worked the same way from
 * sales invoiced after the period end, with what the Revenue paper accrued shown beside it.
 * The journal reverses on the first day of next year.
 */

/** The paper's two tabs by name. A check or a row says which it is about, and the screen names its tabs from here so the two cannot drift. */
export const PREP_TABS = { prep: 'Prepayments', accrued: 'Accrued income' } as const;

/** The first few names and how many more, so a long list does not fill the review panel: "A, B, C and 15 more". */
export const named = (names: string[], sep = ', ') => (names.length > 4 ? `${names.slice(0, 3).join(sep)} and ${names.length - 3} more` : names.join(sep));

export interface PrepLine {
  id: string;
  desc: string;
  code: string; // the cost account it was charged to
  invoice_date?: string;
  start?: string;
  end?: string;
  net_p: string;
  method: 'days' | 'months' | 'all';
  found?: boolean; // found in the ledger, needs a decision
  decision?: 'add' | 'not';
  url?: string; // the record in Xero
  ref?: string; // its invoice number
  /** The AI's reading of the description: the period it covers when that can be told, and a line on whether it runs past the year end. */
  ai?: { from: string; to: string; summary: string } & Partial<ScheduleGate>;
}

const LOOKS_PREPAID = /insurance|annual|subscription|licen[cs]e|renewal|in advance|quarter|booking|deposit for|rent/i;
const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/** The part of a cost that belongs after the period end. */
export function prepaidPart(l: PrepLine, periodEnd: string): bigint {
  const net = asPence(l.net_p);
  if (l.method === 'all') return net;
  if (!l.start || !l.end || l.end < l.start || l.end <= periodEnd) return 0n;
  if (l.method === 'months') {
    const total = monthIndex(l.end) - monthIndex(l.start) + 1;
    const after = monthIndex(l.end) - monthIndex(periodEnd);
    return total > 0 ? (net * BigInt(Math.min(after, total)) + BigInt(total) / 2n) / BigInt(total) : 0n;
  }
  const total = daysBetween(l.start, l.end) + 1;
  const after = daysBetween(l.start > periodEnd ? addDays(l.start, -1) : periodEnd, l.end);
  return (net * BigInt(Math.min(after, total)) + BigInt(total) / 2n) / BigInt(total);
}

/** The part of a sale invoiced after the period end that was earned on or before it: what is left once the part after it is taken off. */
export function accruedPart(l: PrepLine, periodEnd: string): bigint {
  if (l.method === 'all') return asPence(l.net_p);
  // A period that starts after the period end earns nothing by it, also by months when the period end is mid-month
  if (!l.start || !l.end || l.end < l.start || l.start > periodEnd) return 0n;
  return asPence(l.net_p) - prepaidPart(l, periodEnd);
}

/** One line worked out. `prepaid` is the part carried forward: the prepaid part of a cost, or with `accrued` the accrued part of a sale. */
export function prepView(l: PrepLine, periodEnd: string, accrued = false) {
  const counted = !l.found || l.decision === 'add';
  const worked = l.method === 'all' || (!!l.start && !!l.end);
  const prepaid = counted ? (accrued ? accruedPart : prepaidPart)(l, periodEnd) : 0n;
  const months = l.method === 'months';
  const total = !worked || l.method === 'all' ? 0 : months ? monthIndex(l.end!) - monthIndex(l.start!) + 1 : daysBetween(l.start!, l.end!) + 1;
  const after = !worked || l.method === 'all' ? 0 : Math.max(0, months ? monthIndex(l.end!) - monthIndex(periodEnd) : daysBetween(l.start! > periodEnd ? addDays(l.start!, -1) : periodEnd, l.end!));
  const span =
    l.method === 'all'
      ? `All ${accrued ? 'before' : 'after'} the period end`
      : !worked
        ? 'Enter the period covered'
        : `${accrued ? Math.max(0, total - after) : after} of ${total} ${months ? 'months' : 'days'} ${accrued ? 'up to' : 'after'} the period end`;
  return { l, counted, worked, prepaid, span };
}

/** A found cost the AI read as ending on or before the period end: wholly in the year, so it is not offered as a prepayment. */
export const withinYear = (l: PrepLine, periodEnd: string) => !!l.found && !l.decision && !!l.ai?.to && l.ai.to <= periodEnd;
/** A found sale the AI read as starting after the period end: wholly next year's, so it is not offered as accrued income. */
export const nextYear = (l: PrepLine, periodEnd: string) => !!l.found && !l.decision && !!l.ai?.from && l.ai.from > periodEnd;

/** The search both tabs share: a new line for each ledger row not on the list yet, and where each opens in Xero. `net` is the row's amount as the line holds it. */
function findLines(engagementId: string, prefix: string, looks: LedgerTransaction[], net: (t: LedgerTransaction) => string, fallback: string, minimum: bigint, existing: PrepLine[]) {
  const small = looks.filter((t) => asPence(net(t)) < minimum);
  // Where each row opens in Xero, also for lines found by an earlier search
  const links = new Map(looks.map((t) => [`${prefix}_${t.id}`, { ...(t.external_url ? { url: t.external_url } : {}), ...(t.ref ? { ref: t.ref } : {}) }]));
  // A new pull from Xero renumbers the ledger rows, so a line whose id has gone is matched by date, description and amount
  const moved = existing.filter((l) => l.found && !links.has(l.id));
  const found: PrepLine[] = [];
  const dupes = new Set<string>(); // the same cost suggested again under its new id, before this matching
  for (const t of looks) {
    const id = `${prefix}_${t.id}`;
    const desc = [t.contact, t.description].filter(Boolean).join(' · ');
    const same = existing.find((l) => l.id === id);
    const at = same?.decision ? -1 : moved.findIndex((l) => l.invoice_date === t.date && l.desc === desc && l.net_p === net(t));
    if (at >= 0) {
      // The earlier line carries the work done on it, so it stays and takes the link
      links.set(moved.splice(at, 1)[0].id, links.get(id)!);
      if (same) dupes.add(id);
    } else if (!same && asPence(net(t)) >= minimum) {
      found.push({ id, desc, code: chartCodeOf(engagementId, t.account_code) ?? fallback, invoice_date: t.date, start: t.date, net_p: net(t), method: 'days', found: true, ...links.get(id) });
    }
  }
  return { found, links, dupes, small: small.length, smallTotal: small.reduce((a, t) => a + asPence(net(t)), 0n) };
}

/** Costs in the last year before the period end that read like they run past it. */
export function findPrepaidCosts(engagementId: string, periodEnd: string, minimum: bigint, existing: PrepLine[]) {
  const from = addDays(periodEnd, -365);
  const costs = ledgerFor(engagementId, ['4']).filter((t) => t.date > from && t.date <= periodEnd && asPence(t.amount_p) > 0n);
  const looks = costs.filter((t) => LOOKS_PREPAID.test(`${t.description} ${t.contact}`));
  return { ...findLines(engagementId, 'prep', looks, (t) => t.amount_p, '4990', minimum, existing), scanned: costs.length };
}

export const ACCRUED_WINDOW = 60; // days after the period end, the same as the Revenue cut-off looks

/**
 * Sales invoiced in the 60 days after the period end: each may be for work done before it. No wording
 * marks such a sale, so every one at or over the amount is listed and the AI reads which look like this year's.
 */
export function findAccruedSales(engagementId: string, periodEnd: string, minimum: bigint, existing: PrepLine[]) {
  // A sale the Revenue cut-off has decided is not offered again, or it could be accrued twice
  const decided = new Set(revenueCutoff(engagementId).filter((i) => i.decision).map(revenueKey));
  const net = (t: LedgerTransaction) => (-asPence(t.amount_p)).toString();
  const sales = ledgerFor(engagementId, REVENUE_CODES).filter(
    (t) => t.date > periodEnd && t.date <= addDays(periodEnd, ACCRUED_WINDOW) && asPence(t.amount_p) < 0n && !decided.has(saleKey(t.date, [t.contact, t.description].filter(Boolean).join(' · '), net(t)))
  );
  const r = findLines(engagementId, 'acc', sales, net, '1000', minimum, existing);
  // The invoice date is after the work, so the period is left for the invoice to give
  return { ...r, found: r.found.map(({ start: _start, ...l }) => l as PrepLine), scanned: sales.length };
}

/** Last year's paper: its prepayments, and whether its journal was reversed into this year. */
export function lastYear(ctx: Pick<PaperContext, 'priorId' | 'engagementId'>) {
  const wp = ctx.priorId ? db.workpapers.find((w) => w.engagement_id === ctx.priorId && w.ref === 'C-20') : undefined;
  const priorEnd = db.engagements.find((e) => e.id === ctx.priorId)?.period_end ?? '';
  const lines = ((wp?.data_json?.prepayments ?? []) as PrepLine[]).map((l) => prepView(l, priorEnd)).filter((v) => v.prepaid > 0n);
  const journalId = wp?.data_json?.journal?.id as string | undefined;
  const reversed = !!journalId && db.adjustments.some((a) => a.engagement_id === ctx.engagementId && a.reverses_id === journalId);
  // With no schedule from last year here, what the ledger held in prepayments a year earlier is the only figure for it
  // It is on the lines of the latest trial balance, for the client's accounts mapped to prepayments
  const snapshot = lines.length ? undefined : db.tb_snapshots.filter((s) => s.engagement_id === ctx.engagementId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const mapped = new Set(db.account_mappings.filter((m) => m.engagement_id === ctx.engagementId && m.status === 'confirmed' && inLead(m.blynt_code, '7300')).map((m) => m.source_code));
  const held = snapshot ? db.tb_lines.filter((l) => l.snapshot_id === snapshot.id && mapped.has(l.source_code) && l.comparative_p != null) : [];
  const ledger = held.length ? held.reduce((a, l) => a + asPence(l.comparative_p!), 0n) : null;
  return { lines, total: lines.reduce((a, v) => a + v.prepaid, 0n), reversed, journalId, ledger };
}

const revenueCutoff = (engagementId: string) => (db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === 'I-10')?.data_json?.cutoff?.items ?? []) as any[];
// The same sale on both papers is known by its date, customer and amount, not its ledger row: a new pull from Xero renumbers the rows.
// shortcut: two sales alike in all three count as one, give the lines Xero's own invoice id if that shows up
const saleKey = (date: string | undefined, desc: string, net_p: string) => `${date}|${desc}|${net_p}`;
const revenueKey = (i: any) => saleKey(i.date, [i.contact, i.desc].filter(Boolean).join(' · '), i.amount_p);

/** Accrued income decided on the Revenue paper. */
export function accruedIncome(engagementId: string) {
  return revenueCutoff(engagementId).filter((i) => i.decision === 'accrue');
}

/** This paper's own accrued income lines, less any sale the Revenue paper has since accrued, so nothing is counted twice. */
export function accruedLines(engagementId: string, data: Record<string, any>): PrepLine[] {
  const onRevenue = accruedIncome(engagementId);
  const ids = new Set(onRevenue.map((i) => `acc_${i.id}`));
  const keys = new Set(onRevenue.map(revenueKey));
  return ((data.accrued_income ?? []) as PrepLine[]).filter((l) => !ids.has(l.id) && !(l.found && keys.has(saleKey(l.invoice_date, l.desc, l.net_p))));
}

export function prepaymentsJournal(ctx: Pick<PaperContext, 'priorId' | 'engagementId' | 'tb' | 'periodEnd'>, data: Record<string, any>): JLine[] {
  const lines: JLine[] = [];
  const ly = lastYear(ctx);
  // Last year's prepayments still sitting in 7300 (not reversed into this year) are charged now
  if (!ly.reversed && ctx.tb('7300').draft !== 0n) for (const v of ly.lines) lines.push(...pair(v.l.code, '7300', v.prepaid, `${v.l.desc}: last year's prepayment released`));
  for (const v of ((data.prepayments ?? []) as PrepLine[]).map((l) => prepView(l, ctx.periodEnd))) if (v.prepaid && v.l.code) lines.push(...pair('7300', v.l.code, v.prepaid, `${v.l.desc}: prepaid`));
  // Accrued income added on this paper; what the Revenue paper accrued is in its own journal
  for (const v of accruedLines(ctx.engagementId, data).map((l) => prepView(l, ctx.periodEnd, true))) if (v.prepaid && v.l.code) lines.push(...pair('7300', v.l.code, v.prepaid, `${v.l.desc}: accrued income`));
  return lines;
}

export function reviewPrepayments(ctx: PaperContext): string {
  const { data, totals, checks, anchors, periodEnd } = ctx;
  const prepViews = ((data.prepayments ?? []) as PrepLine[]).filter((l) => !withinYear(l, periodEnd)).map((l) => prepView(l, periodEnd));
  const accViews = accruedLines(ctx.engagementId, data).filter((l) => !nextYear(l, periodEnd)).map((l) => prepView(l, periodEnd, true));
  const prepaid = prepViews.reduce((a, v) => a + v.prepaid, 0n);
  const fromRevenue = accruedIncome(ctx.engagementId).reduce((a, i) => a + asPence(i.amount_p), 0n);
  const accrued = fromRevenue + accViews.reduce((a, v) => a + v.prepaid, 0n);
  const ly = lastYear(ctx);
  const draft = ctx.tb('7300').draft;
  const lines = prepaymentsJournal(ctx, data);
  Object.assign(totals, { prepaid, accrued, total: prepaid + accrued, last_year: ly.total, tb_draft: draft, tb_final: ctx.tb('7300').final });
  prepViews.forEach((v) => anchors.push({ id: v.l.id, label: v.l.desc || 'Prepayment', view: PREP_TABS.prep }));
  accViews.forEach((v) => anchors.push({ id: v.l.id, label: v.l.desc || 'Accrued income', view: PREP_TABS.accrued }));

  checks.push({
    id: 'mapped',
    label: 'Accounts mapped',
    detail: ctx.tb('7300').mapped ? 'The prepayments account in the trial balance feeds this paper.' : draft === 0n ? 'Nothing is in prepayments in the trial balance yet; the journal creates the balance.' : 'Map the client’s prepayments account to 730.',
    passed: ctx.tb('7300').mapped || draft === 0n,
  });
  // Each tab's lines have their own three checks, so the review panel can keep to the tab on screen
  const lineChecks = (view: string, pre: string, vs: typeof prepViews, t: { reviewed: string; decided: string; search: string; worked: string; invoice: string }): PaperCheck[] => {
    const undecided = vs.filter((v) => v.l.found && !v.l.decision);
    const unworked = vs.filter((v) => v.counted && (!v.worked || !v.l.code));
    const due = vs.filter((v) => v.counted && v.prepaid > 0n);
    const noInvoice = due.filter((v) => !ctx.files(v.l.id));
    return [
      { id: `${pre}found_reviewed`, view, label: t.reviewed, detail: undecided.length ? `Decide on ${named(undecided.map((v) => v.l.desc))}.` : t.search || t.decided, passed: !t.search && !undecided.length },
      { id: `${pre}worked`, view, label: t.worked, detail: unworked.length ? `Enter the period covered and the account for ${named(unworked.map((v) => v.l.desc))}.` : 'Every line has its period, so its part is calculated.', passed: !unworked.length },
      { id: `${pre}evidence`, view, label: `${t.invoice} (${due.length - noInvoice.length}/${due.length})`, detail: noInvoice.length ? `Attach the invoice for ${named(noInvoice.map((v) => v.l.desc))}.` : 'Every line has its invoice.', passed: !noInvoice.length },
    ];
  };
  const [reviewed, worked, evidence] = lineChecks(PREP_TABS.prep, '', prepViews, {
    reviewed: 'Costs past the year end reviewed',
    decided: 'Every cost found in the ledger has a decision.',
    search: data.scanned_at ? '' : 'Search the ledger for costs that run past the year end.',
    worked: 'Prepaid parts worked out',
    invoice: 'Invoice on every line',
  });
  checks.push(reviewed, worked);
  const releasedOk = ly.reversed || draft === 0n || draft === ly.total;
  checks.push({
    id: 'released',
    label: "Last year's prepayments released",
    detail: ly.reversed
      ? `Last year's journal was reversed on the first day of this year (${formatPence(ly.total)}).`
      : draft === 0n
        ? 'Nothing from last year is left in prepayments.'
        : draft === ly.total
          ? `${formatPence(ly.total)} from last year is still in prepayments; the journal releases it to the same costs.`
          : ly.ledger !== null
            ? `Prepayments hold ${formatPence(draft)} before adjustments; the ledger held ${formatPence(ly.ledger)} a year earlier. There is no schedule for last year here to release from, so find what is posted there.`
            : `Prepayments hold ${formatPence(draft)} before adjustments, which does not match last year's schedule (${formatPence(ly.total)}). Find what is posted there.`,
    passed: releasedOk,
  });
  checks.push(evidence);
  // Accrued income needs no search of its own: sales the Revenue paper accrued may be all there is
  checks.push(
    ...lineChecks(PREP_TABS.accrued, 'acc_', accViews, {
      reviewed: 'Sales after the year end reviewed',
      decided: 'Every sale found in the ledger has a decision.',
      search: '',
      worked: 'Accrued parts worked out',
      invoice: 'Invoice on every accrued line',
    })
  );
  const sent = journalCheck(data.journal, lines, 'Journal sent with reversal');
  // A journal in the ledger passes whatever changes after it. So say so when it already accrued a sale the Revenue paper has since accrued as well
  const kept = accruedLines(ctx.engagementId, data);
  const twice = ((data.accrued_income ?? []) as PrepLine[]).filter((l) => !kept.includes(l) && prepView(l, periodEnd, true).prepaid);
  checks.push(
    twice.length && journalInLedger(data.journal?.id)
      ? { ...sent, passed: false, detail: `${data.journal.ref} is in the ledger and already accrues ${twice.map((l) => l.desc).join(', ')}, which the Revenue paper now accrues too. Take the accrual off on the Revenue cut-off, or reverse ${data.journal.ref} and pull again.` }
      : sent
  );

  return prepaid || accrued
    ? `Prepayments of ${formatPence(prepaid)} are the parts of ${prepViews.filter((v) => v.prepaid > 0n).length} cost(s) that relate to the period after the year end, worked out from the periods on the invoices.${accrued ? ` Accrued income of ${formatPence(accrued)} ${fromRevenue === accrued ? 'comes from the Revenue paper' : 'is for work done before the year end and invoiced after it'}.` : ''} The journal reverses on the first day of next year.`
    : '';
}

import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { addDays, chartCodeOf, daysBetween, journalCheck, ledgerFor, pair, type JLine, type PaperContext } from './common';

/**
 * Prepayments and accrued income (C-20): the prepaid part of each cost that runs past the
 * period end, worked out by days or months; costs in the ledger that look like they run past
 * it, for a decision; last year's prepayments released; accrued income from the Revenue paper.
 * The journal reverses on the first day of next year.
 */

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
  ai?: { from: string; to: string; summary: string };
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

export function prepView(l: PrepLine, periodEnd: string) {
  const counted = !l.found || l.decision === 'add';
  const worked = l.method === 'all' || (!!l.start && !!l.end);
  const prepaid = counted ? prepaidPart(l, periodEnd) : 0n;
  const span =
    l.method === 'all'
      ? 'All after the period end'
      : !worked
        ? 'Enter the period covered'
        : l.method === 'months'
          ? `${Math.max(0, monthIndex(l.end!) - monthIndex(periodEnd))} of ${monthIndex(l.end!) - monthIndex(l.start!) + 1} months after the period end`
          : `${Math.max(0, daysBetween(l.start! > periodEnd ? addDays(l.start!, -1) : periodEnd, l.end!))} of ${daysBetween(l.start!, l.end!) + 1} days after the period end`;
  return { l, counted, worked, prepaid, span };
}

/** Costs in the last year before the period end that read like they run past it. */
export function findPrepaidCosts(engagementId: string, periodEnd: string, minimum: bigint, existing: PrepLine[]) {
  const from = addDays(periodEnd, -365);
  const costs = ledgerFor(engagementId, ['4']).filter((t) => t.date > from && t.date <= periodEnd && asPence(t.amount_p) > 0n);
  const looks = costs.filter((t) => LOOKS_PREPAID.test(`${t.description} ${t.contact}`));
  const small = looks.filter((t) => asPence(t.amount_p) < minimum);
  // Where each cost opens in Xero, also for lines found by an earlier search
  const links = new Map(looks.map((t) => [`prep_${t.id}`, { ...(t.external_url ? { url: t.external_url } : {}), ...(t.ref ? { ref: t.ref } : {}) }]));
  // A new pull from Xero renumbers the ledger rows, so a line whose id has gone is matched by date, description and amount
  const moved = existing.filter((l) => l.found && !links.has(l.id));
  const found: PrepLine[] = [];
  const dupes = new Set<string>(); // the same cost suggested again under its new id, before this matching
  for (const t of looks) {
    const id = `prep_${t.id}`;
    const desc = [t.contact, t.description].filter(Boolean).join(' · ');
    const same = existing.find((l) => l.id === id);
    const at = same?.decision ? -1 : moved.findIndex((l) => l.invoice_date === t.date && l.desc === desc && l.net_p === t.amount_p);
    if (at >= 0) {
      // The earlier line carries the work done on it, so it stays and takes the link
      links.set(moved.splice(at, 1)[0].id, links.get(id)!);
      if (same) dupes.add(id);
    } else if (!same && asPence(t.amount_p) >= minimum) {
      found.push({ id, desc, code: chartCodeOf(engagementId, t.account_code) ?? '4990', invoice_date: t.date, start: t.date, net_p: t.amount_p, method: 'days', found: true, ...links.get(id) });
    }
  }
  return { found, links, dupes, scanned: costs.length, small: small.length, smallTotal: small.reduce((a, t) => a + asPence(t.amount_p), 0n) };
}

/** Last year's paper: its prepayments, and whether its journal was reversed into this year. */
export function lastYear(ctx: Pick<PaperContext, 'priorId' | 'engagementId'>) {
  const wp = ctx.priorId ? db.workpapers.find((w) => w.engagement_id === ctx.priorId && w.ref === 'C-20') : undefined;
  const priorEnd = db.engagements.find((e) => e.id === ctx.priorId)?.period_end ?? '';
  const lines = ((wp?.data_json?.prepayments ?? []) as PrepLine[]).map((l) => prepView(l, priorEnd)).filter((v) => v.prepaid > 0n);
  const journalId = wp?.data_json?.journal?.id as string | undefined;
  const reversed = !!journalId && db.adjustments.some((a) => a.engagement_id === ctx.engagementId && a.reverses_id === journalId);
  return { lines, total: lines.reduce((a, v) => a + v.prepaid, 0n), reversed, journalId };
}

/** Accrued income decided on the Revenue paper. */
export function accruedIncome(engagementId: string) {
  const wp = db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === 'I-10');
  return ((wp?.data_json?.cutoff?.items ?? []) as any[]).filter((i) => i.decision === 'accrue');
}

export function prepaymentsJournal(ctx: Pick<PaperContext, 'priorId' | 'engagementId' | 'tb' | 'periodEnd'>, data: Record<string, any>): JLine[] {
  const lines: JLine[] = [];
  const ly = lastYear(ctx);
  // Last year's prepayments still sitting in 7300 (not reversed into this year) are charged now
  if (!ly.reversed && ctx.tb('7300').draft !== 0n) for (const v of ly.lines) lines.push(...pair(v.l.code, '7300', v.prepaid, `${v.l.desc}: last year's prepayment released`));
  for (const v of ((data.prepayments ?? []) as PrepLine[]).map((l) => prepView(l, ctx.periodEnd))) if (v.prepaid && v.l.code) lines.push(...pair('7300', v.l.code, v.prepaid, `${v.l.desc}: prepaid`));
  return lines;
}

export function reviewPrepayments(ctx: PaperContext): string {
  const { data, totals, checks, anchors, periodEnd } = ctx;
  const views = ((data.prepayments ?? []) as PrepLine[]).map((l) => prepView(l, periodEnd));
  const counted = views.filter((v) => v.counted);
  const prepaid = counted.reduce((a, v) => a + v.prepaid, 0n);
  const accrued = accruedIncome(ctx.engagementId).reduce((a, i) => a + asPence(i.amount_p), 0n);
  const ly = lastYear(ctx);
  const draft = ctx.tb('7300').draft;
  const lines = prepaymentsJournal(ctx, data);
  Object.assign(totals, { prepaid, accrued, total: prepaid + accrued, last_year: ly.total, tb_draft: draft });
  views.forEach((v) => anchors.push({ id: v.l.id, label: v.l.desc || 'Prepayment' }));

  checks.push({
    id: 'mapped',
    label: 'Accounts mapped',
    detail: ctx.tb('7300').mapped ? 'The prepayments account in the trial balance feeds this paper.' : draft === 0n ? 'Nothing is in prepayments in the trial balance yet; the journal creates the balance.' : 'Map the client’s prepayments account to 730.',
    passed: ctx.tb('7300').mapped || draft === 0n,
  });
  const undecided = views.filter((v) => v.l.found && !v.l.decision);
  checks.push({
    id: 'found_reviewed',
    label: 'Costs past the year end reviewed',
    detail: undecided.length ? `Decide on ${undecided.map((v) => v.l.desc).join(', ')}.` : data.scanned_at ? 'Every cost found in the ledger has a decision.' : 'Search the ledger for costs that run past the year end.',
    passed: !!data.scanned_at && !undecided.length,
  });
  const unworked = counted.filter((v) => !v.worked || !v.l.code);
  checks.push({
    id: 'worked',
    label: 'Prepaid parts worked out',
    detail: unworked.length ? `Enter the period covered and the cost account for ${unworked.map((v) => v.l.desc).join(', ')}.` : 'Every line has its period, so the prepaid part is calculated.',
    passed: !unworked.length,
  });
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
          : `Prepayments hold ${formatPence(draft)} before adjustments, which does not match last year's schedule (${formatPence(ly.total)}). Find what is posted there.`,
    passed: releasedOk,
  });
  const noInvoice = counted.filter((v) => v.prepaid > 0n && !ctx.files(v.l.id));
  checks.push({
    id: 'evidence',
    label: `Invoice on every line (${counted.filter((v) => v.prepaid > 0n).length - noInvoice.length}/${counted.filter((v) => v.prepaid > 0n).length})`,
    detail: noInvoice.length ? `Attach the invoice for ${noInvoice.map((v) => v.l.desc).join(', ')}.` : 'Every prepayment has its invoice.',
    passed: !noInvoice.length,
  });
  checks.push(journalCheck(data.journal, lines, 'Journal sent with reversal'));

  return prepaid || accrued
    ? `Prepayments of ${formatPence(prepaid)} are the parts of ${counted.filter((v) => v.prepaid > 0n).length} cost(s) that relate to the period after the year end, worked out from the periods on the invoices.${accrued ? ` Accrued income of ${formatPence(accrued)} comes from the Revenue paper.` : ''} The journal reverses on the first day of next year.`
    : '';
}

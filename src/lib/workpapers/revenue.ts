import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { addDays, chartCodeOf, chartName, journalCheck, ledgerFor, pair, type JLine, type PaperContext } from './common';

/**
 * Revenue (I-10): turnover by revenue account against last year, receipts in sales that are not
 * turnover, sales by month, turnover against the VAT returns, size thresholds, and the cut-off
 * either side of the period end. Decisions build one journal.
 */

export const REVENUE_CODES = ['100', '110', '120', '140', '190'];
export const MICRO_TURNOVER = 100_000_000n; // micro-entity turnover limit, £1m
export const VAT_THRESHOLD = 9_000_000n; // VAT registration threshold, £90,000

const NOT_TRADING = /\b(van|vehicle|car|lorry|truck|motor|asset|disposal|equipment sold|sale of|grant|insurance|compensation|claim|loan|capital introduced|director)\b/i;

export interface CutoffItem {
  id: string;
  date: string;
  contact: string;
  desc: string;
  amount_p: string; // net sales, positive
  code: string;
  decision?: 'accrue' | 'defer' | 'correct';
}

const income = (engagementId: string, from: string, to: string) =>
  ledgerFor(engagementId, REVENUE_CODES).filter((t) => t.date >= from && t.date <= to);

/** Revenue receipts that read like something other than sales. */
export function nonTrading(ctx: Pick<PaperContext, 'engagementId' | 'periodStart' | 'periodEnd'>) {
  return income(ctx.engagementId, ctx.periodStart, ctx.periodEnd)
    .filter((t) => asPence(t.amount_p) < 0n && NOT_TRADING.test(`${t.description} ${t.contact}`))
    .map((t) => ({
      id: t.id,
      date: t.date,
      contact: t.contact,
      desc: t.description,
      amount: -asPence(t.amount_p),
      code: chartCodeOf(ctx.engagementId, t.account_code) ?? '100',
      to: /grant|insurance|compensation|claim/i.test(`${t.description} ${t.contact}`) ? '140' : /loan|capital|director/i.test(`${t.description} ${t.contact}`) ? '798' : '493',
      url: t.external_url,
    }));
}

/** Sales either side of the period end for the cut-off review. */
export function cutoffWindow(ctx: Pick<PaperContext, 'engagementId' | 'periodEnd'>, existing: CutoffItem[] = []): CutoffItem[] {
  return income(ctx.engagementId, addDays(ctx.periodEnd, -30), addDays(ctx.periodEnd, 60))
    .filter((t) => asPence(t.amount_p) < 0n)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const prev = existing.find((x) => x.id === t.id);
      return { id: t.id, date: t.date, contact: t.contact, desc: t.description, amount_p: (-asPence(t.amount_p)).toString(), code: chartCodeOf(ctx.engagementId, t.account_code) ?? '100', ...(prev?.decision ? { decision: prev.decision } : {}) };
    });
}

/** Sales by month this year and last, from the ledger (credit-positive). */
export function salesByMonth(ctx: Pick<PaperContext, 'engagementId' | 'periodStart' | 'periodEnd' | 'priorId'>) {
  const months: { label: string; key: string; current: bigint; prior: bigint }[] = [];
  for (let d = ctx.periodStart.slice(0, 7); d <= ctx.periodEnd.slice(0, 7) && months.length < 24; ) {
    months.push({ key: d, label: new Date(`${d}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }), current: 0n, prior: 0n });
    const [y, m] = d.split('-').map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  for (const t of income(ctx.engagementId, ctx.periodStart, ctx.periodEnd)) {
    const m = months.find((x) => x.key === t.date.slice(0, 7));
    if (m) m.current -= asPence(t.amount_p);
  }
  const prior = ctx.priorId ? db.engagements.find((e) => e.id === ctx.priorId) : null;
  if (prior) {
    for (const t of income(prior.id, prior.period_start, prior.period_end)) {
      const idx = months.findIndex((x) => x.key.slice(5) === t.date.slice(5, 7));
      if (idx >= 0) months[idx].prior -= asPence(t.amount_p);
    }
  }
  return { months, hasLedger: months.some((m) => m.current !== 0n) };
}

export function revenueReview(ctx: PaperContext) {
  const { data } = ctx;
  const pct = Number(data.threshold_pct ?? 10);
  const minimum = asPence(data.threshold_p ?? '250000');
  const comments: Record<string, string> = data.comments ?? {};
  const streams = REVENUE_CODES.map((code) => {
    const t = ctx.tb(code);
    const current = -t.final;
    const prior = ctx.priorId ? -ctx.tb(code, ctx.priorId).final : null;
    const change = prior === null ? null : current - prior;
    const percent = change === null || !prior ? null : (Number(change) / Number(prior < 0n ? -prior : prior)) * 100;
    const abs = change === null ? 0n : change < 0n ? -change : change;
    const material = change !== null && abs >= minimum && (percent === null || Math.abs(percent) >= pct);
    return { code, name: chartName(code), current, prior, change, percent, material, mapped: t.mapped, explained: !!comments[code]?.trim() };
  }).filter((s) => s.mapped || s.current !== 0n || (s.prior ?? 0n) !== 0n);
  const turnover = streams.reduce((a, s) => a + s.current, 0n);
  const prior = ctx.priorId ? streams.reduce((a, s) => a + (s.prior ?? 0n), 0n) : null;
  const decisions: Record<string, { decision: 'remove' | 'turnover'; to?: string }> = data.nontrading ?? {};
  const odd = nonTrading(ctx).map((n) => ({ ...n, decided: decisions[n.id]?.decision, to: decisions[n.id]?.to ?? n.to }));
  const cutoff: CutoffItem[] = data.cutoff?.items ?? [];
  const lines: JLine[] = [
    ...odd.filter((n) => n.decided === 'remove').flatMap((n) => pair(n.code, n.to, n.amount, `${n.contact || n.desc}: not turnover`)),
    ...cutoff.filter((i) => i.decision === 'accrue').flatMap((i) => pair('730', i.code, asPence(i.amount_p), `${i.contact || i.desc}: work done before the year end, invoiced ${i.date}`)),
    ...cutoff.filter((i) => i.decision === 'defer').flatMap((i) => pair(i.code, '760', asPence(i.amount_p), `${i.contact || i.desc}: invoiced ${i.date} for work after the year end`)),
  ];
  const adjustment = lines.filter((l) => REVENUE_CODES.includes(l.code)).reduce((a, l) => a + l.credit - l.debit, 0n);
  const vat = data.vat_box6_p != null && data.vat_box6_p !== '' ? asPence(data.vat_box6_p) : null;
  const ledgerTotal = -income(ctx.engagementId, ctx.periodStart, ctx.periodEnd).reduce((a, t) => a + asPence(t.amount_p), 0n);
  const hasLedger = income(ctx.engagementId, ctx.periodStart, ctx.periodEnd).length > 0;
  return { pct, minimum, streams, turnover, prior, odd, cutoff, lines, adjustment, after: turnover + adjustment, vat, ledgerTotal, hasLedger };
}

export function reviewRevenue(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const r = revenueReview(ctx);
  const draftTurnover = -REVENUE_CODES.reduce((a, c) => a + ctx.tb(c).draft, 0n);
  Object.assign(totals, { turnover: r.turnover, adjustment: r.adjustment, after: r.after, ...(r.prior !== null ? { prior: r.prior } : {}), ...(r.vat !== null ? { vat: r.vat, vat_difference: r.after - r.vat } : {}) });
  r.cutoff.forEach((i) => anchors.push({ id: i.id, label: `Cut-off · ${i.contact || i.desc}` }));

  const mapped = r.streams.some((s) => s.mapped);
  checks.push({
    id: 'tb',
    label: 'Turnover agrees to TB',
    detail: !mapped ? 'No confirmed revenue mapping yet.' : r.hasLedger ? `Sales in the ledger ${formatPence(r.ledgerTotal)} · TB ${formatPence(draftTurnover)}` : `Turnover per TB ${formatPence(r.turnover)}; no ledger detail to agree it to.`,
    passed: mapped && (!r.hasLedger || r.ledgerTotal === draftTurnover),
  });
  const unexplained = r.streams.filter((s) => s.material && !s.explained);
  checks.push({
    id: 'movements',
    label: 'Material movements explained',
    detail: unexplained.length ? `Explain ${unexplained.map((s) => s.name).join(', ')}.` : r.prior === null ? 'No prior year to compare.' : 'Every movement over the threshold is explained.',
    passed: !unexplained.length,
  });
  checks.push({
    id: 'vat',
    label: 'Turnover reconciled to VAT returns',
    detail: r.vat === null ? 'Enter the sales on the VAT returns for the year (Box 6).' : `Turnover after adjustments ${formatPence(r.after)} · VAT returns ${formatPence(r.vat)} · difference ${formatPence(r.after - r.vat)}`,
    passed: r.vat !== null && r.vat === r.after,
  });
  checks.push({
    id: 'cutoff',
    label: 'Cut-off reviewed',
    detail: !data.cutoff?.reviewed_at ? `Check the sales ${r.cutoff.length ? `(${r.cutoff.length})` : ''} either side of the year end and mark the review done.` : `${r.cutoff.length} checked; ${r.cutoff.filter((i) => i.decision === 'accrue' || i.decision === 'defer').length} in the wrong year.`,
    passed: !!data.cutoff?.reviewed_at,
  });
  const oddOpen = r.odd.filter((n) => !n.decided);
  checks.push({
    id: 'non_trading',
    label: 'Non-trading income dealt with',
    detail: oddOpen.length ? `Decide on ${oddOpen.map((n) => `${n.contact || n.desc} (${formatPence(n.amount)})`).join(', ')}.` : r.odd.length ? 'Every receipt that looked like something other than sales is decided.' : 'Nothing in sales looks like non-trading income.',
    passed: !oddOpen.length,
  });
  checks.push(journalCheck(data.journal, r.lines, 'Journals sent to the ledger'));

  return mapped
    ? `Turnover of ${formatPence(r.after)}${r.prior !== null ? ` (${formatPence(r.prior)} last year)` : ''} was reviewed by revenue stream against last year${r.vat !== null ? ', agreed to the VAT returns' : ''} and checked for cut-off either side of the year end.${r.adjustment ? ` Adjustments of ${formatPence(r.adjustment)} were made.` : ''}`
    : '';
}

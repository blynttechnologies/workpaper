import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { chartCodeOf, daysBetween, type PaperContext } from './common';
import { dlaSummary } from './dla';

/**
 * Share capital and dividends (E-10): share capital against the TB and the shareholdings on the
 * Statutory information paper, and every dividend tested against distributable reserves on the
 * day it was paid: brought forward + profit to that date after estimated tax − dividends already
 * paid. A dividend that fails the test is unlawful and the shareholder may have to repay it.
 */

export interface ShareClass {
  id: string;
  name: string;
  shares: string;
  nominal_p: string; // per share
}

export interface Dividend {
  id: string;
  date: string;
  type: 'interim' | 'final';
  class_id?: string;
  amount_p: string;
}

const PL_TYPES = ['Revenue', 'Cost of Sales', 'Overhead'];
const plCodes = () => db.blynt_accounts.filter((a) => PL_TYPES.includes(a.type)).map((a) => a.code);
/** Tax on profit: corporation tax 5500-5590 and deferred tax 5600. */
const isTax = (c: string) => c.startsWith('55') || c.startsWith('56');

/** Profit before tax for an engagement from the trial balance (credit-positive), excluding the tax charge. */
export function profitBeforeTax(ctx: Pick<PaperContext, 'tb'>, engagementId: string) {
  return -plCodes()
    .filter((c) => !isTax(c))
    .reduce((a, c) => a + ctx.tb(c, engagementId).final, 0n);
}

/** Reserves at an engagement's end per its trial balance: retained earnings plus that year's profit after tax. */
function reservesPerTb(ctx: Pick<PaperContext, 'tb'>, engagementId: string) {
  return -ctx.tb('89', engagementId).final - plCodes().reduce((a, c) => a + ctx.tb(c, engagementId).final, 0n);
}

const taxOn = (profit: bigint, ratePct: number) => (profit > 0n ? (profit * BigInt(Math.round(ratePct * 100)) + 5000n) / 10000n : 0n);

/** Profit before tax from the start of the year to a date, from the ledger; pro rata by days when the ledger has no P&L detail. */
function profitTo(ctx: PaperContext, date: string, yearProfit: bigint) {
  const tx = db.transactions.filter((t) => t.engagement_id === ctx.engagementId && t.date >= ctx.periodStart && t.date <= ctx.periodEnd);
  const pl = new Set(plCodes().filter((c) => !isTax(c)));
  const plTx = tx.filter((t) => pl.has(chartCodeOf(ctx.engagementId, t.account_code) ?? ''));
  if (plTx.length) return { profit: -plTx.filter((t) => t.date <= date).reduce((a, t) => a + asPence(t.amount_p), 0n), source: 'ledger' as const };
  const days = daysBetween(ctx.periodStart, ctx.periodEnd) + 1;
  const toDate = Math.min(days, Math.max(0, daysBetween(ctx.periodStart, date) + 1));
  return { profit: (yearProfit * BigInt(toDate)) / BigInt(days), source: 'pro rata' as const };
}

export function equityReview(ctx: PaperContext) {
  const { data } = ctx;
  const rate = Number(data.tax_rate ?? 19);
  const classes: ShareClass[] = data.classes ?? [];
  const dividends = ((data.dividends ?? []) as Dividend[]).slice().sort((a, b) => a.date.localeCompare(b.date));
  const capital = classes.reduce((a, c) => a + BigInt(Math.round(Number(c.shares) || 0)) * asPence(c.nominal_p), 0n);
  const shares = classes.reduce((a, c) => a + BigInt(Math.round(Number(c.shares) || 0)), 0n);
  const capitalTb = -(ctx.tb('8500').draft + ctx.tb('8600').draft);
  const pbt = profitBeforeTax(ctx, ctx.engagementId);
  const taxPosted = ctx.tb('55').final + ctx.tb('56').final;
  const tax = taxPosted !== 0n ? taxPosted : taxOn(pbt, rate);
  const pat = pbt - tax;
  // Entered here, or on the Reserves movement paper, before last year's accounts or the TB
  const opening = [data.bf_p, db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'E-20')?.data_json?.opening_p].find((v) => v != null && v !== '');
  const bf = opening != null ? asPence(opening) : ctx.priorId ? reservesPerTb(ctx, ctx.priorId) : -ctx.tb('8900').draft;
  const bfSource = opening != null ? 'entered' : ctx.priorId ? "last year's accounts" : ctx.tb('8900').mapped ? 'retained earnings in the TB' : 'retained earnings not mapped in the TB';
  let paid = 0n;
  const tested = dividends.map((d) => {
    const amount = asPence(d.amount_p);
    const { profit, source } = profitTo(ctx, d.date, pbt);
    const available = bf + profit - taxOn(profit, rate) - paid;
    paid += amount;
    const cls = classes.find((c) => c.id === d.class_id) ?? classes[0];
    const clsShares = cls ? BigInt(Math.round(Number(cls.shares) || 0)) : 0n;
    return { d, amount, profit, source, available, cover: amount > 0n ? Number(available) / Number(amount) : null, lawful: available >= amount, perShare: clsShares ? amount / clsShares : null, cls };
  });
  const total = paid;
  const cf = bf + pat - total;
  const cfTb = reservesPerTb(ctx, ctx.engagementId);
  const holders = ((db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'R-20')?.data_json?.officers ?? []) as any[]).filter((o) => o.is_shareholder);
  const held = holders.reduce((a, o) => a + BigInt(/^\d+$/.test(o.shares ?? '') ? o.shares : 0), 0n);
  const dla = dlaSummary(ctx).dividends;
  return { rate, classes, capital, shares, capitalTb, pbt, tax, taxPosted, pat, bf, bfSource, tested, total, cf, cfTb, holders, held, dla };
}

export function reviewEquity(ctx: PaperContext): string {
  const { totals, checks, anchors } = ctx;
  const r = equityReview(ctx);
  Object.assign(totals, {
    capital: r.capital,
    capital_tb: r.capitalTb,
    difference: r.capital - r.capitalTb,
    dividends: r.total,
    reserves_bf: r.bf,
    profit_after_tax: r.pat,
    tax: r.tax,
    reserves_cf: r.cf,
    reserves_tb: r.cfTb,
  });
  r.tested.forEach((t) => anchors.push({ id: t.d.id, label: `Dividend ${t.d.date}` }));

  const mapped = ctx.tb('8500').mapped || ctx.tb('89').mapped;
  checks.push({ id: 'mapped', label: 'Accounts mapped', detail: mapped ? 'Share capital and reserves in the trial balance feed this paper.' : 'Map the client’s share capital and reserves accounts.', passed: mapped });
  checks.push({
    id: 'capital_tb',
    label: 'Share capital agrees to TB',
    detail: `Classes ${formatPence(r.capital)} · TB 8500 and 8600 ${formatPence(r.capitalTb)} · difference ${formatPence(r.capital - r.capitalTb)}`,
    passed: r.classes.length > 0 && r.capital === r.capitalTb,
  });
  checks.push({
    id: 'holdings',
    label: 'Shareholdings agree to share capital',
    detail: r.holders.length ? `Shareholders on the Statutory information paper hold ${r.held.toLocaleString('en-GB')} shares; the classes here total ${r.shares.toLocaleString('en-GB')}.` : 'Add the shareholders on the Statutory information paper.',
    passed: r.holders.length > 0 && r.held === r.shares,
  });
  const noPaper = r.tested.filter((t) => !ctx.files(t.d.id));
  checks.push({
    id: 'minutes',
    label: `Minutes and voucher for every dividend (${r.tested.length - noPaper.length}/${r.tested.length})`,
    detail: noPaper.length ? `Attach the board minutes and voucher for ${noPaper.map((t) => t.d.date).join(', ')}.` : 'Every dividend has its minutes and voucher.',
    passed: !noPaper.length,
  });
  const unlawful = r.tested.filter((t) => !t.lawful);
  checks.push({
    id: 'lawful',
    label: 'Every dividend covered by reserves when paid',
    detail: unlawful.length ? `Not covered: ${unlawful.map((t) => `${t.d.date} (${formatPence(t.amount)} against ${formatPence(t.available)} available)`).join('; ')}. The shareholder may have to repay it.` : r.tested.length ? 'Each dividend was covered by distributable reserves on the day it was paid.' : 'No dividends in the year.',
    passed: !unlawful.length,
  });
  if (r.total || r.dla) {
    checks.push({
      id: 'dla',
      label: "Dividends agree to the director's loan account",
      detail: `Dividends ${formatPence(r.total)} · credited on the director's loan account paper ${formatPence(r.dla)}. Explain any paid in cash instead.`,
      passed: r.total === r.dla,
    });
  }
  const unposted = r.taxPosted === 0n ? r.tax : 0n;
  checks.push({
    id: 'reserves',
    label: 'Reserves reconcile',
    detail: `Brought forward ${formatPence(r.bf)} + profit after tax ${formatPence(r.pat)} − dividends ${formatPence(r.total)} = ${formatPence(r.cf)} · TB ${formatPence(r.cfTb)}${unposted ? ` (the TB has no tax charge yet; the ${formatPence(unposted)} estimate explains that much)` : ''}.`,
    passed: r.cf === r.cfTb - unposted,
  });
  return r.classes.length
    ? `Share capital of ${formatPence(r.capital)} (${r.shares.toLocaleString('en-GB')} shares) agrees to the trial balance. ${r.tested.length} dividend(s) totalling ${formatPence(r.total)} were paid${
        r.tested.length ? (unlawful.length ? `; ${unlawful.length} was not covered by distributable reserves when paid` : ', each covered by distributable reserves on the day it was paid') : ''
      }. The profit and loss reserve is ${formatPence(r.cf)} at the year end.`
    : '';
}

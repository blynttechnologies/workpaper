import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { journalCheck, pair, type JLine, type PaperContext } from './common';

/**
 * Stock and work in progress (D-10): the count at cost, each unit cost against the latest
 * invoice, net realisable value below cost, the closing stock journal against 700, and a gross
 * margin test against last year. Stock is valued at the lower of cost and net realisable value.
 */

export const CATEGORIES = [
  ['raw', 'Raw materials and consumables'],
  ['wip', 'Work in progress'],
  ['finished', 'Finished goods'],
] as const;
export type StockCategory = (typeof CATEGORIES)[number][0];

export interface StockLine {
  id: string;
  desc: string;
  location?: string;
  category?: StockCategory;
  qty: string; // may have decimals (metres, kg)
  unit_cost_p?: string;
  amount_p?: string; // a value read from a count sheet without a unit cost
  invoice_cost_p?: string; // the latest purchase invoice's unit cost
  nrv_p?: string; // net realisable value per unit
  unclear?: boolean; // the quantity on the sheet is unclear and needs confirming
  decision_cost?: 'revalue' | 'keep';
  decision_nrv?: 'write_down' | 'keep';
  reason?: string;
}

const thousandths = (q: string) => BigInt(Math.round((Number(q) || 0) * 1000));
const times = (qty: string, unit: bigint) => (thousandths(qty) * unit + 500n) / 1000n;

export function stockView(l: StockLine) {
  const q = thousandths(l.qty);
  const unit = l.unit_cost_p ? asPence(l.unit_cost_p) : q ? (asPence(l.amount_p) * 1000n + q / 2n) / q : 0n;
  const counted = l.unit_cost_p ? times(l.qty, unit) : asPence(l.amount_p);
  const invoice = l.invoice_cost_p ? asPence(l.invoice_cost_p) : null;
  const nrv = l.nrv_p ? asPence(l.nrv_p) : null;
  const costHigh = invoice !== null && invoice < unit;
  const cost = costHigh && l.decision_cost === 'revalue' ? invoice! : unit;
  const nrvLow = nrv !== null && nrv < cost;
  const revaluation = costHigh && l.decision_cost === 'revalue' ? counted - times(l.qty, invoice!) : 0n;
  const writeDown = nrvLow && l.decision_nrv === 'write_down' ? times(l.qty, cost) - times(l.qty, nrv!) : 0n;
  const suggestions = [
    ...(costHigh && !l.decision_cost ? [{ kind: 'revalue' as const, amount: counted - times(l.qty, invoice!), why: `Counted at ${formatPence(unit)}, but the latest invoice is ${formatPence(invoice!)} a unit. On first-in, first-out the stock on hand was bought at the latest price: revalue to ${formatPence(invoice!)}, ${formatPence(counted - times(l.qty, invoice!))} lower.` }] : []),
    ...(nrvLow && !l.decision_nrv ? [{ kind: 'write_down' as const, amount: times(l.qty, cost) - times(l.qty, nrv!), why: `It can be sold for ${formatPence(nrv!)} a unit after selling costs, below its cost of ${formatPence(cost)}. Write it down to net realisable value: ${formatPence(times(l.qty, cost) - times(l.qty, nrv!))} lower.` }] : []),
  ];
  const status = suggestions.length ? (nrvLow && !l.decision_nrv ? 'nrv' : 'cost') : invoice === null ? 'support' : 'agreed';
  return { l, unit, counted, invoice, nrv, costHigh, nrvLow, revaluation, writeDown, closing: counted - revaluation - writeDown, suggestions, status };
}

function margin(ctx: PaperContext, engagementId: string, stockAdjustment: bigint) {
  const revenue = -db.blynt_accounts.filter((a) => a.type === 'Revenue').reduce((acc, a) => acc + ctx.tb(a.code, engagementId).final, 0n);
  const costOfSales = db.blynt_accounts.filter((a) => a.type === 'Cost of Sales').reduce((acc, a) => acc + ctx.tb(a.code, engagementId).final, 0n) - stockAdjustment;
  return { revenue, costOfSales, pct: revenue > 0n ? (Number(revenue - costOfSales) / Number(revenue)) * 100 : null };
}

export function stockJournal(closing: bigint, ledger: bigint): JLine[] {
  return pair('7000', '2500', closing - ledger, 'Closing stock: count less write-downs, against the ledger');
}

export function reviewStock(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const views = ((data.lines ?? []) as StockLine[]).map(stockView);
  const counted = views.reduce((a, v) => a + v.counted, 0n);
  const writeDowns = views.reduce((a, v) => a + v.revaluation + v.writeDown, 0n);
  const closing = counted - writeDowns;
  const tb = ctx.tb('7000');
  const ledger = tb.final;
  const lines = stockJournal(closing, ledger);
  const before = margin(ctx, ctx.engagementId, 0n);
  const after = margin(ctx, ctx.engagementId, closing - ledger);
  const prior = ctx.priorId ? margin(ctx, ctx.priorId, 0n) : null;
  const vouched = views.filter((v) => v.invoice !== null || ctx.files(v.l.id) > 0).reduce((a, v) => a + v.counted, 0n);
  Object.assign(totals, {
    counted,
    write_downs: writeDowns,
    closing,
    ledger,
    difference: closing - ledger,
    vouched,
    flagged: views.filter((v) => v.suggestions.length).reduce((a, v) => a + v.counted, 0n),
    ...Object.fromEntries(CATEGORIES.map(([k]) => [`cat_${k}`, views.filter((v) => (v.l.category ?? 'raw') === k).reduce((a, v) => a + v.closing, 0n)])),
    revenue: after.revenue,
    ...(before.pct !== null ? { margin_before_bp: BigInt(Math.round(before.pct * 100)) } : {}),
    ...(after.pct !== null ? { margin_after_bp: BigInt(Math.round(after.pct * 100)) } : {}),
    ...(prior?.pct != null ? { margin_prior_bp: BigInt(Math.round(prior.pct * 100)) } : {}),
  });
  anchors.push({ id: 'count_sheet', label: 'Stock count sheet' });
  views.forEach((v) => anchors.push({ id: v.l.id, label: v.l.desc || 'Stock line' }));

  const unclear = views.filter((v) => v.l.unclear);
  checks.push({
    id: 'count_sheet',
    label: 'Count sheet attached and confirmed',
    detail: !ctx.files('count_sheet') ? 'Attach the signed stock count sheet.' : unclear.length ? `Confirm the quantity for ${unclear.map((v) => v.l.desc).join(', ')}.` : views.length ? `${views.length} lines entered from the count sheet.` : 'Enter the lines from the count sheet.',
    passed: ctx.files('count_sheet') > 0 && views.length > 0 && !unclear.length,
  });
  const unsupported = views.filter((v) => v.invoice === null && !ctx.files(v.l.id));
  checks.push({
    id: 'costs',
    label: `Unit costs supported (${views.length - unsupported.length}/${views.length})`,
    detail: unsupported.length ? `Enter the latest invoice cost or attach a costing for ${unsupported.map((v) => v.l.desc).join(', ')}.` : 'Every unit cost is agreed to an invoice or a costing.',
    passed: !unsupported.length,
  });
  const issues = views.filter((v) => v.costHigh || v.nrvLow);
  const open = views.filter((v) => v.suggestions.length || ((v.l.decision_cost === 'keep' || v.l.decision_nrv === 'keep') && !v.l.reason?.trim()));
  checks.push({
    id: 'cost_nrv',
    label: `Cost and NRV issues dealt with (${issues.length - open.filter((v) => issues.includes(v)).length}/${issues.length})`,
    detail: open.length ? `Decide on ${open.map((v) => v.l.desc).join(', ')}. Keeping a value needs a reason.` : 'Every line is at the lower of cost and net realisable value.',
    passed: !open.length,
  });
  const sent = journalCheck(data.journal, lines);
  checks.push({
    id: 'agrees_ledger',
    label: 'Closing stock agrees to ledger',
    detail: closing === ledger ? `Closing stock ${formatPence(closing)} agrees to 7000.` : sent.passed ? `The closing stock journal (${data.journal.ref}) brings 7000 to ${formatPence(closing)} once it is accepted.` : `Closing stock ${formatPence(closing)} · ledger 7000 ${formatPence(ledger)}. Send the closing stock journal.`,
    passed: closing === ledger || (sent.passed && lines.length > 0),
  });
  if (after.pct !== null && prior?.pct != null) {
    const move = after.pct - prior.pct;
    checks.push({
      id: 'margin',
      label: 'Gross margin within 5 points of prior year',
      detail: `${after.pct.toFixed(1)}% this year after stock adjustments against ${prior.pct.toFixed(1)}% last year (${move > 0 ? '+' : ''}${move.toFixed(1)} pts).`,
      passed: Math.abs(move) <= 5,
    });
  }

  return views.length
    ? `Stock of ${formatPence(closing)} is taken from the count at the year end, valued at the lower of cost and net realisable value${writeDowns ? ` after write-downs of ${formatPence(writeDowns)}` : ''}.${after.pct !== null && prior?.pct != null ? ` Gross margin is ${after.pct.toFixed(1)}% against ${prior.pct.toFixed(1)}% last year.` : ''}`
    : '';
}

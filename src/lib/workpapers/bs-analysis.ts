import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { STATUS_DEFINITIONS } from '../types/models';
import { buildAccounts, type Accounts, type AccountsLine } from './accounts';
import { TEMPLATES, templateFor } from './templates';
import { dlaReview } from './dla';
import { reservesReview } from './reserves';
import { PL_GROUPS } from './pl-analysis';
import { ukDate } from '../dates';
import type { PaperContext } from './common';

/**
 * Balance sheet analysis (Z-40): every balance sheet line linked to the paper that supports it,
 * compared with last year, with the director's loan, reserves, the micro-entity size test and
 * going concern brought together in one place.
 */

export const MICRO = { turnover: 100_000_000n, total: 50_000_000n, employees: 10 }; // £1m, £500k, 10

const SECTIONS = [
  ['fixed', 'Fixed assets'],
  ['current', 'Current assets'],
  ['creditorsShort', 'Creditors: due within one year'],
  ['creditorsLong', 'Creditors: due after more than one year'],
  ['provisions', 'Provisions for liabilities'],
  ['equity', 'Capital and reserves'],
  ['suspense', 'Suspense and clearing'],
] as const satisfies readonly (readonly [keyof Accounts['bs'], string])[];

// Papers that review the whole file rather than a balance
const NOT_A_SCHEDULE = new Set(['Z-10', 'Z-20', 'Z-30', 'Z-40', 'R-10', 'R-20']);

export interface BsSchedule {
  ref: string;
  title: string;
  wpId: string | null;
  status: string;
  done: boolean;
}

export interface BsRow {
  key: string;
  label: string;
  section: keyof Accounts['bs'];
  amount: bigint;
  prior: bigint | null;
  change: bigint | null;
  percent: number | null;
  material: boolean;
  codes: string[];
  schedules: BsSchedule[];
}

const abs = (n: bigint) => (n < 0n ? -n : n);
const DONE = ['prepared', 'signed_off'];

/** The papers whose lead codes cover any of these chart codes, as added to this engagement. */
function schedulesFor(engagementId: string, codes: string[]): BsSchedule[] {
  const refs = TEMPLATES.filter((t) => !NOT_A_SCHEDULE.has(t.ref) && t.leads.some((l) => codes.some((c) => c.startsWith(l.code))));
  return refs.map((t) => {
    const wp = db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === t.ref);
    return { ref: t.ref, title: t.title, wpId: wp?.id ?? null, status: wp ? STATUS_DEFINITIONS[wp.status]?.label ?? wp.status : 'Not added', done: !!wp && DONE.includes(wp.status) };
  });
}

/** Sum of the final TB (debit-positive) over a paper's lead codes. */
const leadTotal = (ctx: PaperContext, ref: string, engagementId = ctx.engagementId) => (templateFor(ref)?.leads ?? []).reduce((a, l) => a + ctx.tb(l.code, engagementId).final, 0n);

/** Turnover, cost of sales and overheads from the TB, shown positive. */
function plFigures(ctx: PaperContext, engagementId: string) {
  const total = (key: string) => {
    const g = PL_GROUPS.find((x) => x.key === key)!;
    return db.blynt_accounts.filter((a) => g.codes(a.code)).reduce((s, a) => s + ctx.tb(a.code, engagementId).final, 0n);
  };
  return { turnover: -total('turnover'), cos: total('cos'), overheads: total('overheads') };
}

function ratios(ctx: PaperContext, a: Accounts, engagementId: string, prior: boolean) {
  const pick = (x: { amount: bigint; prior: bigint | null }) => (prior ? x.prior : x.amount);
  const sumOf = (ls: AccountsLine[]) => ls.reduce((s, l) => s + ((prior ? l.prior : l.amount) ?? 0n), 0n);
  const current = sumOf(a.bs.current);
  const short = sumOf(a.bs.creditorsShort);
  const p = plFigures(ctx, engagementId);
  const debtors = leadTotal(ctx, 'C-10', engagementId);
  const creditors = -leadTotal(ctx, 'K-10', engagementId);
  const cash = leadTotal(ctx, 'B-10', engagementId);
  const days = (x: bigint, per: bigint) => (per > 0n ? (Number(x) / Number(per)) * 365 : null);
  return {
    currentRatio: short > 0n ? Number(current) / Number(short) : null,
    debtorDays: days(debtors, p.turnover),
    creditorDays: days(creditors, p.cos),
    cashMonths: p.overheads > 0n ? Number(cash) / (Number(p.overheads) / 12) : null,
    netAssets: pick(a.netAssets),
    turnover: p.turnover,
  };
}

export function bsAnalysis(ctx: PaperContext) {
  const { data } = ctx;
  const pct = Number(data.threshold_pct ?? 10);
  const minimum = asPence(data.threshold_p ?? '100000');
  const a = buildAccounts(ctx.engagementId);
  const comments: Record<string, string> = data.comments ?? {};

  const sections = SECTIONS.map(([key, label]) => ({
    key,
    label,
    rows: a.bs[key].map((l): BsRow => {
      const change = l.prior === null ? null : l.amount - l.prior;
      const percent = change === null || !l.prior ? null : (Number(change) / Number(abs(l.prior))) * 100;
      const codes = l.review.map((r) => r.code);
      return {
        key: `${key}:${l.label}`,
        label: l.label,
        section: key,
        amount: l.amount,
        prior: l.prior,
        change,
        percent,
        material: change !== null && change !== 0n && abs(change) >= minimum && (percent === null || Math.abs(percent) >= pct),
        codes,
        schedules: schedulesFor(ctx.engagementId, codes),
      };
    }),
  })).filter((s) => s.rows.length);
  const rows = sections.flatMap((s) => s.rows);
  const balances = a.netAssets.amount === a.capitalAndReserves.amount;
  const papers = new Map(rows.flatMap((r) => r.schedules).filter((s) => s.wpId).map((s) => [s.ref, s]));
  const unexplained = rows.filter((r) => r.material && !comments[r.key]?.trim());

  // Director's loan, from its own paper when there is one
  const d20 = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'D-20');
  const dla = d20 ? dlaReview({ ...ctx, wpId: d20.id, data: d20.data_json }) : null;

  // Reserves, from the reserves paper's data when there is one
  const e20 = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'E-20');
  const reserves = reservesReview({ ...ctx, wpId: e20?.id ?? ctx.wpId, data: e20?.data_json ?? {} });
  const unlawful = reserves.eq.tested.filter((t) => !t.lawful);

  // Size test: micro-entity limits, this year and last
  const assetsTotal = (prior: boolean) => [...a.bs.fixed, ...a.bs.current].reduce((s, l) => s + ((prior ? l.prior : l.amount) ?? 0n), 0n);
  const now = ratios(ctx, a, ctx.engagementId, false);
  const last = a.hasPrior && ctx.priorId ? ratios(ctx, a, ctx.priorId, true) : null;
  const employees = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
  const size = [
    { key: 'turnover', label: 'Turnover up to £1m', now: now.turnover, last: last?.turnover ?? null, met: (x: bigint | null) => x !== null && x <= MICRO.turnover },
    { key: 'total', label: 'Balance sheet total up to £500k', now: assetsTotal(false), last: a.hasPrior ? assetsTotal(true) : null, met: (x: bigint | null) => x !== null && x <= MICRO.total },
  ].map((s) => ({ ...s, metNow: s.met(s.now), metLast: s.last === null ? null : s.met(s.last) }));
  const staff = { now: employees(data.employees), last: employees(data.employees_prior) };
  const staffMet = { now: staff.now === null ? null : staff.now <= MICRO.employees, last: staff.last === null ? null : staff.last <= MICRO.employees };
  // A company is micro when it meets at least two of the three limits (Companies Act s384A)
  const meets = (vals: (boolean | null)[]) => (vals.some((v) => v === null) && vals.filter((v) => v === true).length < 2 ? null : vals.filter((v) => v === true).length >= 2);
  const microNow = meets([size[0].metNow, size[1].metNow, staffMet.now]);
  const microLast = a.hasPrior ? meets([size[0].metLast, size[1].metLast, staffMet.last]) : null;

  const indicators: string[] = [];
  if (a.netAssets.amount < 0n) indicators.push('net liabilities');
  if (now.currentRatio !== null && now.currentRatio < 1) indicators.push('current liabilities exceed current assets');
  if (now.cashMonths !== null && now.cashMonths < 1) indicators.push('less than a month of overheads in cash');

  return {
    a,
    pct,
    minimum,
    sections,
    rows,
    balances,
    papers: [...papers.values()],
    unexplained,
    dla,
    dlaWpId: d20?.id ?? null,
    reserves,
    unlawful,
    size,
    staff,
    staffMet,
    microNow,
    microLast,
    ratios: { now, last },
    indicators,
    goingConcern: data.going_concern as 'none' | 'concern' | undefined,
    comments,
  };
}

export function reviewBs(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const r = bsAnalysis(ctx);
  Object.assign(totals, { net_assets: r.a.netAssets.amount, capital_and_reserves: r.a.capitalAndReserves.amount });
  r.rows.forEach((x) => anchors.push({ id: x.key, label: x.label }));

  checks.push({
    id: 'balances',
    label: 'Balance sheet balances',
    detail: r.a.unmappedPence ? `${formatPence(r.a.unmappedPence)} in the trial balance is not mapped yet.` : `Net assets ${formatPence(r.a.netAssets.amount)} · capital and reserves ${formatPence(r.a.capitalAndReserves.amount)}.`,
    passed: r.balances && r.a.unmappedPence === 0n && r.rows.length > 0,
  });
  const orphan = r.rows.filter((x) => x.amount !== 0n && x.section !== 'equity' && !x.schedules.some((s) => s.wpId));
  checks.push({
    id: 'schedules',
    label: `Every balance has a schedule (${r.rows.length - orphan.length} of ${r.rows.length})`,
    detail: orphan.length ? `Add a paper for ${orphan.map((x) => x.label).join(', ')}.` : 'Each balance links to the paper that supports it.',
    passed: !orphan.length,
  });
  checks.push({
    id: 'movements',
    label: 'Material movements explained',
    detail: r.unexplained.length ? `Explain ${r.unexplained.map((x) => x.label).join(', ')}.` : r.a.hasPrior ? `Every movement over ${r.pct}% and ${formatPence(r.minimum)} is explained.` : 'No prior year to compare.',
    passed: !r.unexplained.length,
  });
  if (r.dla && r.dla.s455.overdrawn > 0n) {
    const s = r.dla.s455;
    // Same rule as the s455 check on the director's loan paper, where the decision is made
    checks.push({
      id: 'dla',
      label: "Director's loan reviewed for s455",
      detail: s.unrepaid ? `${formatPence(s.s455)} s455 on ${formatPence(s.unrepaid)} not repaid by ${ukDate(s.nineMonths)}${s.windowOpen && !s.notRepaid ? ': decide on the director’s loan paper' : ''}.` : `${formatPence(s.overdrawn)} owed at the year end, repaid within nine months.`,
      passed: s.unrepaid === 0n || s.notRepaid || !s.windowOpen,
    });
  }
  checks.push({
    id: 'reserves',
    label: 'Reserves reconcile and dividends covered',
    detail: r.unlawful.length ? `Dividends of ${r.unlawful.map((t) => formatPence(t.amount)).join(', ')} were not covered by reserves when paid.` : `Closing reserves ${formatPence(r.reserves.closing)}.`,
    passed: !r.unlawful.length,
  });
  const gc = r.goingConcern === 'none' || (r.goingConcern === 'concern' && !!data.going_concern_reason?.trim());
  checks.push({
    id: 'size_gc',
    label: 'Size and going concern assessed',
    detail: [r.staff.now === null ? 'Enter the average number of employees.' : '', gc ? '' : 'Record the going concern assessment.'].filter(Boolean).join(' ') || `${r.microNow ? 'Micro-entity' : 'Not a micro-entity'}; going concern ${r.goingConcern === 'none' ? 'has no indicators' : 'is a concern'}.`,
    passed: r.staff.now !== null && gc,
  });

  if (!r.rows.length) return '';
  return `The balance sheet was reviewed line by line against last year and each balance traced to its supporting paper. Net assets are ${formatPence(r.a.netAssets.amount)}${r.a.netAssets.prior !== null ? ` (${formatPence(r.a.netAssets.prior)} last year)` : ''} and ${r.balances ? 'equal capital and reserves' : 'do not yet equal capital and reserves'}.${r.microNow ? ' The company meets the micro-entity limits.' : ''}${r.goingConcern === 'none' ? ' No going concern indicators were found.' : r.goingConcern === 'concern' ? ` Going concern: ${data.going_concern_reason}` : ''}`;
}

import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { JOURNAL_IN_TB } from '../types/models';
import { analyticalReview } from './analytical';
import { journalCheck, pair, type JLine, type PaperContext } from './common';

/**
 * Profit and loss analysis (Z-30): every P&L account against last year, with the adjustments
 * the other papers have made (accepted or still proposed) shown in their own column, movements
 * over the threshold explained, likely misposts between two lines found, questions for the
 * client kept in one list, key ratios and the micro-entity format.
 */

export const PL_GROUPS = [
  { key: 'turnover', label: 'Turnover', codes: (c: string) => /^1/.test(c) && c !== '1400' },
  { key: 'cos', label: 'Cost of sales', codes: (c: string) => /^2/.test(c) },
  { key: 'overheads', label: 'Overheads', codes: (c: string) => /^[34]/.test(c) && c !== '4930' },
  { key: 'other', label: 'Other income', codes: (c: string) => c === '1400' || c === '4930' || c === '5000' },
  { key: 'finance', label: 'Finance costs', codes: (c: string) => /^5[1-4]/.test(c) },
] as const;
export type GroupKey = (typeof PL_GROUPS)[number]['key'];

const LIVE = [...JOURNAL_IN_TB, 'proposed'];

export interface PlRow {
  code: string;
  name: string;
  group: GroupKey;
  income: boolean; // shown credit-positive
  tb: bigint; // before any journals
  adjustments: bigint;
  proposed: bigint; // part of the adjustments still proposed
  sources: string[];
  current: bigint;
  prior: bigint | null;
  change: bigint | null;
  percent: number | null;
  ofSales: number | null;
  material: boolean;
}

export function plAnalysis(ctx: PaperContext) {
  const { data } = ctx;
  const pct = Number(data.threshold_pct ?? 10);
  const minimum = asPence(data.threshold_p ?? '100000');
  const journals = db.adjustments.filter((a) => a.engagement_id === ctx.engagementId && LIVE.includes(a.status));
  const codes = db.blynt_accounts.filter((a) => ['Revenue', 'Cost of Sales', 'Overhead'].includes(a.type) && a.code !== '5500' && a.code !== '5600');
  const rows: PlRow[] = [];
  for (const a of codes) {
    const group = PL_GROUPS.find((g) => g.codes(a.code))?.key;
    if (!group) continue;
    const income = group === 'turnover' || group === 'other';
    const sign = income ? -1n : 1n;
    const tb = sign * ctx.tb(a.code).draft;
    let adjustments = 0n;
    let proposed = 0n;
    const sources = new Set<string>();
    for (const j of journals) {
      for (const l of j.lines.filter((x) => x.blynt_code === a.code)) {
        const move = sign * (asPence(l.debit_p) - asPence(l.credit_p));
        adjustments += move;
        if (j.status === 'proposed') proposed += move;
        sources.add(j.source_schedule ? j.source_schedule : 'manual journal');
      }
    }
    const current = tb + adjustments;
    const prior = ctx.priorId ? sign * ctx.tb(a.code, ctx.priorId).final : null;
    if (current === 0n && !prior && !ctx.tb(a.code).mapped) continue;
    const change = prior === null ? null : current - prior;
    const percent = change === null || !prior ? null : (Number(change) / Number(prior < 0n ? -prior : prior)) * 100;
    const abs = change === null ? 0n : change < 0n ? -change : change;
    rows.push({ code: a.code, name: a.name, group, income, tb, adjustments, proposed, sources: Array.from(sources), current, prior, change, percent, ofSales: null, material: change !== null && change !== 0n && abs >= minimum && (percent === null || Math.abs(percent) >= pct) });
  }
  const sum = (g: GroupKey, f: (r: PlRow) => bigint | null) => rows.filter((r) => r.group === g).reduce((a, r) => a + (f(r) ?? 0n), 0n);
  const totals = (f: (r: PlRow) => bigint | null) => {
    const t = Object.fromEntries(PL_GROUPS.map((g) => [g.key, sum(g.key, f)])) as Record<GroupKey, bigint>;
    const gross = t.turnover - t.cos;
    return { ...t, gross, pbt: gross - t.overheads + t.other - t.finance };
  };
  const now = totals((r) => r.current);
  const before = totals((r) => r.tb);
  const last = ctx.priorId ? totals((r) => r.prior) : null;
  for (const r of rows) r.ofSales = now.turnover ? (Number(r.current) / Number(now.turnover)) * 100 : null;

  // Likely misposts: a cost line that fell sharply while another rose by about the same amount
  const decisions: Record<string, { decision: 'move' | 'leave'; reason?: string }> = data.misposts ?? {};
  const misposts: { id: string; from: PlRow; to: PlRow; amount: bigint; decision?: 'move' | 'leave'; reason?: string }[] = [];
  for (const down of rows) {
    if (down.income || down.change === null || down.prior === null || down.change >= 0n || -down.change < minimum || -down.change * 10n < down.prior * 8n) continue;
    const drop = -down.change;
    const up = rows
      .filter((r) => r !== down && !r.income && r.change !== null && r.change > 0n)
      .map((r) => ({ r, gap: r.change! > drop ? r.change! - drop : drop - r.change! }))
      .filter((x) => x.gap * 10n <= drop)
      .sort((a, b) => (a.gap < b.gap ? -1 : 1))[0];
    if (!up) continue;
    const id = `${up.r.code}>${down.code}`;
    misposts.push({ id, from: up.r, to: down, amount: up.r.change! < drop ? up.r.change! : drop, ...decisions[id] });
  }
  const lines: JLine[] = misposts.filter((m) => m.decision === 'move').flatMap((m) => pair(m.to.code, m.from.code, m.amount, `${m.to.name} posted to ${m.from.name}`));
  const ratio = (t: ReturnType<typeof totals> | null) =>
    t && t.turnover ? { gm: (Number(t.gross) / Number(t.turnover)) * 100, overheads: (Number(t.overheads) / Number(t.turnover)) * 100, pbt: (Number(t.pbt) / Number(t.turnover)) * 100 } : null;
  const review = analyticalReview(ctx.engagementId, 'pl', data);
  return { pct, minimum, rows, now, before, last, misposts, lines, ratios: { now: ratio(now), last: ratio(last) }, unmapped: review.unmappedPence, questions: (data.questions ?? []) as { id: string; code: string; text: string }[] };
}

export function reviewPl(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const a = plAnalysis(ctx);
  const comments: Record<string, string> = data.comments ?? {};
  const misposted = new Set(a.misposts.flatMap((m) => [m.from.code, m.to.code]));
  Object.assign(totals, { pbt: a.now.pbt, pbt_before: a.before.pbt, adjustments: a.now.pbt - a.before.pbt, ...(a.last ? { pbt_prior: a.last.pbt } : {}) });
  a.rows.forEach((r) => anchors.push({ id: r.code, label: `${r.code} ${r.name}` }));

  checks.push({
    id: 'tb',
    label: 'Agrees to TB',
    detail: a.unmapped === 0n ? `Profit before tax per TB ${formatPence(a.before.pbt)}.` : `${formatPence(a.unmapped)} in the trial balance is not mapped yet, so these figures may change.`,
    passed: a.unmapped === 0n && a.rows.length > 0,
  });
  const pending = db.adjustments.filter((j) => j.engagement_id === ctx.engagementId && j.status === 'proposed' && j.source_schedule && j.source_schedule !== 'Z-30');
  checks.push({
    id: 'schedules',
    label: 'Adjustments from other schedules included',
    detail: pending.length ? `${pending.length} proposed journal(s) from other papers are shown but not yet accepted: ${pending.map((j) => `${j.ref} (${j.source_schedule})`).join(', ')}.` : 'Every adjustment from the other papers is in the figures.',
    passed: !pending.length,
  });
  const unexplained = a.rows.filter((r) => r.material && !comments[r.code]?.trim() && !misposted.has(r.code) && !(r.adjustments !== 0n && r.sources.length && r.tb === 0n));
  checks.push({
    id: 'movements',
    label: 'Material movements explained',
    detail: unexplained.length ? `Explain ${unexplained.map((r) => r.name).join(', ')}.` : a.last ? 'Every movement over the threshold is explained.' : 'No prior year to compare.',
    passed: !unexplained.length,
  });
  const openMis = a.misposts.filter((m) => !m.decision || (m.decision === 'leave' && !m.reason?.trim()));
  checks.push({
    id: 'misposts',
    label: 'Possible mispostings dealt with',
    detail: openMis.length ? openMis.map((m) => `${m.to.name} looks posted to ${m.from.name}`).join('; ') + '.' : a.misposts.length ? 'Each possible misposting is moved or explained.' : 'None found.',
    passed: !openMis.length,
  });
  checks.push(journalCheck(data.journal, a.lines, 'Journals sent to the ledger'));
  return a.rows.length
    ? `Profit before tax of ${formatPence(a.now.pbt)}${a.last ? ` against ${formatPence(a.last.pbt)} last year` : ''} was reviewed line by line, with the adjustments from the other papers included.${a.ratios.now ? ` Gross margin is ${a.ratios.now.gm.toFixed(1)}%${a.ratios.last ? ` (${a.ratios.last.gm.toFixed(1)}% last year)` : ''}.` : ''} Movements over ${a.pct}% and ${formatPence(a.minimum)} are explained.`
    : '';
}

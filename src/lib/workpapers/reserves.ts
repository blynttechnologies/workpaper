import { asPence, formatPence } from '../money';
import { equityReview } from './equity';
import { journalCheck, ledgerFor, pair, type JLine, type PaperContext } from './common';
import { db } from '../server/db';

/**
 * Reserves movement (E-20): opening reserves from last year's accounts, profit after tax and
 * dividends from the Share capital and dividends paper, and the closing reserve. The trial
 * balance's opening retained earnings are checked against last year's accounts: a difference
 * means something was posted into last year after the accounts were finalised.
 */

export function reservesReview(ctx: PaperContext) {
  const { data } = ctx;
  const e10 = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'E-10');
  const eq = equityReview({ ...ctx, data: e10?.data_json ?? {} });
  const signed = ctx.priorId ? eq.bf : null;
  // Retained earnings in the TB at the start of the year: the year's own postings to 8900 taken out
  const postedThisYear = ledgerFor(ctx.engagementId, ['8900'])
    .filter((t) => t.date >= ctx.periodStart && t.date <= ctx.periodEnd)
    .reduce((a, t) => a + asPence(t.amount_p), 0n);
  const tbOpening = -(ctx.tb('8900').draft - postedThisYear);
  const difference = signed === null ? 0n : tbOpening - signed;
  const pbt = eq.pbt > 0n ? eq.pbt : -eq.pbt;
  const small = difference === 0n || (pbt > 0n && (difference < 0n ? -difference : difference) * 20n <= pbt);
  const decision: 'this_year' | 'prior_year' | undefined = data.decision;
  const code: string = data.code ?? '4990';
  const lines: JLine[] = decision === 'this_year' && difference ? pair('8900', code, difference, 'Posted into last year after its accounts were finalised; taken into this year') : [];
  const pya = decision === 'prior_year' ? difference : 0n;
  const opening = signed ?? tbOpening;
  const closing = opening + pya + eq.pat - eq.total;
  return { eq, signed, tbOpening, difference, small, decision, code, lines, pya, opening, closing, distributable: closing };
}

export function reviewReserves(ctx: PaperContext): string {
  const { data, totals, checks } = ctx;
  const r = reservesReview(ctx);
  Object.assign(totals, { opening: r.opening, profit: r.eq.pat, dividends: r.eq.total, closing: r.closing, difference: r.difference });
  checks.push({
    id: 'opening',
    label: "Opening reserves agree to last year's accounts",
    detail:
      r.signed === null
        ? 'No prior year on file: the opening reserves come from the trial balance.'
        : r.difference === 0n
          ? `${formatPence(r.signed)} in both.`
          : r.decision
            ? `The trial balance is ${formatPence(r.difference < 0n ? -r.difference : r.difference)} ${r.difference > 0n ? 'higher' : 'lower'}; ${r.decision === 'this_year' ? 'taken into this year' : 'treated as a prior-year adjustment'}.`
            : `The trial balance's opening retained earnings are ${formatPence(r.difference < 0n ? -r.difference : r.difference)} ${r.difference > 0n ? 'higher' : 'lower'} than last year's accounts. Find what was posted into last year after it was finalised, then decide.`,
    passed: r.signed === null || r.difference === 0n || (!!r.decision && (r.decision !== 'prior_year' || !!data.reason?.trim())),
  });
  const holdsDividends = (db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'E-10')?.data_json?.dividends ?? []).length > 0 || r.eq.total === 0n;
  checks.push({ id: 'sources', label: 'Profit and dividends taken from their papers', detail: `Profit after tax ${formatPence(r.eq.pat)} · dividends ${formatPence(r.eq.total)} from Share capital and dividends.`, passed: holdsDividends });
  const unposted = r.eq.taxPosted === 0n ? r.eq.tax : 0n;
  const tbClose = r.eq.cfTb - unposted;
  // Taking the difference into this year moves it from opening reserves into profit, so until that journal is in the TB it shows here
  const ok = r.closing === tbClose || (r.decision === 'this_year' && r.closing + r.difference === tbClose);
  checks.push({
    id: 'closing',
    label: 'Closing reserves agree to the trial balance',
    detail: `Schedule ${formatPence(r.closing)} · TB ${formatPence(tbClose)}${unposted ? ` (after the ${formatPence(unposted)} tax estimate not yet posted)` : ''}${r.pya ? ` · prior-year adjustment ${formatPence(r.pya)}` : ''}${r.decision === 'this_year' && r.difference && r.closing !== tbClose ? ' · the difference taken into this year is in the journal' : ''}.`,
    passed: ok,
  });
  checks.push(journalCheck(data.journal, r.lines));
  return `Reserves of ${formatPence(r.opening)} at the start of the year${r.signed !== null ? ', as in last year’s accounts,' : ''} plus profit after tax of ${formatPence(r.eq.pat)} less dividends of ${formatPence(r.eq.total)} give ${formatPence(r.closing)} at the year end, all of which is distributable.${r.difference && r.decision ? ` A ${formatPence(r.difference < 0n ? -r.difference : r.difference)} difference to last year’s accounts was ${r.decision === 'this_year' ? 'taken into this year' : 'treated as a prior-year adjustment'}.` : ''}`;
}

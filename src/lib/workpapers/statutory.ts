import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import type { PaperContext } from './common';
import { dlaSummary } from './dla';
import { ukDate } from '../dates';

/**
 * Statutory information (R-20): the officers and shareholders, people with significant control,
 * the director who signs the accounts and the company details. Shareholdings are agreed to the
 * share capital paper; each director's loan balance and dividends are shown from their papers.
 */

export interface Officer {
  id: string;
  title?: string;
  first_name?: string;
  surname?: string;
  is_director?: boolean;
  is_secretary?: boolean;
  is_shareholder?: boolean;
  share_type?: string;
  shares?: string;
  appointed?: string;
  resigned?: string;
  psc?: boolean;
  signs?: boolean;
}

export const fullName = (o: Officer) => [o.first_name, o.surname].filter(Boolean).join(' ');

/** Accounts are due at Companies House nine months after the year end (private company). */
export function accountsDue(periodEnd: string) {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 9, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  // The same day nine months on, or the last day of that month when the year end is a month end
  const monthEnd = d.getUTCDate() === new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(monthEnd ? lastDay : Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function statutoryReview(ctx: PaperContext) {
  const officers: Officer[] = ctx.data.officers ?? [];
  const served = (o: Officer) => !!o.is_director && (!o.appointed || o.appointed <= ctx.periodEnd) && (!o.resigned || o.resigned >= ctx.periodStart);
  const inOffice = (o: Officer) => !!o.is_director && (!o.resigned || o.resigned > ctx.periodEnd);
  const holders = officers.filter((o) => o.is_shareholder);
  const shares = holders.reduce((a, o) => a + BigInt(/^\d+$/.test(o.shares ?? '') ? o.shares! : 0), 0n);
  const e10 = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'E-10')?.data_json;
  const capitalShares = e10?.classes ? (e10.classes as any[]).reduce((a, c) => a + BigInt(Math.round(Number(c.shares) || 0)), 0n) : null;
  const dividends = ((e10?.dividends ?? []) as any[]).reduce((a, d) => a + asPence(d.amount_p), 0n);
  const dla = dlaSummary(ctx);
  const people = officers.map((o) => {
    const held = BigInt(/^\d+$/.test(o.shares ?? '') ? o.shares! : 0);
    const pct = shares ? Number((held * 10000n) / shares) / 100 : 0;
    const loan = o.is_director && o.surname ? dla.balanceOf(o.surname) : null;
    return { o, held, pct, served: served(o), inOffice: inOffice(o), significant: o.is_shareholder && pct > 25, loan, dividend: shares && dividends ? (dividends * held) / shares : 0n };
  });
  return { officers, people, holders, shares, capitalShares, dividends, served: people.filter((p) => p.served), signer: people.filter((p) => p.o.signs), due: accountsDue(ctx.periodEnd) };
}

export function reviewStatutory(ctx: PaperContext): string {
  const { totals, checks, anchors } = ctx;
  const r = statutoryReview(ctx);
  Object.assign(totals, { shares: r.shares, served: BigInt(r.served.length) });
  r.people.forEach((p) => anchors.push({ id: p.o.id, label: fullName(p.o) || 'Person' }));

  const noDates = r.people.filter((p) => p.o.is_director && !p.o.appointed);
  const badDates = r.people.filter((p) => p.o.appointed && p.o.resigned && p.o.resigned < p.o.appointed);
  checks.push({
    id: 'served',
    label: 'Everyone who served in the year is listed',
    detail: !r.served.length ? 'Add every director who served at any time in the year, including any who resigned.' : noDates.length || badDates.length ? `Check the dates for ${[...noDates, ...badDates].map((p) => fullName(p.o) || 'a director').join(', ')}.` : `${r.served.length} director(s) served in the year, each with dates.`,
    passed: r.served.length > 0 && !noDates.length && !badDates.length,
  });
  const unnamed = r.people.filter((p) => !p.o.surname?.trim());
  if (unnamed.length) checks.push({ id: 'names', label: 'Everyone has a surname', detail: `${unnamed.length} row(s) have no surname.`, passed: false });
  checks.push({
    id: 'holdings',
    label: 'Shareholdings agree to share capital',
    detail: !r.holders.length ? 'Add the shareholders.' : r.capitalShares === null ? `Shareholders hold ${r.shares.toLocaleString('en-GB')} shares; enter the share classes on the Share capital paper.` : `Shareholders hold ${r.shares.toLocaleString('en-GB')} shares; the share capital paper has ${r.capitalShares.toLocaleString('en-GB')}.`,
    passed: r.holders.length > 0 && r.capitalShares !== null && r.shares === r.capitalShares,
  });
  const pscWrong = r.people.filter((p) => p.significant !== !!p.o.psc && p.significant);
  checks.push({
    id: 'psc',
    label: 'PSCs agree to shareholdings',
    detail: pscWrong.length ? `Holding more than 25% but not marked as a person with significant control: ${pscWrong.map((p) => fullName(p.o)).join(', ')}.` : 'Everyone holding more than 25% is marked as a PSC.',
    passed: !pscWrong.length,
  });
  const signers = r.signer.filter((p) => p.inOffice);
  checks.push({
    id: 'signer',
    label: 'Signing director chosen',
    detail: !r.signer.length ? 'Choose the director who will sign the balance sheet.' : !signers.length ? 'The chosen signer is not a director in office at the year end.' : `${fullName(signers[0].o)} signs the accounts.`,
    passed: signers.length === 1 && r.signer.length === 1,
  });
  const inOffice = r.people.filter((p) => p.inOffice);
  return inOffice.length && r.holders.length
    ? `${inOffice.length} director(s) in office at the year end and ${r.holders.length} shareholder(s) holding ${r.shares.toLocaleString('en-GB')} shares are recorded.${r.signer[0] ? ` ${fullName(r.signer[0].o)} signs the accounts.` : ''} The accounts are due at Companies House by ${ukDate(r.due)}.${r.dividends ? ` Dividends of ${formatPence(r.dividends)} were paid in proportion to the holdings.` : ''}`
    : '';
}

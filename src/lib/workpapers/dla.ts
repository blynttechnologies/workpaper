import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { CENTRAL_TAX_RATES } from '../tax-rates';
import { addDays, daysBetween, inLead, journalCheck, ledgerFor, pair, type JLine, type PaperContext } from './common';
import { ukDate } from '../dates';

/**
 * Director's loan account (D-20) from the ledger: every transaction on 7400 and 7980 grouped by
 * what it is, the balance at each month end, s455 on an overdrawn balance not repaid within nine
 * months, the beneficial loan test for the tax year, and the advances note. Balances are
 * debit-positive: positive means the director owes the company.
 */

export const GROUPS = [
  ['dividends', 'Dividends credited'],
  ['salary', 'Salary and expenses credited'],
  ['repaid', 'Repayments by the director'],
  ['transfers', 'Transfers to the director'],
  ['personal', 'Personal costs paid by the company'],
] as const;
export type Group = (typeof GROUPS)[number][0];

const RETAIL = /\btv\b|television|amazon|apple|currys|argos|john lewis|ikea|holiday|hotel|restaurant|supermarket|tesco|sainsbury|asda|waitrose|netflix|gym/i;

export function groupOf(desc: string, amount: bigint): Group {
  if (/dividend/i.test(desc)) return 'dividends';
  if (/salary|wage|payroll|net pay|expense claim|mileage/i.test(desc)) return 'salary';
  if (amount < 0n) return 'repaid';
  if (/transfer|withdraw|drawing|to director|cash/i.test(desc)) return 'transfers';
  return 'personal';
}

export interface DlaDirector {
  id: string;
  name: string;
  /** The client's ledger account that is this director's loan account, when each director has their own */
  account?: string;
  /** Brought forward typed in, for a director sharing a loan account with others */
  bf_p?: string;
}

/** The client's accounts mapped to directors' loans. */
export const dlaAccounts = (engagementId: string) => db.account_mappings.filter((m) => m.engagement_id === engagementId && (inLead(m.blynt_code, '7400') || inLead(m.blynt_code, '7980')));

const nameWords = (name: string) => name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);

/** Which director each loan account belongs to: picked on the paper, else the director named in the account's name. */
export function accountOwners(engagementId: string, directors: DlaDirector[]) {
  const owners: Record<string, string> = {};
  const accounts = dlaAccounts(engagementId);
  for (const m of accounts) {
    const picked = directors.find((d) => d.account === m.source_code);
    const named = accounts.length > 1 ? directors.find((d) => nameWords(d.name ?? '').some((w) => m.source_name.toLowerCase().includes(w))) : undefined;
    const d = picked ?? (named && !named.account ? named : undefined);
    if (d) owners[m.source_code] = d.id;
  }
  return owners;
}

/** The tax year (6 April to 5 April) the period end falls in. */
export function taxYearOf(periodEnd: string) {
  const y = Number(periodEnd.slice(0, 4));
  const start = periodEnd >= `${y}-04-06` ? y : y - 1;
  return { start: `${start}-04-06`, end: `${start + 1}-04-05`, label: `${start}/${String(start + 1).slice(2)}` };
}

/**
 * The loan for one director, or for all of them together when no director is given. Each director
 * is their own loan: s455 and the £10,000 beneficial loan limit apply per director. A transaction
 * belongs to the director whose account it is on, else the director named in its contact, else the first.
 */
export function dlaReview(ctx: PaperContext, directorId?: string) {
  const { data } = ctx;
  const directors: DlaDirector[] = (data.directors ?? []).map((d: any) => ({ id: d.id, name: d.name ?? '', account: d.account || undefined, bf_p: d.bf_p }));
  const decisions: Record<string, 'personal' | 'business'> = data.tx_decisions ?? {};
  const owners = accountOwners(ctx.engagementId, directors);
  const byContact = (contact: string) => directors.find((d) => contact && nameWords(d.name).some((w) => contact.toLowerCase().includes(w)));
  const ownerOf = (t: { account_code: string; contact: string }) => owners[t.account_code] ?? byContact(t.contact)?.id ?? directors[0]?.id;
  const everything = ledgerFor(ctx.engagementId, ['7400', '7980']).sort((a, b) => a.date.localeCompare(b.date));
  const inPeriod = (t: { date: string }) => t.date >= ctx.periodStart && t.date <= ctx.periodEnd;
  const sum = (ts: { amount_p: string }[]) => ts.reduce((a, t) => a + asPence(t.amount_p), 0n);
  const tbClose = ctx.tb('7400').draft + ctx.tb('7980').draft;
  const hasLedger = everything.some(inPeriod);
  const pooledOpening = hasLedger ? tbClose - sum(everything.filter(inPeriod)) : asPence(data.opening_p ?? '0');

  // A director with their own account: its TB balance less the year's postings. Sharing one: the figure typed in,
  // and whoever shares without one takes what is left of the shared opening balance
  const openingOf = (d: DlaDirector): bigint => {
    const own = Object.keys(owners).filter((c) => owners[c] === d.id);
    if (own.length) return dlaAccounts(ctx.engagementId).filter((m) => own.includes(m.source_code)).reduce((a, m) => a + asPence(m.balance_p), 0n) - sum(everything.filter((t) => own.includes(t.account_code) && inPeriod(t)));
    if (d.bf_p != null && d.bf_p !== '') return asPence(d.bf_p);
    const rest = directors.find((x) => !Object.values(owners).includes(x.id) && (x.bf_p == null || x.bf_p === ''));
    return rest?.id === d.id ? pooledOpening - directors.filter((x) => x.id !== d.id).reduce((a, x) => a + openingOf(x), 0n) : 0n;
  };
  const director = directorId ? directors.find((d) => d.id === directorId) : undefined;
  const all = director ? everything.filter((t) => ownerOf(t) === director.id) : everything;
  const inYear = all.filter(inPeriod);
  const after = all.filter((t) => t.date > ctx.periodEnd);
  const opening = director ? (hasLedger ? openingOf(director) : asPence((data.directors ?? []).find((d: any) => d.id === director.id)?.opening_p ?? '0')) : pooledOpening;
  const who = (t: { account_code: string; contact: string }) => directors.find((d) => d.id === ownerOf(t));

  const tx = inYear.map((t) => {
    const amount = asPence(t.amount_p);
    const group = groupOf(`${t.description} ${t.contact}`, amount);
    const unsure = group === 'personal' && RETAIL.test(`${t.description} ${t.contact}`);
    return { t, amount, group, unsure, decision: decisions[t.id], director: who(t)?.id };
  });
  const groups = GROUPS.map(([key, label]) => {
    const items = tx.filter((x) => x.group === key);
    return { key, label, items, total: items.reduce((a, x) => a + x.amount, 0n) };
  });
  const business = tx.filter((x) => x.decision === 'business');
  const lines: JLine[] = business.flatMap((x) => pair('4990', chartFor(ctx, x.t.account_code), x.amount, `${x.t.description}: a business cost, not the director's`));
  const reclass = business.reduce((a, x) => a + x.amount, 0n);
  const closingEntered = director ? (data.directors ?? []).find((d: any) => d.id === director.id)?.closing_p : data.closing_p;
  const closing = (hasLedger ? opening + sum(inYear) : asPence(closingEntered ?? '0')) - reclass;

  // Balance at each month end
  const months: { key: string; label: string; balance: bigint }[] = [];
  let run = opening;
  for (let d = ctx.periodStart.slice(0, 7); d <= ctx.periodEnd.slice(0, 7) && months.length < 24; ) {
    run += tx.filter((x) => x.t.date.slice(0, 7) === d).reduce((a, x) => a + x.amount - (x.decision === 'business' ? x.amount : 0n), 0n);
    months.push({ key: d, label: new Date(`${d}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }), balance: run });
    const [y, m] = d.split('-').map(Number);
    d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  // s455: an overdrawn balance not repaid within nine months of the year end
  const nineMonths = (() => {
    const e = new Date(`${ctx.periodEnd}T00:00:00Z`);
    return new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 10, 0)).toISOString().slice(0, 10);
  })();
  const repaymentsAfter = after.filter((t) => t.date <= nineMonths && asPence(t.amount_p) < 0n && !/dividend/i.test(t.description));
  const repaidAfter = repaymentsAfter.reduce((a, t) => a - asPence(t.amount_p), 0n);
  // 30-day rule: £5,000 or more repaid and £5,000 or more drawn again within 30 days doesn't count
  const bed = repaymentsAfter.filter((t) => -asPence(t.amount_p) >= 500000n && after.some((u) => u.date > t.date && u.date <= addDays(t.date, 30) && asPence(u.amount_p) >= 500000n));
  const countable = repaidAfter - bed.reduce((a, t) => a - asPence(t.amount_p), 0n);
  const overdrawn = closing > 0n ? closing : 0n;
  const notRepaid = data.s455_not_repaid === true;
  const unrepaid = notRepaid ? overdrawn : overdrawn > countable ? overdrawn - countable : 0n;
  const s455 = (unrepaid * BigInt(Math.round(CENTRAL_TAX_RATES.s455.rate_pct * 100))) / 10000n;
  const windowOpen = daysBetween(ctx.periodEnd, nineMonths) > 0 && !after.some((t) => t.date >= nineMonths);

  // Beneficial loan for the tax year: daily balances from the ledger
  const ty = taxYearOf(ctx.periodEnd);
  const startBal = opening + all.filter((t) => t.date >= ctx.periodStart && t.date < ty.start).reduce((a, t) => a + asPence(t.amount_p), 0n);
  let bal = startBal;
  let peak = bal > 0n ? bal : 0n;
  let dayPence = 0n;
  const days = daysBetween(ty.start, ty.end) + 1;
  for (let i = 0; i < days; i++) {
    const day = addDays(ty.start, i);
    bal += all.filter((t) => t.date === day).reduce((a, t) => a + asPence(t.amount_p), 0n);
    if (bal > peak) peak = bal;
    if (bal > 0n) dayPence += bal;
  }
  const endBal = bal;
  const rate = CENTRAL_TAX_RATES.beneficial_loans.official_rate_pct;
  const over = peak > CENTRAL_TAX_RATES.beneficial_loans.threshold_p;
  const rateBp = BigInt(Math.round(rate * 100));
  const average = (((startBal > 0n ? startBal : 0n) + (endBal > 0n ? endBal : 0n)) / 2n * rateBp) / 10000n;
  const precise = (dayPence * rateBp) / (10000n * 365n);
  const benefit = over ? average : 0n;
  const class1a = (benefit * BigInt(CENTRAL_TAX_RATES.beneficial_loans.class_1a_pct)) / 100n;
  const ledgerKnownToEnd = all.some((t) => t.date >= ty.end) || ty.end <= ctx.periodEnd;

  const e10 = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'E-10')?.data_json;
  const dividendsE10 = ((e10?.dividends ?? []) as any[]).reduce((a, d) => a + asPence(d.amount_p), 0n);

  return {
    directors,
    director,
    owners,
    hasLedger,
    opening,
    closing,
    tbClose,
    tx,
    groups,
    months,
    lines,
    s455: { overdrawn, repaidAfter, countable, bed, unrepaid, s455, nineMonths, windowOpen, notRepaid, repaymentsAfter },
    loan: { ty, startBal, endBal, peak, over, rate, average, precise, benefit, class1a, ledgerKnownToEnd },
    dividendsE10,
  };
}

function chartFor(ctx: PaperContext, sourceCode: string) {
  return db.account_mappings.find((m) => m.engagement_id === ctx.engagementId && m.source_code === sourceCode)?.blynt_code ?? '7400';
}

/** The note on advances to directors, required even in micro-entity accounts. */
export function advancesNote(r: ReturnType<typeof dlaReview>, periodEnd: string, name: string) {
  const advanced = r.tx.filter((x) => x.amount > 0n && x.decision !== 'business').reduce((a, x) => a + x.amount, 0n);
  const repaid = -r.tx.filter((x) => x.amount < 0n).reduce((a, x) => a + x.amount, 0n);
  if (r.closing <= 0n && advanced === 0n) return '';
  return `During the year advances of ${formatPence(advanced)} were made to ${name || 'the director'} and ${formatPence(repaid)} was repaid or credited. At ${ukDate(periodEnd)} ${r.closing > 0n ? `${formatPence(r.closing)} was owed to the company` : `the company owed ${formatPence(-r.closing)}`} (brought forward ${r.opening > 0n ? `${formatPence(r.opening)} owed to the company` : `${formatPence(-r.opening)} owed by the company`}). ${r.loan.benefit ? 'No interest was charged; the benefit is reported on the director’s P11D.' : 'No interest was charged.'}`;
}

export function reviewDla(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const r = dlaReview(ctx);
  // s455 and the beneficial loan limit are per director
  const per = r.directors.length > 1 ? r.directors.map((d) => ({ name: d.name || 'Unnamed director', x: dlaReview(ctx, d.id) })) : [{ name: '', x: r }];
  const total = (f: (x: typeof r) => bigint) => per.reduce((a, p) => a + f(p.x), 0n);
  const each = (f: (x: typeof r) => string) => per.map((p) => (p.name ? `${p.name}: ${f(p.x)}` : f(p.x))).join(' ');
  Object.assign(totals, { opening: r.opening, closing: r.closing, s455: total((x) => x.s455.s455), benefit: total((x) => x.loan.benefit), class1a: total((x) => x.loan.class1a) });
  r.tx.forEach((x) => anchors.push({ id: x.t.id, label: `${ukDate(x.t.date)} ${x.t.description}` }));

  const mapped = ctx.tb('7400').mapped || ctx.tb('7980').mapped;
  checks.push({
    id: 'tb',
    label: "Director's loan agrees to TB",
    detail: !mapped ? "Map the director's loan account to 7400 or 7980." : r.hasLedger ? `Opening ${formatPence(r.opening)} and the year's ${r.tx.length} transactions give ${formatPence(r.tbClose)}, as in the TB.` : 'No ledger transactions; enter the opening and closing balances.',
    passed: mapped,
  });
  const unsure = r.tx.filter((x) => x.unsure && !x.decision);
  checks.push({
    id: 'sorted',
    label: 'Movements sorted',
    detail: unsure.length ? `Personal or business? ${unsure.map((x) => `${x.t.description} (${formatPence(x.amount)})`).join(', ')}.` : 'Every movement is in a group.',
    passed: !unsure.length,
  });
  checks.push({
    id: 's455',
    label: 's455 considered',
    detail: each((x) =>
      x.s455.overdrawn === 0n
        ? 'Not overdrawn at the year end, so no s455.'
        : x.s455.unrepaid === 0n
          ? `${formatPence(x.s455.overdrawn)} overdrawn, repaid within nine months (${formatPence(x.s455.countable)} by ${ukDate(x.s455.nineMonths)}), so no s455 is due; claim relief on the CT600A.`
          : `s455 of ${formatPence(x.s455.s455)} (${CENTRAL_TAX_RATES.s455.rate_pct}% of ${formatPence(x.s455.unrepaid)}) goes to the tax computation${x.s455.windowOpen && !x.s455.notRepaid ? ` unless repaid by ${ukDate(x.s455.nineMonths)}` : ''}.`,
    ),
    passed: per.every(({ x }) => x.s455.overdrawn === 0n || x.s455.unrepaid === 0n || !!data.s455_not_repaid || !x.s455.windowOpen),
  });
  checks.push({
    id: 'benefit',
    label: `Beneficial loan tested (${r.loan.ty.label})`,
    detail: each((x) =>
      !x.loan.ledgerKnownToEnd
        ? `The tax year runs to ${ukDate(x.loan.ty.end)}; the ledger doesn't reach it yet, so the highest balance so far is ${formatPence(x.loan.peak)}.`
        : x.loan.over
          ? `The balance went over £10,000 (highest ${formatPence(x.loan.peak)}): benefit ${formatPence(x.loan.benefit)} at ${x.loan.rate}% and Class 1A of ${formatPence(x.loan.class1a)} go to payroll.`
          : `The balance stayed at or under £10,000 (highest ${formatPence(x.loan.peak)}), so there is no benefit.`,
    ),
    passed: r.loan.ledgerKnownToEnd,
  });
  const dividendsHere = -r.groups.find((g) => g.key === 'dividends')!.total;
  if (dividendsHere || r.dividendsE10) {
    checks.push({
      id: 'dividends',
      label: 'Dividends agree to share capital and dividends',
      detail: `Credited here ${formatPence(dividendsHere)} · Share capital paper ${formatPence(r.dividendsE10)}.`,
      passed: dividendsHere === r.dividendsE10,
    });
  }
  checks.push(journalCheck(data.journal, r.lines));
  return mapped ? per.map((p) => advancesNote(p.x, ctx.periodEnd, p.name || r.directors[0]?.name || '')).filter(Boolean).join(' ') || `The director's loan account was in credit throughout, with ${formatPence(-r.closing)} owed to the director at the year end.` : '';
}

/** What the other papers need from the director's loan paper of the same engagement. */
export function dlaSummary(ctx: PaperContext) {
  const wp = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'D-20');
  const directors: any[] = wp?.data_json?.directors ?? [];
  if (!wp) return { dividends: 0n, balanceOf: () => null as bigint | null };
  const r = dlaReview({ ...ctx, wpId: wp.id, data: wp.data_json });
  if (!r.hasLedger) {
    return {
      dividends: directors.reduce((a, d) => a + asPence(d.dividends_credited_p), 0n),
      balanceOf: (surname: string) => {
        const d = directors.find((x) => surname && x.name?.toLowerCase().includes(surname.toLowerCase()));
        return d ? asPence(d.closing_p) : null;
      },
    };
  }
  return {
    dividends: -r.groups.find((g) => g.key === 'dividends')!.total,
    balanceOf: (surname: string) => {
      if (directors.length <= 1) return r.closing;
      const d = directors.find((x) => surname && x.name?.toLowerCase().includes(surname.toLowerCase()));
      return d ? dlaReview({ ...ctx, wpId: wp.id, data: wp.data_json }, d.id).closing : null;
    },
  };
}

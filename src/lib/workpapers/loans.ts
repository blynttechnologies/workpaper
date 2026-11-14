import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { ukDate } from '../dates';
import { addDays, chartCodeOf, daysBetween, journalCheck, pair, type JLine, type PaperContext } from './common';

/**
 * Loans and borrowings (L-20, and hire purchase on L-30) worked month by month: what the
 * agreement says against what was paid, the interest each month on the balance owed, and the
 * balance after. The workings are agreed to the lender's statement and the ledger; what does not
 * agree becomes a finding (interest not posted, interest to accrue, a fee to spread) that builds
 * the journal. The capital is split by when it is due by running the repayments forward.
 */

export interface MonthEdit {
  paid_p?: string;
  interest_p?: string;
  note?: string;
  vouched_by?: string;
  vouched_at?: string;
  /** The paid and interest figures that were vouched; a row changed afterwards loses its tick */
  vouched_sig?: string;
}

export interface Facility {
  id: string;
  name: string;
  lender?: string;
  security?: string;
  rate: string; // % a year
  payment_p: string; // monthly payment per the agreement
  start: string; // date drawn
  amount_p: string; // amount drawn
  opening_p?: string; // owed at the start of the year, when drawn before it
  ends?: string; // date of the last payment
  account?: string; // the client's ledger account for this loan
  lender_p?: string; // the lender's statement at the year end
  fee_p?: string; // arrangement fee charged to expenses
  fee_code?: string;
  ltv_max?: string; // covenant: loan no more than this % of the security's value
  security_value_p?: string;
  icr_min?: string; // covenant: rent at least this many times the interest
  rent_p?: string; // rent a year from the security
  months?: Record<string, MonthEdit>;
}

export type FindingKind = 'interest' | 'accrue' | 'fee';
export interface Finding {
  key: string;
  f: Facility;
  kind: FindingKind;
  amount: bigint;
  title: string;
  why: string;
  decision?: 'accept' | 'reject';
  reason?: string;
  /** Arrangement fee: this year's share */
  share?: bigint;
}

const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const monthsFrom = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 600; m = nextMonth(m)) out.push(m);
  return out;
};
const bp = (pct: string | undefined) => BigInt(Math.round(Number(pct || 0) * 100));
/** A month's interest on a balance, at a yearly rate: balance × rate ÷ 12, to the penny. */
export const monthInterest = (owed: bigint, rate: string) => (owed > 0n ? (owed * bp(rate) + 60000n) / 120000n : 0n);
export const rowSig = (paid: bigint, interest: bigint) => `${paid}:${interest}`;

/** Papers saved before facilities existed (or filled from a facility letter) become one facility. */
export function facilitiesOf(data: Record<string, any>, periodStart: string): Facility[] {
  if (Array.isArray(data.facilities)) return data.facilities;
  if (!data.principal_p || asPence(data.principal_p) === 0n) return [];
  return [{ id: 'legacy', name: data.lender || 'Loan', lender: data.lender, security: data.secured ? 'Secured' : '', rate: String(data.interest_rate_pct ?? ''), payment_p: '0', start: addDays(periodStart, -1), amount_p: '0', opening_p: data.principal_p }];
}

/** The month-by-month working for one facility over the year. */
export function facilityWorkings(f: Facility, periodStart: string, periodEnd: string, engagementId: string) {
  const ledger = f.account ? db.transactions.filter((t) => t.engagement_id === engagementId && t.account_code === f.account) : [];
  const drawnInYear = f.start >= periodStart && f.start <= periodEnd;
  let owed = drawnInYear ? asPence(f.amount_p) : asPence(f.opening_p ?? f.amount_p);
  const opening = drawnInYear ? 0n : owed;
  // The first payment falls the month after the loan is drawn
  const first = drawnInYear ? nextMonth(f.start.slice(0, 7)) : periodStart.slice(0, 7);
  const rows = monthsFrom(first, periodEnd.slice(0, 7)).map((key) => {
    const e = f.months?.[key] ?? {};
    const due = f.ends && key > f.ends.slice(0, 7) ? 0n : asPence(f.payment_p);
    // A repayment debits the loan account, so it is positive in the debit-positive ledger
    const fromLedger = ledger.filter((t) => t.date.slice(0, 7) === key && asPence(t.amount_p) > 0n);
    const entered = e.paid_p != null && e.paid_p !== '';
    const paid = entered ? asPence(e.paid_p!) : f.account ? fromLedger.reduce((a, t) => a + asPence(t.amount_p), 0n) : due;
    const interest = e.interest_p != null && e.interest_p !== '' ? asPence(e.interest_p) : monthInterest(owed, f.rate);
    owed = owed + interest - paid;
    const source: 'entered' | 'ledger' | 'none' | 'agreement' = entered ? 'entered' : f.account ? (fromLedger.length ? 'ledger' : 'none') : 'agreement';
    return { key, due, paid, paidOn: fromLedger[0]?.date, source, interest, capital: paid - interest, owed, note: e.note, vouched: !!e.vouched_by && e.vouched_sig === rowSig(paid, interest), vouchedBy: e.vouched_by };
  });
  const sum = (k: 'due' | 'paid' | 'interest' | 'capital') => rows.reduce((a, r) => a + r[k], 0n);
  const mapping = f.account ? db.account_mappings.find((m) => m.engagement_id === engagementId && m.source_code === f.account) : undefined;
  return {
    f,
    rows,
    opening,
    drawn: drawnInYear ? asPence(f.amount_p) : 0n,
    due: sum('due'),
    paid: sum('paid'),
    interest: sum('interest'),
    capital: sum('capital'),
    closing: owed,
    // The ledger holds the loan as a credit, so the amount owed is minus its balance
    ledger: mapping ? -asPence(mapping.balance_p) : null,
    lender: f.lender_p != null && f.lender_p !== '' ? asPence(f.lender_p) : null,
    code: (f.account && chartCodeOf(engagementId, f.account)) || '8000',
  };
}

/** The repayments run forward from the year end: capital due in each band, and the next year's interest. */
export function dueSplit(f: Facility, closing: bigint, periodEnd: string) {
  const out = { within1: 0n, oneToFive: 0n, over5: 0n, interestNext12: 0n };
  let owed = closing;
  const pay = asPence(f.payment_p);
  let m = nextMonth(periodEnd.slice(0, 7));
  for (let i = 1; i <= 600 && owed > 0n; i++, m = nextMonth(m)) {
    const interest = monthInterest(owed, f.rate);
    const last = !!f.ends && m >= f.ends.slice(0, 7);
    // Interest only (or a payment that does not cover the interest): the capital is repaid at the end
    const capital = last ? owed : pay > interest ? (pay - interest > owed ? owed : pay - interest) : 0n;
    if (i <= 12) out.interestNext12 += interest;
    if (i <= 12) out.within1 += capital;
    else if (i <= 60) out.oneToFive += capital;
    else out.over5 += capital;
    owed -= capital;
    if (!f.ends && capital === 0n && i > 12) {
      out.over5 += owed; // shortcut: no end date and no capital repaid means the rest falls after five years; enter the end date to place it
      owed = 0n;
    }
  }
  return out;
}

export function loansReview(ctx: PaperContext) {
  const { data } = ctx;
  const facilities = facilitiesOf(data, ctx.periodStart);
  const decisions: Record<string, { decision?: 'accept' | 'reject'; reason?: string }> = data.findings ?? {};
  const ws = facilities.map((f) => {
    const w = facilityWorkings(f, ctx.periodStart, ctx.periodEnd, ctx.engagementId);
    const split = dueSplit(f, w.closing, ctx.periodEnd);
    const value = asPence(f.security_value_p);
    const ltv = f.ltv_max && value > 0n ? { max: Number(f.ltv_max), pct: Number((w.closing * 10000n) / value) / 100, headroom: (w.closing * 100n * 100n) / bp(f.ltv_max) } : null;
    const rent = asPence(f.rent_p);
    const icr = f.icr_min && split.interestNext12 > 0n ? { min: Number(f.icr_min), times: Number((rent * 100n) / split.interestNext12) / 100 } : null;
    return { ...w, split, ltv, icr };
  });

  // What does not agree becomes a finding to accept or decline
  const findings: Finding[] = [];
  for (const w of ws) {
    const f = w.f;
    const at = (kind: FindingKind) => `${f.id}:${kind}`;
    if (w.ledger !== null && w.closing - w.ledger > 0n) {
      findings.push({ key: at('interest'), f, kind: 'interest', amount: w.closing - w.ledger, title: `${f.name}: interest not in the ledger`, why: `The workings give ${formatPence(w.closing)} owed at ${ukDate(ctx.periodEnd)} but the ledger shows ${formatPence(w.ledger)}. Interest of ${formatPence(w.interest)} was charged in the year; posting the difference makes the ledger agree to the workings.` });
    }
    const day = Number(f.start.slice(8, 10)) || 1;
    const endDay = Number(ctx.periodEnd.slice(8, 10));
    const days = endDay >= day ? endDay - day : 0;
    const accrue = w.closing > 0n && days > 0 ? (w.closing * bp(f.rate) * BigInt(days) + 1825000n) / 3650000n : 0n;
    if (accrue > 0n) {
      findings.push({ key: at('accrue'), f, kind: 'accrue', amount: accrue, title: `${f.name}: interest from ${day + 1} to ${endDay} ${ukDate(ctx.periodEnd).split(' ')[1]} not yet charged`, why: `Interest is charged on the ${day}${day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month, so ${days} days at ${f.rate}% on ${formatPence(w.closing)} belong to this year but are charged after it.` });
    }
    const fee = asPence(f.fee_p);
    if (fee > 0n) {
      const term = f.ends ? Math.max(1, daysBetween(f.start, f.ends)) : 1825;
      const inYear = Math.max(0, daysBetween(f.start > ctx.periodStart ? f.start : ctx.periodStart, ctx.periodEnd) + 1);
      // shortcut: spread straight line by days, not by the effective interest method; close enough unless the fee is large against the loan
      const share = (fee * BigInt(Math.min(inYear, term))) / BigInt(term);
      findings.push({ key: at('fee'), f, kind: 'fee', amount: fee, share, title: `${f.name}: arrangement fee expensed in full`, why: `The ${formatPence(fee)} fee is a cost of the loan: it reduces the loan and is spread over its term as interest. ${formatPence(share)} belongs to this year and ${formatPence(fee - share)} to later years.` });
    }
  }
  for (const x of findings) Object.assign(x, decisions[x.key] ?? {});

  const lines: JLine[] = [];
  for (const x of findings.filter((y) => y.decision === 'accept')) {
    const w = ws.find((y) => y.f.id === x.f.id)!;
    if (x.kind === 'interest') lines.push(...pair('5100', w.code, x.amount, `${x.f.name}: interest charged by the lender`));
    if (x.kind === 'accrue') lines.push(...pair('5100', '7630', x.amount, `${x.f.name}: interest to the year end`));
    if (x.kind === 'fee') {
      lines.push(...pair(w.code, x.f.fee_code || '4820', x.amount, `${x.f.name}: arrangement fee taken off the loan`));
      if (x.share) lines.push(...pair('5150', w.code, x.share, `${x.f.name}: this year's share of the arrangement fee`));
    }
  }

  const total = (k: 'closing' | 'interest' | 'paid' | 'drawn' | 'opening') => ws.reduce((a, w) => a + w[k], 0n);
  const split = ws.reduce((a, w) => ({ within1: a.within1 + w.split.within1, oneToFive: a.oneToFive + w.split.oneToFive, over5: a.over5 + w.split.over5, interestNext12: a.interestNext12 + w.split.interestNext12 }), { within1: 0n, oneToFive: 0n, over5: 0n, interestNext12: 0n });
  const tbLiability = -ctx.leads.reduce((a, l) => a + l.final, 0n);
  const rows = ws.flatMap((w) => w.rows);
  return { facilities, ws, findings, lines, split, tbLiability, closing: total('closing'), interest: total('interest'), paid: total('paid'), drawn: total('drawn'), opening: total('opening'), vouched: rows.filter((r) => r.vouched).length, rowCount: rows.length };
}

export function reviewLoans(ctx: PaperContext): string {
  const { data, totals, checks, anchors } = ctx;
  const r = loansReview(ctx);
  Object.assign(totals, { borrowings: r.closing, within_1y: r.split.within1, interest: r.interest, tb: r.tbLiability, difference: r.closing - r.tbLiability });
  r.ws.forEach((w) => anchors.push({ id: w.f.id, label: w.f.name }));

  const mapped = ctx.leads.some((l) => l.mapped);
  checks.push({ id: 'mapped', label: 'Accounts mapped', detail: mapped ? 'The loan accounts in the trial balance feed this paper.' : 'Map the client’s loan accounts to bank loans.', passed: mapped });
  if (!r.ws.length) {
    checks.push({ id: 'facilities', label: 'Facilities entered', detail: 'Add each loan, mortgage or hire purchase agreement.', passed: mapped && r.tbLiability === 0n });
    return '';
  }
  const noLender = r.ws.filter((w) => w.lender === null);
  const offLender = r.ws.filter((w) => w.lender !== null && w.lender !== w.closing);
  checks.push({
    id: 'lender',
    label: 'Monthly workings agree to lender statements',
    detail: noLender.length
      ? `Enter the balance on the lender's statement for ${noLender.map((w) => w.f.name).join(', ')}.`
      : offLender.length
        ? offLender.map((w) => `${w.f.name}: workings ${formatPence(w.closing)}, lender ${formatPence(w.lender!)}`).join('; ') + '. Correct the paid or interest figures.'
        : 'Every facility agrees to its lender statement.',
    passed: !noLender.length && !offLender.length,
  });
  const open = r.findings.filter((x) => !x.decision || (x.decision === 'reject' && !x.reason?.trim()));
  checks.push({ id: 'findings', label: 'Findings decided', detail: open.length ? `Accept or give a reason: ${open.map((x) => x.title).join('; ')}.` : 'Every finding has a decision.', passed: !open.length });
  const after = r.closing - r.tbLiability;
  checks.push({ id: 'tb', label: 'Ledger agrees or difference explained', detail: after === 0n ? `${formatPence(r.closing)} in both.` : `Workings ${formatPence(r.closing)} · TB ${formatPence(r.tbLiability)}; difference ${formatPence(after)}${r.lines.length ? ' until the journal is posted' : ''}.`, passed: after === 0n || (!open.length && r.lines.length > 0) });
  const covenants = r.ws.filter((w) => w.ltv || w.icr);
  const broken = covenants.filter((w) => (w.ltv && w.ltv.pct > w.ltv.max) || (w.icr && w.icr.times < w.icr.min));
  checks.push({
    id: 'covenants',
    label: 'Covenants tested',
    detail: !covenants.length ? 'No covenants entered.' : broken.length ? `Broken at the year end: ${broken.map((w) => w.f.name).join(', ')}. Unless waived by then, the whole loan is due within one year.` : 'Every covenant is met.',
    passed: !broken.length || !!data.covenant_waived,
  });
  checks.push(journalCheck(data.journal, r.lines, 'Journals sent'));
  return `Borrowings of ${formatPence(r.closing)} across ${r.ws.length} facilit${r.ws.length === 1 ? 'y' : 'ies'} are worked month by month${noLender.length ? '' : ' and agree to the lenders’ statements'}. Interest for the year is ${formatPence(r.interest)}. ${formatPence(r.split.within1)} of capital is due within one year and ${formatPence(r.split.oneToFive + r.split.over5)} after more than one year, of which ${formatPence(r.split.over5)} after more than five years.`;
}

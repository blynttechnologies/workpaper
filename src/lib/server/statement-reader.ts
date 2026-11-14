import { toPence } from '../money';
import type { ExtractedField } from './extraction';
import { run, aiAvailable } from './ai/gateway';
import { AiError, type AiSource, type RunCtx } from './ai/types';
import { readBankStatement } from './ai/tasks/statement';

/** A balance printed on the statement, offered when picking the row's statement figure. */
export interface BalanceCandidate {
  date: string;
  balance_p: string;
  label: string;
  page: number;
}

export interface StatementRead {
  bank_name: ExtractedField<string>;
  statement_date: ExtractedField<string>;
  statement_balance_p: ExtractedField<string>;
  candidates: BalanceCandidate[];
}

/** One balance as printed: the opening and closing lines and the running balance after each day's transactions. */
export interface PrintedBalance {
  date: string;
  balance_p: string;
  page: number;
  kind: 'opening' | 'line' | 'closing';
  /** The line's amount, money in positive, when printed */
  amount_p?: string;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const uk = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The balance at exactly the year end, worked out from the balances printed (not left to the model):
 * the last balance dated on or before the year end, dated the year end itself. Then the balance on the
 * day before that and on the first day after the year end, and the statement's own opening and closing.
 * No year-end balance when the statement does not reach the year end.
 */
/**
 * The balances oldest first. Statements print oldest-first or newest-first: each running balance is the one
 * before it plus the line's amount, which shows the direction; without amounts, the first and last dates do.
 */
export function inDateOrder(printed: PrintedBalance[]): PrintedBalance[] {
  const fits = (rows: PrintedBalance[]) =>
    rows.slice(1).filter((b, i) => b.amount_p != null && BigInt(b.balance_p) - BigInt(rows[i].balance_p) === BigInt(b.amount_p)).length;
  const reversed = [...printed].reverse();
  const forward = fits(printed), backward = fits(reversed);
  if (forward !== backward) return forward > backward ? printed : reversed;
  const dated = printed.filter((b) => ISO.test(b.date));
  return dated.length > 1 && dated[0].date > dated[dated.length - 1].date ? reversed : printed;
}

export function pickBalances(printed: PrintedBalance[], periodEnd: string | null, periodTo: string | null = null): { atEnd: BalanceCandidate | null; others: BalanceCandidate[] } {
  const rows = inDateOrder(printed).filter((b) => ISO.test(b.date)).map((b, i) => ({ ...b, i }));
  // Printed order breaks ties within a day: the last balance on a day is that day's closing figure
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  const opening = sorted.find((b) => b.kind === 'opening') ?? sorted[0];
  const closing = [...sorted].reverse().find((b) => b.kind === 'closing') ?? sorted[sorted.length - 1];
  const option = (b: (typeof sorted)[number], label: string, date = b.date): BalanceCandidate => ({ date, balance_p: b.balance_p, label, page: b.page });
  const others: BalanceCandidate[] = [];
  let atEnd: BalanceCandidate | null = null;
  if (periodEnd && sorted.length && sorted[0].date <= periodEnd) {
    const upTo = sorted.filter((b) => b.date <= periodEnd);
    const last = upTo[upTo.length - 1];
    // A statement whose period runs to the year end reaches it, even with no movement on the last days
    const reaches = sorted[sorted.length - 1].date >= periodEnd || (!!periodTo && periodTo >= periodEnd);
    if (reaches) atEnd = option(last, last.date === periodEnd ? `Balance on ${uk(periodEnd)}` : `Balance on ${uk(periodEnd)} (no movement since ${uk(last.date)})`, periodEnd);
    // The balance on the last day with movements before the one the year-end figure comes from
    const before = upTo.filter((b) => b.date < last.date).pop();
    if (before) others.push(option(before, 'Previous balance'));
    const after = sorted.find((b) => b.date > periodEnd);
    if (after) others.push(option(sorted.filter((b) => b.date === after.date).pop()!, 'Next balance'));
  }
  if (opening) others.push(option(opening, 'Statement opening balance'));
  if (closing) others.push(option(closing, 'Statement closing balance'));
  // One line per figure and date
  const seen = new Set(atEnd ? [`${atEnd.date}|${atEnd.balance_p}`] : []);
  return { atEnd, others: others.filter((o) => !seen.has(`${o.date}|${o.balance_p}`) && seen.add(`${o.date}|${o.balance_p}`)) };
}

/**
 * Read a bank statement through the AI gateway: every dated balance printed on it, copied exactly. The balance
 * at the year end is then picked by date in code. Returns null when no AI provider is set up, the file type
 * cannot be sent, or nothing could be read: never a guessed figure.
 */
export async function readStatement(
  file: { mime: string; bytes: Buffer; filename?: string },
  periodEnd?: string,
  ctx: RunCtx = { firmId: 'unknown', userId: 'unknown' }
): Promise<(StatementRead & { source: AiSource }) | null> {
  if (!aiAvailable(ctx.firmId, readBankStatement)) return null;
  if (file.mime !== 'application/pdf' && !(IMAGE_TYPES as readonly string[]).includes(file.mime)) return null;
  const end = periodEnd && ISO.test(periodEnd) ? periodEnd : null;

  let r;
  try {
    r = await run(readBankStatement, { file: { type: 'file', mime: file.mime, data: file.bytes.toString('base64'), filename: file.filename } }, ctx);
  } catch (err) {
    // Refused, cut off or unreadable: leave the balance for a person, as before
    if (err instanceof AiError && ['refusal', 'truncated', 'invalid_output', 'not_configured', 'limit'].includes(err.code)) return null;
    throw err;
  }
  const out = r.output;
  const source: AiSource = { provider: r.provider, model: r.model, task_version: r.taskVersion, request_id: r.requestId, ...(r.agreement === undefined ? {} : { agreement: r.agreement }) };
  const printed = (out.balances ?? [])
    .filter((b) => DECIMAL.test(b.balance.trim()) && ISO.test(b.date))
    .map((b) => ({ date: b.date, balance_p: toPence(b.balance).toString(), page: b.page, kind: b.kind, ...(DECIMAL.test((b.amount ?? '').trim()) ? { amount_p: toPence(b.amount).toString() } : {}) }));
  if (!out.found || !printed.length) return null;

  const { atEnd, others } = pickBalances(printed, end, ISO.test(out.period_to ?? '') ? out.period_to : null);
  // With no year-end balance the statement's closing balance leads, labelled as such
  const main = atEnd ?? others.find((o) => o.label === 'Statement closing balance') ?? others[0];
  // Two models reading different balances is never Ready, however sure each one was
  const disputed = r.agreement === false;
  const field = <T,>(value: T, reason: string): ExtractedField<T> => ({
    value,
    confidence: out.confidence,
    page: main.page,
    gate: out.confidence >= 90 && !disputed ? 'ready' : 'check',
    reason: disputed ? `${reason}. A second AI model read this statement differently: check it` : reason,
  });
  return {
    source,
    bank_name: field(out.bank_name, 'Bank named on the statement'),
    statement_date: field(main.date, atEnd ? 'The year end' : 'The statement does not reach the year end'),
    statement_balance_p: field(main.balance_p, atEnd || !end ? main.label : `${main.label}: this statement does not cover the year end, ${uk(end)}`),
    // Only the year-end balance is offered; the other dates on the statement were noise to pick through
    candidates: [],
  };
}

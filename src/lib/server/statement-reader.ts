import Anthropic from '@anthropic-ai/sdk';
import { toPence } from '../money';
import type { ExtractedField } from './extraction';

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
}

const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'false if this is not a bank statement or no balance can be read' },
    bank_name: { type: 'string' },
    confidence: { type: 'integer', description: '0-100: how sure you are every balance is copied exactly' },
    balances: {
      type: 'array',
      description: 'Every balance printed on the statement, in the order printed',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD of the line the balance is printed on' },
          balance: { type: 'string', description: 'Plain decimal as printed, e.g. "118402.17"; negative ("-250.00") if overdrawn or marked DR/OD' },
          page: { type: 'integer', description: '1-based page' },
          kind: { type: 'string', enum: ['opening', 'line', 'closing'], description: 'opening or closing balance line, or the running balance on a transaction line' },
        },
        required: ['date', 'balance', 'page', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['found', 'bank_name', 'confidence', 'balances'],
  additionalProperties: false,
} as const;

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
export function pickBalances(printed: PrintedBalance[], periodEnd: string | null): { atEnd: BalanceCandidate | null; others: BalanceCandidate[] } {
  const rows = printed.filter((b) => ISO.test(b.date)).map((b, i) => ({ ...b, i }));
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
    const reaches = sorted[sorted.length - 1].date >= periodEnd;
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
 * Read a bank statement with Claude: every dated balance printed on it, copied exactly. The balance at the
 * year end is then picked by date in code. Returns null when no Anthropic credentials are configured, the
 * file type cannot be sent, or nothing could be read: never a guessed figure.
 */
export async function readStatement(file: { mime: string; bytes: Buffer }, periodEnd?: string): Promise<StatementRead | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const data = file.bytes.toString('base64');
  const source: Anthropic.Beta.BetaContentBlockParam | null =
    file.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : (IMAGE_TYPES as readonly string[]).includes(file.mime)
        ? { type: 'image', source: { type: 'base64', media_type: file.mime as (typeof IMAGE_TYPES)[number], data } }
        : null;
  if (!source) return null;
  const end = periodEnd && ISO.test(periodEnd) ? periodEnd : null;

  const client = new Anthropic();
  // Streamed: a long statement lists many balances. Copying printed figures needs little reasoning, so effort is low to keep it quick.
  const res = await client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          source,
          {
            type: 'text',
            text:
              'This is a bank statement for a UK year-end bank reconciliation. List every balance printed on it, in the order printed: ' +
              'the opening balance line, the running balance on each transaction line, and the closing balance line. Give each the date of ' +
              'the line it is printed on (a running balance on a line with no date of its own takes the date of the line above). ' +
              'Copy every figure and date exactly as printed; do not calculate or fill in balances that are not printed. Use the ledger ' +
              'balance, not an available or cleared balance. If the statement covers several accounts or nothing can be read, set found to false.',
          },
        ],
      },
    ],
  }).finalMessage();
  if (res.stop_reason !== 'end_turn') return null;
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  const out = JSON.parse(text.text) as { found: boolean; bank_name: string; confidence: number; balances: { date: string; balance: string; page: number; kind: PrintedBalance['kind'] }[] };
  const printed = (out.balances ?? [])
    .filter((b) => DECIMAL.test(b.balance.trim()) && ISO.test(b.date))
    .map((b) => ({ date: b.date, balance_p: toPence(b.balance).toString(), page: b.page, kind: b.kind }));
  if (!out.found || !printed.length) return null;

  const { atEnd, others } = pickBalances(printed, end);
  // With no year-end balance the statement's closing balance leads, labelled as such
  const main = atEnd ?? others.find((o) => o.label === 'Statement closing balance') ?? others[0];
  const field = <T,>(value: T, reason: string): ExtractedField<T> => ({ value, confidence: out.confidence, page: main.page, gate: out.confidence >= 90 ? 'ready' : 'check', reason });
  return {
    bank_name: field(out.bank_name, 'Bank named on the statement'),
    statement_date: field(main.date, atEnd ? 'The year end' : 'The statement does not reach the year end'),
    statement_balance_p: field(main.balance_p, main.label),
    // Only the year-end balance is offered; the other dates on the statement were noise to pick through
    candidates: [],
  };
}

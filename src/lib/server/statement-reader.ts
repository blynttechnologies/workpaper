import Anthropic from '@anthropic-ai/sdk';
import { toPence } from '../money';
import type { ExtractedField } from './extraction';

/** Another balance printed on the statement that someone might mean, offered when the main read looks wrong. */
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

const AMOUNT = { type: 'string', description: 'Plain decimal, e.g. "118402.17"; negative ("-250.00") if overdrawn or marked DR' } as const;
const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'false if this is not a bank statement or no balance can be read' },
    bank_name: { type: 'string' },
    balance_date: { type: 'string', description: 'YYYY-MM-DD the main balance is at' },
    balance: AMOUNT,
    page: { type: 'integer', description: '1-based page the main balance is printed on' },
    confidence: { type: 'integer', description: '0-100: how sure you are the main balance is exactly right' },
    others: {
      type: 'array',
      description: 'Up to 4 other balances printed on the statement, each a different date',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          balance: AMOUNT,
          label: { type: 'string', description: 'e.g. "Last balance before the year end", "First balance after the year end", "Statement opening balance", "Statement closing balance"' },
          page: { type: 'integer' },
        },
        required: ['date', 'balance', 'label', 'page'],
        additionalProperties: false,
      },
    },
  },
  required: ['found', 'bank_name', 'balance_date', 'balance', 'page', 'confidence', 'others'],
  additionalProperties: false,
} as const;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/**
 * Read the balance a bank statement shows at the reconciliation date, with Claude, plus the other
 * balances near it so a wrong read can be swapped in one click. Returns null when no Anthropic
 * credentials are configured, the file type cannot be sent, or no balance could be read: never a guess.
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
  const end = periodEnd && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ? periodEnd : null;

  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          source,
          {
            type: 'text',
            text:
              'This is a bank statement uploaded for a UK year-end bank reconciliation. ' +
              (end
                ? `The reconciliation date is ${end}. The main balance is the account balance at the end of that day: the running balance after the last transaction dated on or before ${end}, or the statement closing balance if the statement ends on that date. `
                : 'The main balance is the closing balance printed at the end of the statement period. ')
              + 'Use the ledger balance, not an available or cleared balance. In "others", list the other balances printed on the statement that someone might mean instead: the last balance before the reconciliation date, the first balance after it, and the statement opening and closing balances, skipping any with the same date as the main balance. ' +
              'Copy every figure exactly as printed. If the statement covers several accounts or nothing can be read, set found to false.',
          },
        ],
      },
    ],
  });
  if (res.stop_reason !== 'end_turn') return null;
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  const out = JSON.parse(text.text) as {
    found: boolean;
    bank_name: string;
    balance_date: string;
    balance: string;
    page: number;
    confidence: number;
    others: { date: string; balance: string; label: string; page: number }[];
  };
  if (!out.found || !DECIMAL.test(out.balance.trim())) return null;

  const field = <T,>(value: T, reason: string): ExtractedField<T> => ({ value, confidence: out.confidence, page: out.page, gate: out.confidence >= 90 ? 'ready' : 'check', reason });
  const offEnd = end && out.balance_date !== end ? ` (dated ${out.balance_date}, not the year end)` : '';
  return {
    bank_name: field(out.bank_name, 'Bank named on the statement'),
    statement_date: field(out.balance_date, 'Date of the balance read'),
    statement_balance_p: field(toPence(out.balance).toString(), `Balance read by AI from page ${out.page}${offEnd}`),
    candidates: out.others
      .filter((o) => DECIMAL.test(o.balance.trim()) && o.date !== out.balance_date)
      .slice(0, 4)
      .map((o) => ({ date: o.date, balance_p: toPence(o.balance).toString(), label: o.label, page: o.page })),
  };
}

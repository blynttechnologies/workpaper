import Anthropic from '@anthropic-ai/sdk';
import { toPence } from '../money';
import type { ExtractedField } from './extraction';

export interface StatementRead {
  bank_name: ExtractedField<string>;
  statement_date: ExtractedField<string>;
  statement_balance_p: ExtractedField<string>;
}

const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'false if this is not a bank statement or the closing balance cannot be read' },
    bank_name: { type: 'string' },
    statement_date: { type: 'string', description: 'Closing date of the statement, YYYY-MM-DD' },
    closing_balance: { type: 'string', description: 'Closing balance as a plain decimal, e.g. "118402.17"; negative ("-250.00") if overdrawn or marked DR' },
    page: { type: 'integer', description: '1-based page the closing balance is printed on' },
    confidence: { type: 'integer', description: '0-100: how sure you are the closing balance is exactly right' },
  },
  required: ['found', 'bank_name', 'statement_date', 'closing_balance', 'page', 'confidence'],
  additionalProperties: false,
} as const;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/**
 * Read a bank statement's closing balance with Claude. Returns null when no Anthropic credentials are
 * configured, the file type cannot be sent, or the balance could not be read: never a guessed figure.
 */
export async function readStatement(file: { mime: string; bytes: Buffer }): Promise<StatementRead | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const data = file.bytes.toString('base64');
  const source: Anthropic.Beta.BetaContentBlockParam | null =
    file.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : (IMAGE_TYPES as readonly string[]).includes(file.mime)
        ? { type: 'image', source: { type: 'base64', media_type: file.mime as (typeof IMAGE_TYPES)[number], data } }
        : null;
  if (!source) return null;

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
              'This is a bank statement uploaded for a UK year-end bank reconciliation. Read the closing balance of the account ' +
              'exactly as printed at the end of the statement period (the last balance, not the opening balance, a running ' +
              'balance mid-period, or an available/cleared balance). If the statement covers several accounts or the figure is ' +
              'unclear, set found to false.',
          },
        ],
      },
    ],
  });
  if (res.stop_reason !== 'end_turn') return null;
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  const out = JSON.parse(text.text) as { found: boolean; bank_name: string; statement_date: string; closing_balance: string; page: number; confidence: number };
  if (!out.found || !/^-?\d+(\.\d{1,2})?$/.test(out.closing_balance.trim())) return null;

  const field = <T,>(value: T, reason: string): ExtractedField<T> => ({ value, confidence: out.confidence, page: out.page, gate: out.confidence >= 90 ? 'ready' : 'check', reason });
  return {
    bank_name: field(out.bank_name, 'Bank named on the statement'),
    statement_date: field(out.statement_date, 'Statement closing date'),
    statement_balance_p: field(toPence(out.closing_balance).toString(), `Closing balance read by AI from page ${out.page}`),
  };
}

import { asPence } from '../money';
import type { AccountMapping } from '../types/models';

/**
 * Why a mapping is not confirmed yet, in words: `blocker` stops it being confirmed at all; `reasons`
 * are what to look at before confirming it.
 */
export function whyNotConfirmed(m: Pick<AccountMapping, 'blynt_code' | 'confidence' | 'balance_p' | 'sign_mismatch' | 'ai_reason'> & { gate?: string }, accountName = ''): { blocker: string | null; reasons: string[] } {
  if (!m.blynt_code) return { blocker: 'No chart account is chosen yet. Pick one, then confirm.', reasons: [] };
  const target = `${m.blynt_code}${accountName ? ` ${accountName}` : ''}`;
  const debit = asPence(m.balance_p) >= 0n;
  const reasons: string[] = [];
  if (m.sign_mismatch) {
    reasons.push(`The balance is a ${debit ? 'debit' : 'credit'}, but ${target} normally holds a ${debit ? 'credit' : 'debit'}. Check the account chosen, or that the balance is the right way round.`);
  }
  if (m.confidence < 90) {
    const level = m.confidence < 70 ? 'Exception' : 'Check';
    reasons.push(`${level}: the AI is ${m.confidence}% sure this is ${target}${m.ai_reason ? ` (${m.ai_reason})` : ''}. Below ${m.confidence < 70 ? 70 : 90}% it waits for you; confirming says you have checked it.`);
  } else if (m.gate === 'exception') {
    reasons.push('It was marked as an exception when it was mapped. Check it, then confirm.');
  }
  return { blocker: null, reasons };
}

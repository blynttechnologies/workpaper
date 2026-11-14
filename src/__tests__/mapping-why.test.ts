import { describe, it, expect } from 'vitest';
import { whyNotConfirmed } from '../lib/mapping/why';

describe('why a mapping is not confirmed', () => {
  const m = { blynt_code: '6000', confidence: 67, balance_p: '555450', sign_mismatch: false, ai_reason: 'Matched "bank" in the name' };

  it('a low-confidence mapping can be confirmed, with the reason it waits', () => {
    expect(whyNotConfirmed(m, 'Main bank account')).toEqual({
      blocker: null,
      reasons: ['Exception: the AI is 67% sure this is 6000 Main bank account (Matched "bank" in the name). Below 70% it waits for you; confirming says you have checked it.'],
    });
  });

  it('no chart account blocks it; a balance the wrong way round is named', () => {
    expect(whyNotConfirmed({ ...m, blynt_code: null }).blocker).toMatch(/No chart account/);
    expect(whyNotConfirmed({ ...m, confidence: 95, sign_mismatch: true }, 'Main bank account').reasons).toEqual([
      'The balance is a debit, but 6000 Main bank account normally holds a credit. Check the account chosen, or that the balance is the right way round.',
    ]);
    expect(whyNotConfirmed({ ...m, confidence: 95 }).reasons).toEqual([]);
  });
});

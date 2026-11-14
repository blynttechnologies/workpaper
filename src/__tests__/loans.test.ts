// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { paperContext } from '../lib/workpapers/engine';
import { dueSplit, facilityWorkings, loansReview, type Facility } from '../lib/workpapers/loans';

beforeEach(() => db.seed(true));

// The Unit 4 term loan from the design: £200,000 at 6.50%, drawn 3 Oct 2025, a payment holiday in January
const unit4: Facility = {
  id: 'u4',
  name: 'Unit 4 loan',
  rate: '6.5',
  payment_p: '175754',
  start: '2025-10-03',
  amount_p: '20000000',
  ends: '2040-10-03',
  months: { '2025-11': { paid_p: '174221' }, '2025-12': { paid_p: '174221' }, '2026-01': { paid_p: '0' } },
};

describe('loans worked month by month', () => {
  it('matches the lender: interest on the balance owed each month, the holiday added to the loan', () => {
    const w = facilityWorkings(unit4, '2025-04-01', '2026-03-31', 'none');
    expect(w.rows.map((r) => [r.key, r.interest, r.owed])).toEqual([
      ['2025-11', 108333n, 19934112n],
      ['2025-12', 107976n, 19867867n],
      ['2026-01', 107618n, 19975485n],
      ['2026-02', 108201n, 19907932n],
      ['2026-03', 107835n, 19840013n],
    ]);
    expect(w).toMatchObject({ interest: 539963n, paid: 699950n, closing: 19840013n });
  });

  it('splits the capital by when it is due, and an interest-only loan at its end', () => {
    const s = dueSplit(unit4, 19840013n, '2026-03-31');
    expect(s.within1 + s.oneToFive + s.over5).toBe(19840013n);
    expect(s.within1).toBeGreaterThan(800000n);
    expect(s.within1).toBeLessThan(900000n);
    const mortgage: Facility = { id: 'm', name: 'Flat 2', rate: '5.19', payment_p: '51900', start: '2018-06-12', amount_p: '12000000', ends: '2043-06-12' };
    expect(dueSplit(mortgage, 12000000n, '2026-03-31')).toMatchObject({ within1: 0n, oneToFive: 0n, over5: 12000000n });
  });

  it('turns what the ledger is missing into findings that build the journal', () => {
    const wp = db.addWorkpaper(db.engagements[0].id, 'L-20')!;
    const e = db.engagements[0];
    wp.data_json = { ...wp.data_json, facilities: [{ ...unit4, start: e.period_start, months: {} }] };
    let r = loansReview(paperContext(wp));
    expect(r.findings.map((x) => x.kind)).toContain('accrue');
    wp.data_json.findings = Object.fromEntries(r.findings.map((x) => [x.key, { decision: 'accept' }]));
    r = loansReview(paperContext(wp));
    const dr = r.lines.reduce((a, l) => a + l.debit, 0n);
    expect(dr).toBe(r.lines.reduce((a, l) => a + l.credit, 0n));
    expect(r.lines.some((l) => l.code === '7630')).toBe(true);
  });
});

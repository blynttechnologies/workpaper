import { describe, it, expect } from 'vitest';
import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';

describe('accruals paper', () => {
  it('includes the costs accrued on the trade creditors search, in the total and the summary', () => {
    db.seed(true);
    const ENG = 'eng_harlow_fy26';
    const paper = (ref: string) => db.workpapers.find((w) => w.engagement_id === ENG && w.ref === ref) ?? db.addWorkpaper(ENG, ref)!;
    const k10 = paper('K-10');
    const k20 = paper('K-20');
    const before = evaluatePaper(k20)!.totals.total;
    k10.data_json = {
      ...k10.data_json,
      search: {
        items: [
          { id: 'srch_1', date: '2026-11-03', contact: 'Booker', desc: 'wk 32', amount_p: '752673', code: '2000', decision: 'accrue' },
          { id: 'srch_2', date: '2026-11-04', contact: 'Booker', desc: 'Hubdoc', amount_p: '308875', code: '2000', decision: 'creditor' },
          { id: 'srch_3', date: '2026-11-05', contact: 'SS', desc: 'Fuel', amount_p: '125340', code: '2000' },
        ],
      },
    };
    const r = evaluatePaper(k20)!;
    expect(r.totals.total).toBe(before + 752673n);
    expect(r.totals.from_search).toBe(752673n);
    if (r.draftConclusion) expect(r.draftConclusion).toContain('£7,526.73 for 1 cost(s) accrued from the search');
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));
const run = vi.fn();
vi.mock('../lib/server/ai/gateway', () => ({ run: (...a: unknown[]) => run(...a), aiAvailable: () => true }));

import { db } from '../lib/server/db';
import { searchAfterDate } from '../lib/workpapers/creditors';
import { reviewAccruedSales, reviewAfterDateCosts, reviewPrepaidCosts } from '../lib/server/ai/services';

const actor = { id: 'usr_admin', name: 'Admin', role: 'admin' as const, firmId: 'firm_blynt_uk' };
let engId = '';
let pe = '';
const day = (n: number) => new Date(Date.parse(pe) + n * 86_400_000).toISOString().slice(0, 10);
const tx = (id: string, contact: string, date: string, amount_p: string, description: string) =>
  db.transactions.push({ id, engagement_id: engId, account_code: 'PUR', account_name: 'Purchases', date, contact, description, amount_p, vat_p: '0', gross_p: amount_p, source: 'Xero' } as any);

beforeEach(() => {
  db.seed(true);
  run.mockReset();
  engId = db.engagements[0].id;
  pe = db.engagements[0].period_end;
  db.transactions = db.transactions.filter((t) => t.engagement_id !== engId);
  db.account_mappings.push({ id: 'm_pur', engagement_id: engId, source_code: 'PUR', source_name: 'Purchases', source_type: 'Direct Costs', balance_p: '0', blynt_code: '2000', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
  tx('tx_a_0', 'Booker', day(3), '752673', '1666 wk 32');
  tx('tx_b_1', 'Booker', day(7), '258085', '1666 wk 32');
  tx('tx_old', 'Booker', day(-4), '700000', '1666 wk 31');
});

describe('search for unrecorded liabilities', () => {
  it('keeps a decision and the AI reading when a new pull from Xero renumbers the ledger rows', () => {
    const first = searchAfterDate(engId, pe, 60, 10000n);
    expect(first.map((i) => i.id)).toEqual(['srch_tx_a_0', 'srch_tx_b_1']);
    const decided = [{ ...first[0], decision: 'accrue' as const, code: '4810', ai: { from: '', to: '', summary: 'Looks like this year.' } }, first[1]];
    // The same costs come back from Xero under new row numbers
    db.transactions.find((t) => t.id === 'tx_a_0')!.id = 'tx_a_5';
    db.transactions.find((t) => t.id === 'tx_b_1')!.id = 'tx_b_6';
    const again = searchAfterDate(engId, pe, 60, 10000n, decided);
    expect(again[0]).toMatchObject({ id: 'srch_tx_a_5', decision: 'accrue', code: '4810', ai: { summary: 'Looks like this year.' } });
    expect(again[1].decision).toBeUndefined();
  });
});

describe("the AI's reading of costs posted after the period end", () => {
  it('reads the costs from the ledger with each supplier’s history, and drops dates that are not a range', async () => {
    run.mockResolvedValue({
      output: {
        items: [
          { id: 'srch_tx_a_0', covers_from: day(-6), covers_to: day(0), summary: 'Week 32 ends on the period end, so this looks like this year.' },
          { id: 'srch_tx_b_1', covers_from: 'early November', covers_to: '', summary: 'Cannot be told; check the delivery date on the bill.' },
          { id: 'srch_not_asked', covers_from: '', covers_to: '', summary: 'x' },
        ],
      },
      provider: 'anthropic',
      model: 'm',
    });
    const out = await reviewAfterDateCosts(actor, engId, { days: 60, min_p: '10000' });
    // An answer with no classification or confidence still gives the reading, with nothing for the gate to band
    const none = { classification: null, confidence: 0, gate: 'exception', source: 'none', supplier: 'Booker', model: 'm' };
    expect(out.items).toEqual([
      { id: 'srch_tx_a_0', from: day(-6), to: day(0), summary: 'Week 32 ends on the period end, so this looks like this year.', ...none },
      { id: 'srch_tx_b_1', from: '', to: '', summary: 'Cannot be told; check the delivery date on the bill.', ...none },
    ]);
    const input = run.mock.calls[0][1];
    expect(input.costs).toHaveLength(2);
    expect(input.supplier_history).toEqual([{ supplier: 'Booker', posted: day(-4), description: '1666 wk 31', amount_p: '700000' }]);
  });

  it('reads the costs the prepayments search found, from the cost accounts only', async () => {
    db.account_mappings.push({ id: 'm_sub', engagement_id: engId, source_code: 'SUB', source_name: 'Subscriptions', source_type: 'Overheads', balance_p: '0', blynt_code: '4600', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
    db.transactions.push({ id: 'tx_p_2', engagement_id: engId, account_code: 'SUB', account_name: 'Subscriptions', date: day(-30), contact: 'Acme', description: 'Annual licence', amount_p: '90000', vat_p: '0', gross_p: '90000', source: 'Xero' });
    run.mockResolvedValue({ output: { items: [{ id: 'prep_tx_p_2', covers_from: day(-30), covers_to: day(334), summary: 'Annual licence, so most of it runs past the year end.', classification: 'add', confidence: 93 }] }, provider: 'anthropic', model: 'm' });
    // tx_old is a purchase, not an overhead, so it is not read however it is asked for
    const out = await reviewPrepaidCosts(actor, engId, { ids: ['prep_tx_p_2', 'prep_tx_old'] });
    expect(out.items).toEqual([{ id: 'prep_tx_p_2', from: day(-30), to: day(334), summary: 'Annual licence, so most of it runs past the year end.', classification: 'add', confidence: 93, gate: 'ready', source: 'ai', supplier: 'Acme', model: 'm' }]);
    expect(run.mock.calls[0][0].id).toBe('review_prepaid_costs');
    expect(run.mock.calls[0][1].costs).toEqual([{ id: 'prep_tx_p_2', posted: day(-30), supplier: 'Acme', description: 'Annual licence', amount_p: '90000', account: expect.stringMatching(/^4600 /) }]);
  });

  it('reads the sales the accrued income search found: after the period end, from the income accounts, as positive amounts', async () => {
    db.account_mappings.push({ id: 'm_sal', engagement_id: engId, source_code: 'SAL', source_name: 'Sales', source_type: 'Revenue', balance_p: '0', blynt_code: '1000', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
    const sale = (id: string, date: string, description: string) => db.transactions.push({ id, engagement_id: engId, account_code: 'SAL', account_name: 'Sales', date, contact: 'Brightside', description, amount_p: '-120000', vat_p: '0', gross_p: '-120000', source: 'Xero' } as any);
    sale('tx_s_1', day(10), 'March retainer');
    sale('tx_s_0', day(-20), 'February retainer');
    run.mockResolvedValue({ output: { items: [{ id: 'acc_tx_s_1', covers_from: day(-30), covers_to: day(0), summary: 'March retainer, so the work was done before the year end.', classification: 'add', confidence: 75 }] }, provider: 'anthropic', model: 'm' });
    // tx_s_0 was invoiced in the year and tx_a_0 is a cost, so neither is read however it is asked for
    const out = await reviewAccruedSales(actor, engId, { ids: ['acc_tx_s_1', 'acc_tx_s_0', 'acc_tx_a_0'] });
    expect(out.items).toEqual([{ id: 'acc_tx_s_1', from: day(-30), to: day(0), summary: 'March retainer, so the work was done before the year end.', classification: 'add', confidence: 75, gate: 'check', source: 'ai', supplier: 'Brightside', model: 'm' }]);
    expect(run.mock.calls[0][0].id).toBe('review_accrued_sales');
    expect(run.mock.calls[0][1].costs).toEqual([{ id: 'acc_tx_s_1', posted: day(10), supplier: 'Brightside', description: 'March retainer', amount_p: '120000', account: expect.stringMatching(/^1000 /) }]);
    // What the customer was invoiced before, the same way round
    expect(run.mock.calls[0][1].supplier_history).toEqual([{ supplier: 'Brightside', posted: day(-20), description: 'February retainer', amount_p: '120000' }]);
  });

  it('does not ask the AI when there is nothing to read', async () => {
    expect(await reviewAfterDateCosts(actor, engId, { days: 60, min_p: '99999999' })).toEqual({ items: [] });
    expect(run).not.toHaveBeenCalled();
  });
});

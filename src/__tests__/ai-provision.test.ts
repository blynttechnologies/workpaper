// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));
const run = vi.fn();
vi.mock('../lib/server/ai/gateway', () => ({ run: (...a: unknown[]) => run(...a), aiAvailable: () => true }));

import { db } from '../lib/server/db';
import { suggestProvision } from '../lib/server/ai/services';

const actor = { id: 'usr_admin', name: 'Admin', role: 'admin' as const, firmId: 'firm_blynt_uk' };
let engId = '';

beforeEach(() => {
  db.seed(true);
  run.mockReset();
  engId = db.engagements[0].id;
  db.workpapers.push({
    id: 'wp_c10', engagement_id: engId, ref: 'C-10',
    data_json: {
      basis: 'due',
      lines: [
        { id: 'deb_1', desc: 'Highway Stops Retail Ltd', current_p: '0', d30_p: '0', d60_p: '0', d90_p: '307014', after_date_p: '7014', invoices: [{ ref: 'INV-9', date: '2026-07-31', due: '2026-07-31', days: 93, amount_p: '307014' }] },
        { id: 'deb_2', desc: 'Paid Up Ltd', current_p: '0', d30_p: '0', d60_p: '0', d90_p: '5000', after_date_p: '5000' },
      ],
    },
  } as any);
});

describe("the AI's suggested provision", () => {
  it('is a share of what is still due after receipts, worked out by Blynt, never more than all of it', async () => {
    run.mockResolvedValue({ output: { percent: 40, reason: 'Long overdue, little paid since.' }, provider: 'anthropic', model: 'm' });
    const out = await suggestProvision(actor, engId, 'C-10', 'deb_1');
    // £3,070.14 owed less £70.14 received after the period end = £3,000.00 still due
    expect(out).toMatchObject({ percent: 40, amount_p: '120000', reason: 'Long overdue, little paid since.' });
    const input = run.mock.calls[0][1];
    expect(input).toMatchObject({ customer: 'Highway Stops Retail Ltd', still_due_p: '300000', ageing_columns: { overdue_over_60_p: '307014' } });

    run.mockResolvedValue({ output: { percent: 250, reason: 'x' }, provider: 'anthropic', model: 'm' });
    expect((await suggestProvision(actor, engId, 'C-10', 'deb_1')).amount_p).toBe('300000');
  });

  it('does not ask the AI when everything was collected', async () => {
    const out = await suggestProvision(actor, engId, 'C-10', 'deb_2');
    expect(out).toMatchObject({ percent: 0, amount_p: '0' });
    expect(run).not.toHaveBeenCalled();
  });
});

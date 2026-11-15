// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { FIXED_ASSET_MOVEMENTS, OWNER_ACCOUNTS, STANDARD_CHART } from '@/lib/standard-chart';
import { db } from '@/lib/server/db';
import { inLead, papersForCode } from '@/lib/workpapers/common';

beforeEach(() => db.seed(true));

describe('fixed asset movement codes', () => {
  it('every category has disposals, and every depreciated one a charge for the year and its disposals, on free codes', () => {
    const codes = FIXED_ASSET_MOVEMENTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    const taken = new Set([...STANDARD_CHART, ...OWNER_ACCOUNTS].map((a) => a.code));
    expect(codes.filter((c) => taken.has(c))).toEqual([]);
    const name = (code: string) => FIXED_ASSET_MOVEMENTS.find((a) => a.code === code)?.name;
    expect(name('6602')).toBe('Plant and equipment cost - disposals');
    expect(name('6616')).toBe('Plant and equipment accumulated depreciation - charge for the year');
    expect(name('6617')).toBe('Plant and equipment accumulated depreciation - disposals');
    expect(name('6973')).toBe('Goodwill accumulated amortisation - charge for the year');
    expect(name('6562')).toBe('Land cost - disposals');
    expect(codes.every((c) => Number(c) >= 6500 && Number(c) <= 6999)).toBe(true);
  });

  it('each one rolls into its category, so the fixed assets paper counts it', () => {
    expect(inLead('6602', '6600')).toBe(true);
    expect(inLead('6616', '6610')).toBe(true);
    expect(inLead('6974', '6971')).toBe(true);
    expect(papersForCode('6716').map((t) => t.ref)).toEqual(papersForCode('6710').map((t) => t.ref));
    expect(db.blynt_accounts.some((a) => a.code === '6617')).toBe(true);
  });

  it("a practice's own account already on one of these codes keeps it", () => {
    const own = { ...STANDARD_CHART.find((a) => a.code === '6600')!, code: '6602', name: 'Plant - hire fleet', is_system: false, firm_id: 'firm_blynt_uk', parent_code: '6600' };
    db.importState({ blynt_accounts: [...db.blynt_accounts.filter((a) => a.code !== '6602'), own] });
    expect(db.blynt_accounts.filter((a) => a.code === '6602').map((a) => a.name)).toEqual(['Plant - hire fleet']);
  });
});

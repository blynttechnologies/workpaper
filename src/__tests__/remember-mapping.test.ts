// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { importTrialBalance } from '../lib/server/tb-import';

const FIRM = 'firm_blynt_uk';
const ENG = 'eng_meridian_fy26';
const actor = { id: 'usr_admin', name: 'Dev Administrator', role: 'admin' as const, firmId: FIRM };
const lines = [
  { code: '720', name: 'Staff lunch', debit: '1200', credit: '0' },
  { code: '721', name: 'Staff clothing', debit: '800', credit: '0' },
  { code: '1000', name: 'Sales', debit: '0', credit: '2000' },
];
const mapping = (code: string) => db.account_mappings.find((m) => m.engagement_id === ENG && m.source_code === code);

beforeEach(() => db.seed(true));

describe('remembering a mapping', () => {
  it('a confirmed line keeps its account after the next pull', () => {
    importTrialBalance(actor, ENG, lines, 'xero');
    const m = mapping('720')!;
    services.updateMapping(FIRM, actor, m.id, '3300'); // a correction, the way the pop-up saves it
    expect(db.learned_rules.some((r) => r.pattern === 'code:720' && r.target_value === '3300')).toBe(true);

    importTrialBalance(actor, ENG, lines, 'xero');
    expect(mapping('720')?.blynt_code).toBe('3300');
    expect(mapping('720')?.status).toBe('confirmed');
  });

  it('a plain Confirm on an AI line is remembered for the next pull', () => {
    importTrialBalance(actor, ENG, lines, 'xero');
    const m = mapping('721')!;
    services.confirmSelectedMappings(FIRM, actor, ENG, [m.id]);
    importTrialBalance(actor, ENG, lines, 'xero');
    expect(mapping('721')?.status).toBe('confirmed');
    expect(mapping('721')?.blynt_code).toBe(m.blynt_code);
  });
});

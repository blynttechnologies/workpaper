// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { findRule } from '../lib/server/gate';
import { learnFromConfirmed, learnNightly, mappingExamples } from '../lib/server/learning';

const FIRM = 'firm_blynt_uk';
let eng = { id: '', client_id: '' };
const confirm = (code: string, name: string, blynt: string, at: string, engId = eng.id) =>
  db.account_mappings.push({ id: `m_${code}_${at}`, engagement_id: engId, source_code: code, source_name: name, source_type: 'Expense', balance_p: '100', blynt_code: blynt, status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: 'usr_admin', confirmed_at: at } as any);

beforeEach(() => {
  db.seed(true);
  const e = db.engagements.find((x) => x.firm_id === FIRM && x.status !== 'locked')!;
  eng = { id: e.id, client_id: e.client_id };
  db.learned_rules = [];
  db.account_mappings = [];
  const chart = db.blynt_accounts.filter((a) => a.type !== 'System').slice(0, 2).map((a) => a.code);
  (globalThis as any).CODES = chart;
});

describe('learning from confirmed work', () => {
  it('turns confirmed mappings into client rules, the latest confirmation winning, and says what it did', () => {
    const [a, b] = (globalThis as any).CODES as string[];
    confirm('720', 'Staff lunch', a, '2026-11-01T10:00:00Z');
    confirm('720', 'Staff lunch', b, '2026-11-10T10:00:00Z');
    const out = learnFromConfirmed(FIRM, [eng.id]);
    expect(out).toMatchObject({ rules_added: 1, rules_changed: 0 });
    expect(findRule(FIRM, 'mapping', ['code:720'], { clientId: eng.client_id })?.target_value).toBe(b);
    // Nothing new the second time
    expect(learnFromConfirmed(FIRM, [eng.id])).toMatchObject({ rules_added: 0, rules_changed: 0 });
    expect(db.audit_logs.filter((l) => l.action === 'LEARN_FROM_CONFIRMED')).toHaveLength(2);
  });

  it('runs once a night even though the nightly run fires every ten minutes', () => {
    const [a] = (globalThis as any).CODES as string[];
    confirm('721', 'Staff clothing', a, '2026-11-15T10:00:00Z');
    // From the real clock: each run is stamped in the audit log with the real time, so a fixed date here stops working once it has passed
    const now = Date.now();
    expect(Object.keys(learnNightly(now))).toContain(FIRM);
    expect(Object.keys(learnNightly(now + 600_000))).not.toContain(FIRM);
    expect(Object.keys(learnNightly(now + 24 * 3_600_000))).toContain(FIRM);
  });

  it("gives the AI the firm's confirmed examples, this client's first", () => {
    const [a, b] = (globalThis as any).CODES as string[];
    const other = db.engagements.find((x) => x.firm_id === FIRM && x.client_id !== eng.client_id)!;
    confirm('500', 'Other client fuel', a, '2026-11-14T10:00:00Z', other.id);
    confirm('720', 'Staff lunch', b, '2026-11-01T10:00:00Z');
    const ex = mappingExamples(FIRM, eng.client_id);
    expect(ex[0]).toMatchObject({ client_account: '720 Staff lunch', blynt_code: b, same_client: true });
    expect(ex.some((e) => e.client_account === '500 Other client fuel' && !e.same_client)).toBe(true);
    // Another firm sees none of it
    expect(mappingExamples('firm_other', eng.client_id)).toEqual([]);
  });
});

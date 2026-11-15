// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { services } from '../lib/server/services';
import { saveFirmDefaults } from '../lib/server/client-profile';

const FIRM = 'firm_blynt_uk';
const partner = { id: 'usr_admin', name: 'Sole Partner', role: 'partner' as const, firmId: FIRM };
const manager = { id: 'usr_mgr', name: 'Manager', role: 'manager' as const, firmId: FIRM };
const defaults = (extra: Record<string, unknown> = {}) => ({ tolerance: '1.00', review_threshold: '1000.00', signoff_levels: 2, ...extra });

const ownJournal = () => {
  const eng = db.engagements.find((e) => e.firm_id === FIRM && e.status !== 'locked')!;
  const j = { id: 'aje_own', engagement_id: eng.id, ref: 'AJE-002', narrative: 'Provision', status: 'proposed', proposed_by: partner.id, proposed_by_name: partner.name, approved_by: null, created_at: '2026-11-15T10:00:00Z', lines: [] };
  db.adjustments.push(j as any);
  return j;
};

beforeEach(() => db.seed(true));

describe('approving your own journal', () => {
  it('is refused unless the practice allows it', () => {
    ownJournal();
    expect(() => services.approveAdjustment(FIRM, partner, 'aje_own', 'Sole practitioner, reviewed the figures')).toThrow(/cannot approve their own/);
  });

  it('with the setting on, a partner can, giving a reason that is kept and audited', () => {
    saveFirmDefaults(partner, defaults({ self_approve_journals: true }));
    ownJournal();
    expect(() => services.approveAdjustment(FIRM, partner, 'aje_own', 'short')).toThrow(/at least 10 characters/);
    const j = services.approveAdjustment(FIRM, partner, 'aje_own', 'Sole practitioner; checked against the aged debtors');
    expect(j).toMatchObject({ status: 'approved', approved_by: partner.id, self_approval_reason: 'Sole practitioner; checked against the aged debtors' });
    expect(db.audit_logs.some((a) => a.action === 'SELF_APPROVE_ADJUSTMENT' && a.entity_id === 'aje_own')).toBe(true);
  });

  it('only partners and admins may switch it on, and it never lets a manager approve their own', () => {
    expect(() => saveFirmDefaults(manager, defaults({ self_approve_journals: true }))).toThrow(/partner or admin/);
    saveFirmDefaults(partner, defaults({ self_approve_journals: true }));
    // A manager saving other settings leaves it as it is
    expect(saveFirmDefaults(manager, defaults()).self_approve_journals).toBe(true);
    const j = ownJournal();
    j.proposed_by = manager.id;
    expect(() => services.approveAdjustment(FIRM, manager, 'aje_own', 'I am the only one here today')).toThrow(/cannot approve their own/);
  });
});

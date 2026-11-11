// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { agedDebtorsFromLedger, debtorView, type DebtorLine } from '../lib/workpapers/debtors';

const line = (p: Partial<DebtorLine>): DebtorLine => ({ id: 'l', desc: 'Customer', current_p: '0', d30_p: '0', d60_p: '0', d90_p: '0', after_date_p: '0', ...p });

beforeEach(() => db.seed(true));

describe('trade debtors (REC-07)', () => {
  it('suggests a provision only for old debt that receipts after the period end do not reach', () => {
    // £980 received pays the newer £980 invoice, so the £2,400 over 90 days is still at risk
    expect(debtorView(line({ d60_p: '98000', d90_p: '240000', after_date_p: '98000' })).suggestion).toMatchObject({ kind: 'provide', amount: 240000n });
    // Enough received to reach the old debt too
    expect(debtorView(line({ d60_p: '98000', d90_p: '240000', after_date_p: '338000' })).suggestion).toBeNull();
    // A credit balance belongs in creditors
    expect(debtorView(line({ current_p: '-45000' })).suggestion).toMatchObject({ kind: 'creditors', amount: 45000n });
    // A "no provision" decision needs a reason before it counts as decided
    expect(debtorView(line({ d90_p: '64000', decision: 'no_provision' })).needsDecision).toBe(true);
    expect(debtorView(line({ d90_p: '64000', decision: 'no_provision', reason: 'Paid in May' })).needsDecision).toBe(false);
  });

  it('ages customers from the ledger, clearing the oldest invoices first, and lists receipts after the period end', () => {
    const eng = db.engagements[0];
    const pe = eng.period_end;
    const day = (n: number) => new Date(Date.parse(pe) + n * 86_400_000).toISOString().slice(0, 10);
    db.account_mappings.push({ id: 'm_deb', engagement_id: eng.id, source_code: 'DEB', source_name: 'Debtors', source_type: 'Current Asset', balance_p: '0', blynt_code: '710', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null });
    const tx = (id: string, contact: string, date: string, amount_p: string, description = id) =>
      db.transactions.push({ id, engagement_id: eng.id, account_code: 'DEB', account_name: 'Debtors', date, contact, description, amount_p, vat_p: '0', gross_p: amount_p, source: 'Xero' });
    tx('INV-1', 'Northgate', day(-145), '240000');
    tx('INV-2', 'Northgate', day(-75), '98000');
    tx('INV-0', 'Northgate', day(-200), '10000');
    tx('PAY-0', 'Northgate', day(-150), '-10000'); // paid the oldest invoice before the period end
    tx('PAY-1', 'Northgate', day(9), '-98000');
    tx('PAY-2', 'Kestrel', day(-3), '-45000');

    const r = agedDebtorsFromLedger(eng.id, [line({ id: 'keep', desc: 'Northgate', decision: 'provide', provision_p: '240000' })])!;
    const north = r.lines.find((l) => l.desc === 'Northgate')!;
    expect(north).toMatchObject({ id: 'keep', d90_p: '240000', d60_p: '98000', after_date_p: '98000', decision: 'provide', oldest_days: 145 });
    expect(north.invoices!.map((i) => i.ref)).toEqual(['INV-1', 'INV-2']);
    expect(north.receipts).toHaveLength(1);
    expect(r.lines.find((l) => l.desc === 'Kestrel')).toMatchObject({ current_p: '-45000', after_date_p: '0' });
    expect(r.receiptsKnown).toBe(true);
  });

  it('builds the journal from the decisions and checks it was sent', () => {
    const wp = db.addWorkpaper(db.engagements[0].id, 'C-10')!;
    wp.data_json = {
      ...wp.data_json,
      lines: [line({ id: 'a', desc: 'Northgate', d90_p: '240000', decision: 'provide', provision_p: '240000' }), line({ id: 'b', desc: 'Kestrel', current_p: '-45000', decision: 'creditors' })],
    };
    let r = evaluatePaper(wp)!;
    expect(r.totals.provision).toBe(240000n);
    expect(r.totals.moved).toBe(45000n);
    expect(r.checks.find((c) => c.id === 'journal_sent')!.passed).toBe(false);
    wp.data_json.journal = { id: 'j', ref: 'AJE-009', provision_p: r.totals.movement.toString(), creditors_p: '45000' };
    r = evaluatePaper(wp)!;
    expect(r.checks.find((c) => c.id === 'journal_sent')!.passed).toBe(true);
    // Changing a decision afterwards reopens the check
    wp.data_json.lines[1].decision = 'no_provision';
    expect(evaluatePaper(wp)!.checks.find((c) => c.id === 'journal_sent')!.passed).toBe(false);
  });
});

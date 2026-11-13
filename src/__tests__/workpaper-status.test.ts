// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { evaluatePaper, linkedFiles, paperStatus, reconAccounts } from '../lib/workpapers/engine';
import { services } from '../lib/server/services';
import { blankPaperData, templateFor } from '../lib/workpapers/templates';

// A bank paper on an engagement with a mapped trial balance
const bankPaper = () => {
  const wp = db.workpapers.find((w) => w.ref === 'B-10' && evaluatePaper(w)?.totals.ledger)!;
  wp.status = 'in_progress';
  wp.data_json = blankPaperData(templateFor('B-10')!);
  return wp;
};
const firmOf = (wp: { engagement_id: string }) => db.firms.find((f) => f.id === db.engagements.find((e) => e.id === wp.engagement_id)!.firm_id)!;

beforeEach(() => db.seed(true));

describe('status engine (WPS-04)', () => {
  it('a blank schedule is Not started and shows its TB balance and difference', () => {
    const wp = bankPaper();
    const r = evaluatePaper(wp)!;
    expect(r.totals.ledger).not.toBe(0n);
    expect(r.totals.difference).toBe(-r.totals.ledger);
    expect(paperStatus(wp)).toBe('not_started');
  });

  it('turns Unreconciled when work starts, and Reconciled once the difference clears', () => {
    const wp = bankPaper();
    const ledger = evaluatePaper(wp)!.totals.ledger;
    wp.data_json.statement_p = (ledger - 500n).toString(); // £5 out
    expect(paperStatus(wp)).toBe('unreconciled');
    wp.data_json.statement_p = ledger.toString();
    expect(paperStatus(wp)).toBe('reconciled');
  });

  it('uses the practice tolerance from settings (default £1)', () => {
    const wp = bankPaper();
    const ledger = evaluatePaper(wp)!.totals.ledger;
    wp.data_json.statement_p = (ledger - 80n).toString(); // 80p out
    expect(paperStatus(wp)).toBe('reconciled');
    const firm = firmOf(wp);
    firm.settings = { ...firm.settings, defaults: { tolerance_p: '50', review_threshold_p: '50000', signoff_levels: 2 } };
    expect(paperStatus(wp)).toBe('unreconciled');
  });

  it('bank and cash: one row per TB account, each reconciled on its own', () => {
    const wp = bankPaper();
    const r = evaluatePaper(wp)!;
    const accounts = reconAccounts(wp.data_json, r.leads);
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.code !== '*' && a.statement_p === '')).toBe(true);
    // Every account agrees: reconciled
    wp.data_json = { ...wp.data_json, accounts: accounts.map((a) => ({ ...a, statement_p: r.totals[`${a.id}_ledger`].toString() })) };
    expect(paperStatus(wp)).toBe('reconciled');
    expect(evaluatePaper(wp)!.checks.find((c) => c.id === 'differences')!.passed).toBe(true);
    // Two accounts out by opposite amounts never cancel each other out
    const two = [...wp.data_json.accounts, { id: 'x', code: '6490', name: 'Other', statement_p: '1000', less: [], add: [] }];
    two[0] = { ...two[0], statement_p: (BigInt(two[0].statement_p) - 1000n).toString() };
    wp.data_json = { ...wp.data_json, accounts: two };
    const out = evaluatePaper(wp)!;
    expect(out.totals.difference).toBe(0n);
    expect(out.totals.unexplained).toBe(2000n);
    expect(paperStatus(wp)).toBe('unreconciled');
  });

  it('bank and cash: a paper saved with one statement keeps it as a single row covering every account', () => {
    const wp = bankPaper();
    wp.data_json.statement_p = '1';
    const accounts = reconAccounts(wp.data_json, evaluatePaper(wp)!.leads);
    expect(accounts).toEqual([expect.objectContaining({ id: 'statement', code: '*', statement_p: '1' })]);
  });

  it('bank and cash: an old deposit in transit folds into the one list as a minus, totals unchanged', () => {
    const wp = bankPaper();
    const [a] = reconAccounts(wp.data_json, evaluatePaper(wp)!.leads);
    wp.data_json = { ...wp.data_json, accounts: [{ ...a, statement_p: '10000', less: [{ id: 'p', amount_p: '3000' }], add: [{ id: 'd', amount_p: '1000' }] }] };
    const [folded] = reconAccounts(wp.data_json, []);
    expect(folded.add).toEqual([]);
    expect(folded.less.map((r) => r.amount_p)).toEqual(['3000', '-1000']);
    expect(evaluatePaper(wp)!.totals[`${a.id}_adjusted`]).toBe(8000n); // 10000 - 3000 + 1000
  });

  it('never overrides a sign-off status', () => {
    const wp = bankPaper();
    wp.status = 'prepared';
    wp.data_json.statement_p = '1';
    expect(paperStatus(wp)).toBe('prepared');
  });
});

describe('attachments: archive and delete', () => {
  it('an archived or deleted file stops counting as evidence; restoring brings it back', () => {
    const wp = bankPaper();
    const admin = { id: 'usr_admin', name: 'Admin', role: 'admin' as const };
    const att = { id: 'att_t', engagement_id: wp.engagement_id, workpaper_id: wp.id, file_key: 'k', filename: 's.pdf', mime: 'application/pdf', size: 1, sha256: 'x', category: 'Statement' as const, is_permanent: false, uploaded_by: 'usr_admin', uploaded_by_name: 'Admin', uploaded_at: '2026-11-13T00:00:00Z', links: [{ attachment_id: 'att_t', anchor_json: { kind: 'row', table: 'schedule', row: 'acc_6000' } }] };
    db.attachments.push(att as any);
    expect(linkedFiles(wp.id, 'acc_6000').map((a) => a.id)).toEqual(['att_t']);
    services.archiveAttachment('firm_blynt_uk', admin, 'att_t', true);
    expect(linkedFiles(wp.id, 'acc_6000')).toEqual([]);
    services.archiveAttachment('firm_blynt_uk', admin, 'att_t', false);
    expect(linkedFiles(wp.id, 'acc_6000').map((a) => a.id)).toEqual(['att_t']);
    services.deleteAttachment('firm_blynt_uk', admin, 'att_t');
    expect(linkedFiles(wp.id, 'acc_6000')).toEqual([]);
    expect(() => services.archiveAttachment('firm_blynt_uk', admin, 'att_t', true)).toThrow(/not found/);
  });
});

describe('statement read by AI', () => {
  it('fills a blank balance with its date, keeps the other balances to choose from, and never overwrites a typed figure', () => {
    const wp = bankPaper();
    const admin = { id: 'usr_admin', name: 'Admin', role: 'admin' as const };
    const [acc] = reconAccounts(wp.data_json, evaluatePaper(wp)!.leads);
    wp.data_json = { ...wp.data_json, accounts: [{ ...acc, statement_p: '' }] };
    const read = {
      statement_date: { value: '2026-03-31', confidence: 95, page: 2, gate: 'ready', reason: 'r' },
      statement_balance_p: { value: '8135000', confidence: 95, page: 2, gate: 'ready', reason: 'r' },
      candidates: [{ date: '2026-03-28', balance_p: '8000000', label: 'Last balance before the year end', page: 2 }],
    };
    const mk = (id: string) => db.attachments.push({ id, engagement_id: wp.engagement_id, workpaper_id: wp.id, file_key: id, filename: `${id}.pdf`, mime: 'application/pdf', size: 1, sha256: id, category: 'Statement', is_permanent: false, uploaded_by: 'usr_admin', uploaded_by_name: 'Admin', uploaded_at: '2026-11-13T00:00:00Z', extracted_data: read } as any);
    mk('att_r1');
    services.fillScheduleFromDocument('firm_blynt_uk', admin, 'att_r1', wp.id, acc.id);
    const filled = db.workpapers.find((w) => w.id === wp.id)!.data_json.accounts[0];
    expect(filled).toMatchObject({ statement_p: '8135000', statement_date: '2026-03-31', source: 'upload' });
    expect(filled.ai_balances.map((b: any) => b.balance_p)).toEqual(['8135000', '8000000']);

    // A figure someone typed stays; the read is only offered
    db.workpapers.find((w) => w.id === wp.id)!.data_json.accounts[0] = { ...filled, statement_p: '100', source: 'manual', ai_balances: undefined };
    mk('att_r2');
    services.fillScheduleFromDocument('firm_blynt_uk', admin, 'att_r2', wp.id, acc.id);
    const kept = db.workpapers.find((w) => w.id === wp.id)!.data_json.accounts[0];
    expect(kept.statement_p).toBe('100');
    expect(kept.ai_balances).toHaveLength(2);
  });
});

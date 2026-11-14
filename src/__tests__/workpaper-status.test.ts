// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { accountName, evaluatePaper, linkedFiles, paperStatus, reconAccounts, rowCode } from '../lib/workpapers/engine';
import { newAccount } from '../lib/coa';
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
    const accounts = reconAccounts(wp.data_json, r.leads, wp.engagement_id);
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

  it('bank and cash: two bank accounts mapped to one code are reconciled as two rows that still add up to the TB', () => {
    const wp = bankPaper();
    const e = wp.engagement_id;
    for (let i = db.account_mappings.length - 1; i >= 0; i--) if (db.account_mappings[i].engagement_id === e && db.account_mappings[i].blynt_code === '6000') db.account_mappings.splice(i, 1);
    const add = (source_code: string, source_name: string, balance_p: string) =>
      db.account_mappings.push({ id: `m_${source_code}`, engagement_id: e, source_code, source_name, source_type: 'Bank', balance_p, blynt_code: '6000', status: 'confirmed', confidence: 100, method: 'manual' } as any);
    add('ACC-BELGRAVE', 'Belgrave', '555450');
    add('ACC-PATCHAM', 'Patcham', '1954927');
    const r = evaluatePaper(wp)!;
    const rows = reconAccounts(wp.data_json, r.leads, e).filter((a) => a.code === '6000');
    expect(rows.map((a) => [a.client_code, a.name])).toEqual([['ACC-BELGRAVE', 'Belgrave'], ['ACC-PATCHAM', 'Patcham']]);
    const lead6000 = r.leads.find((l) => l.code === '6000')!.final;
    const ledgers = rows.map((a) => r.totals[`${a.id}_ledger`]);
    expect(ledgers[1]).toBe(1954927n);
    expect(ledgers[0] + ledgers[1]).toBe(lead6000); // the first also carries any journals on 6000
    expect(r.totals.ledger).toBe(r.leads.reduce((a, l) => a + l.final, 0n));
    // A practice account made to work like 6000 is reconciled under 6000 but shows its own code
    const own = newAccount(db.blynt_accounts, '6011', 'Patcham bank a/c', 'f1', '6000');
    if (typeof own === 'string') throw new Error(own);
    db.blynt_accounts.push(own);
    db.account_mappings.find((m) => m.source_code === 'ACC-PATCHAM')!.blynt_code = '6011';
    const patcham = reconAccounts(wp.data_json, evaluatePaper(wp)!.leads, e).find((a) => a.client_code === 'ACC-PATCHAM')!;
    expect([patcham.code, rowCode(patcham, e), accountName(patcham, e)]).toEqual(['6000', '6011', '6011 Patcham']);
    db.blynt_accounts.splice(db.blynt_accounts.indexOf(own), 1);
    // One card on its own code still gets its own named row
    for (let i = db.account_mappings.length - 1; i >= 0; i--) if (db.account_mappings[i].engagement_id === e && db.account_mappings[i].blynt_code === '6300') db.account_mappings.splice(i, 1);
    db.account_mappings.push({ id: 'm_card', engagement_id: e, source_code: 'ACC-SRICOMME', source_name: 'Sri - Commercial Card', source_type: 'Bank', balance_p: '-22844', blynt_code: '6300', status: 'confirmed', confidence: 100, method: 'manual' } as any);
    const card = reconAccounts(wp.data_json, evaluatePaper(wp)!.leads, e).filter((a) => a.code === '6300');
    expect(card).toEqual([expect.objectContaining({ client_code: 'ACC-SRICOMME', name: 'Sri - Commercial Card' })]);
  });

  it('bank and cash: an account confirmed after the rows were saved gets a row, even at nil; one removed stays removed', () => {
    const wp = bankPaper();
    const e = wp.engagement_id;
    for (let i = db.account_mappings.length - 1; i >= 0; i--) if (db.account_mappings[i].engagement_id === e && db.account_mappings[i].blynt_code === '6000') db.account_mappings.splice(i, 1);
    const add = (source_code: string, source_name: string, balance_p: string) =>
      db.account_mappings.push({ id: `m_${source_code}`, engagement_id: e, source_code, source_name, source_type: 'Bank', balance_p, blynt_code: '6000', status: 'confirmed', confidence: 100, method: 'manual' } as any);
    add('901', 'Main Current Account', '3041997');
    const leads = () => evaluatePaper(wp)!.leads;
    // Rows saved while only 901 was confirmed
    wp.data_json = { ...wp.data_json, accounts: reconAccounts(wp.data_json, leads(), e).map((a) => (a.client_code === '901' ? { ...a, statement_p: '3041997' } : a)) };
    add('902', 'Account 2 - Hailsham', '0');
    add('904', 'Account 4 - Brighton', '0');
    const rows = reconAccounts(wp.data_json, leads(), e).filter((a) => a.code === '6000');
    expect(rows.map((a) => [a.client_code, a.statement_p])).toEqual([['901', '3041997'], ['902', ''], ['904', '']]);
    // What was entered on the saved row is kept, and the rows still add up to the TB
    const r = evaluatePaper(wp)!;
    expect(r.totals.ledger).toBe(r.leads.reduce((acc, l) => acc + l.final, 0n));
    // Removed: remembered, not added back
    wp.data_json = { ...wp.data_json, dismissed_accounts: ['6000|904'] };
    expect(reconAccounts(wp.data_json, leads(), e).filter((a) => a.code === '6000').map((a) => a.client_code)).toEqual(['901', '902']);
  });

  it('bank and cash: a bank account nil this year (last year only) is mapped and shows on the paper; a nil expense is not', () => {
    const wp = bankPaper();
    const e = wp.engagement_id;
    const firm = db.engagements.find((x) => x.id === e)!.firm_id;
    const snap = db.tb_snapshots.filter((s) => s.engagement_id === e).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const line = (source_code: string, source_name: string, source_type: string) =>
      db.tb_lines.push({ id: `tbl_${source_code}`, snapshot_id: snap.id, source_code, source_name, source_type, debit_p: '0', credit_p: '0', comparative_p: '9245' } as any);
    line('902', 'Account 2 - Hailsham - South East', 'Bank');
    line('X77', 'Old office rent', 'Expense');
    expect(services.addNilCashMappings(firm, e)).toBe(1);
    expect(services.addNilCashMappings(firm, e)).toBe(0); // once only
    const m = db.account_mappings.find((x) => x.engagement_id === e && x.source_code === '902')!;
    expect(Number(m.blynt_code)).toBeGreaterThanOrEqual(6000);
    expect(db.account_mappings.some((x) => x.engagement_id === e && x.source_code === 'X77')).toBe(false);
    // Not confirmed yet, but on the paper as its own nil row
    const row = reconAccounts(wp.data_json, evaluatePaper(wp)!.leads, e).find((a) => a.client_code === '902');
    expect(row).toMatchObject({ name: 'Account 2 - Hailsham - South East', statement_p: '' });
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

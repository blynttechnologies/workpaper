import { describe, it, expect } from 'vitest';
import { OWNER_ACCOUNTS, STANDARD_CHART, V2_TO_V3 } from '@/lib/standard-chart';
import { db } from '@/lib/server/db';
import { TEMPLATES } from '@/lib/workpapers/templates';
import { matchBlyntAccount } from '@/lib/mapping/auto-mapper';
import { migrateCodes } from '@/lib/coa-migration';
import { inLead, papersForCode } from '@/lib/workpapers/common';
import { newAccount } from '@/lib/coa';

describe('Blynt standard chart (four-digit, v3)', () => {
  it('has the 302 accounts from the v3 chart, unique four-digit codes, and seeds the database', () => {
    expect(STANDARD_CHART).toHaveLength(302);
    expect(new Set(STANDARD_CHART.map((a) => a.code)).size).toBe(302);
    for (const a of STANDARD_CHART) {
      expect(a.code).toMatch(/^[1-9]\d{3}$/);
      expect(['Debit', 'Credit', 'Mixed']).toContain(a.normal_balance);
      expect(a.schedule_ref).toMatch(/^REC-\d\d$/);
      // Every profit and loss account carries a tax treatment; balance sheet accounts never do
      expect(Boolean(a.tax_treatment), a.code).toBe(Number(a.code) < 6000);
    }
    expect(db.blynt_accounts.length).toBeGreaterThanOrEqual(302);
  });

  it('gives every v2 account and owner account a v3 code that exists', () => {
    expect(Object.keys(V2_TO_V3)).toHaveLength(104); // 96 v2 accounts and 8 owner accounts
    const v3 = new Set([...STANDARD_CHART, ...OWNER_ACCOUNTS].map((a) => a.code));
    for (const [v2, code] of Object.entries(V2_TO_V3)) expect(v3.has(code), `${v2} -> ${code}`).toBe(true);
    expect(new Set(Object.values(V2_TO_V3)).size).toBe(104);
  });

  it('converts a saved v2 workspace to v3 codes, leaving client codes and finished data alone', () => {
    const saved = {
      blynt_accounts: [{ code: '421', name: 'Window cleaning', is_system: false }],
      account_mappings: [{ source_code: '600', blynt_code: '600' }, { source_code: 'CLN', blynt_code: '421' }],
      adjustments: [{ lines: [{ blynt_code: '492', debit_p: '500' }] }],
      workpapers: [{ data_json: { accounts: [{ id: 'acc_610', code: '610', statement_p: '100' }], comments: { '482': 'One-off' }, tx_decisions: { t1: { decision: 'remove', to: '493' } } } }],
      templates: [{ lead: ['660', '661'] }],
      learned_rules: [{ type: 'mapping', target_value: '210' }, { type: 'extraction', target_value: '999' }],
      transactions: [{ account_code: '600' }],
      audit_logs: [{ after_json: '{"blynt_code":"600"}' }],
    } as any;
    const out = migrateCodes(JSON.parse(JSON.stringify(saved))) as any;
    expect(out.blynt_accounts[0].code).toBe('4211'); // 4210 is Equipment hire in v3
    expect(out.account_mappings).toEqual([{ source_code: '600', blynt_code: '6000' }, { source_code: 'CLN', blynt_code: '4211' }]);
    expect(out.adjustments[0].lines[0]).toEqual({ blynt_code: '4920', debit_p: '500' });
    expect(out.workpapers[0].data_json).toEqual({ accounts: [{ id: 'acc_6100', code: '6100', statement_p: '100' }], comments: { '4820': 'One-off' }, tx_decisions: { t1: { decision: 'remove', to: '4930' } } });
    expect(out.templates[0].lead).toEqual(['6600', '6610']);
    expect(out.learned_rules.map((r: any) => r.target_value)).toEqual(['2100', '999']);
    expect(out.transactions).toEqual(saved.transactions);
    expect(out.audit_logs).toEqual(saved.audit_logs);
    // Running it again changes nothing
    expect(migrateCodes(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });

  it('every account code a working paper template refers to exists (or is a prefix of one)', () => {
    for (const t of Object.values(TEMPLATES) as any[]) {
      for (const l of t.leads ?? []) {
        expect(STANDARD_CHART.some((a) => a.code.startsWith(l.code)), `${t.ref} lead ${l.code}`).toBe(true);
      }
    }
  });

  it('every standard account lands on a schedule paper, once per paper', () => {
    // Finance income, finance costs and tax charges (5xxx) are reviewed on Z-30 and read by code on the tax and loans papers
    const missing = STANDARD_CHART.filter((a) => !a.code.startsWith('5') && papersForCode(a.code).length === 0).map((a) => `${a.code} ${a.name}`);
    expect(missing).toEqual([]);
    for (const t of TEMPLATES) for (const a of STANDARD_CHART) expect(t.leads.filter((l) => inLead(a.code, l.code)).length, `${t.ref} ${a.code}`).toBeLessThanOrEqual(1);
  });

  it('a practice account goes where the standard account it was created beside goes', () => {
    const acc = newAccount(db.blynt_accounts, '6311', 'Siva commercial card', 'f1', '6300');
    if (typeof acc === 'string') throw new Error(acc);
    db.blynt_accounts.push(acc);
    try {
      expect(papersForCode('6311').map((t) => t.ref)).toEqual(['B-10']);
      expect(inLead('6311', '6300')).toBe(true);
    } finally {
      db.blynt_accounts.splice(db.blynt_accounts.indexOf(acc), 1);
    }
  });

  it('maps typical Xero / QuickBooks account names to the new codes', () => {
    const code = (n: string, t = '') => matchBlyntAccount(n, t, '')!.blynt_code;
    expect(code('Business Bank Account', 'Bank')).toBe('6000');
    expect(code('Accounts Receivable', 'Current Asset')).toBe('7100');
    expect(code('Accounts Payable', 'Current Liability')).toBe('7500');
    expect(code('VAT')).toBe('7800');
    expect(code('Sales', 'Revenue')).toBe('1000');
    expect(code('Insurance', 'Expense')).toBe('4700');
    expect(code('Depreciation Expense', 'Expense')).toBe('4920');
  });

  it('uses the accounts v3 added when the ledger names them', () => {
    const code = (n: string, t = '') => matchBlyntAccount(n, t, '')!.blynt_code;
    expect(code('Audit Fees', 'Expense')).toBe('4830');
    expect(code('Client Entertaining', 'Expense')).toBe('4420');
    expect(code("Directors' Remuneration", 'Expense')).toBe('3050');
    expect(code('Deferred Income', 'Current Liability')).toBe('7610'); // not the after-one-year account
    expect(code('Goodwill', 'Fixed Asset')).toBe('6970');
    expect(code('CIS Deductions', 'Current Liability')).toBe('7820');
    expect(code('Dividends', 'Equity')).toBe('8910');
    // A name that fits only by keyword still has to be the right kind of account
    expect(code('Overdraft', 'Expense')).not.toBe('6050');
  });
});

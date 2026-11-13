import { describe, it, expect } from 'vitest';
import { newAccount, nextCode, categoryOf, CATEGORIES, newAccountBase, similarAccounts, accountsForClient } from '@/lib/coa';
import { matchBlyntAccount, getStatutoryDetails } from '@/lib/mapping/auto-mapper';
import { db } from '@/lib/server/db';
import { OWNER_ACCOUNTS, STANDARD_CHART } from '@/lib/standard-chart';
import { mergeFirmState, firmSlice, GuardError, State } from '@/lib/server/state-guard';

const chart = STANDARD_CHART.map((a) => ({ ...a }));

describe('practice accounts in the chart', () => {
  it('stay inside their section and inherit it', () => {
    // Every "Other" account sits in its own category
    for (const c of CATEGORIES) expect(categoryOf(c.other)).toBe(c);
    const revenue = categoryOf('1000')!;
    expect(nextCode(chart, revenue)).toBe('1401'); // next after the Other account 1400
    expect(nextCode(chart, revenue, '1000')).toBe('1001');
    const acc = newAccount(chart, '1005', 'Online sales', 'f1', '1000');
    expect(acc).toMatchObject({ code: '1005', type: 'Revenue', lead_letter: 'A', firm_id: 'f1', parent_code: '1000', is_system: false });
    expect(newAccount(chart, '1500', 'Misc income', 'f1')).toMatchObject({ parent_code: '1400' });
    expect(newAccount(chart, '2055', 'Wrong range', 'f1', '1000')).toMatch(/within 1000–1999/);
    expect(newAccount(chart, '9550', 'System', 'f1')).toMatch(/outside/);
    expect(newAccount(chart, '105', 'Old three-digit code', 'f1')).toMatch(/outside/);
    expect(newAccount(chart, '1100', 'Dup', 'f1')).toMatch(/already/);
    expect(newAccount(chart, 'abc', 'x', 'f1')).toMatch(/number/);
  });

  it('recommends a code for an expense the chart lacks, skips used codes and spots duplicates', () => {
    const rec = (name: string, codes = chart) => {
      const base = newAccountBase(name)!;
      return nextCode(codes, categoryOf(base)!, base);
    };
    const with4041 = [...chart, { ...chart[0], code: '4041', name: 'Window cleaning' }];
    const with3321 = [...chart, { ...chart[0], code: '3321', name: 'Entertainment - 100% business' }];
    expect(rec('Cleaning & Waste Removal')).toBe('4041'); // beside 4040 Cleaning and waste
    expect(rec('Cleaning', with4041)).toBe('4042');
    expect(rec('Entertainment-100% business')).toBe('3321'); // beside 3320 Staff welfare and staff entertaining
    expect(rec('Entertainment - client', with3321)).toBe('3322');
    expect(newAccount(chart, '4200', 'Dup', 'f1')).toMatch(/Next free: 4201/);
    expect(similarAccounts(with4041, 'Window cleaning')[0].code).toBe('4041');
    expect(similarAccounts(chart, 'Cleaning')[0].code).toBe('4040'); // v3 has the account, so it is offered first
  });

  it('shows each client the chart for its business type and its own accounts, leaving the blueprint alone', () => {
    const own = newAccount(chart, '3321', 'Entertainment', 'f1', '3300', 'ems') as (typeof chart)[number];
    const all = [...chart, ...OWNER_ACCOUNTS, own];
    const codes = (id: string, company_type: string) => accountsForClient(all, { id, company_type }).map((a) => a.code);

    const sole = codes('ems', 'Sole trader');
    expect(sole).toEqual(expect.arrayContaining(['8520', '8525', '3321', '1000']));
    expect(sole).not.toContain('8500');
    expect(sole).not.toContain('7950');
    expect(sole).not.toContain('8530');

    const ltd = codes('other', 'Small company (FRS 102 1A)');
    expect(ltd).toEqual(expect.arrayContaining(['8500', '7950']));
    expect(ltd).not.toContain('8520');
    expect(ltd).not.toContain('3321'); // another client's account
    expect(codes('x', 'Partnership')).toContain('8540');
    expect(codes('x', 'LLP (FRS 102 + LLP SORP)')).toContain('8560');
    expect(accountsForClient(all)).toHaveLength(all.length); // the library still shows everything
    expect(STANDARD_CHART).toHaveLength(302);
  });

  it('maps owner accounts by business type only', () => {
    expect(matchBlyntAccount('Owner A Drawings', 'Equity', '8800', 'sole')!.blynt_code).toBe('8525');
    expect(matchBlyntAccount('Owner A Funds Introduced', 'Equity', '881', 'sole')!.blynt_code).toBe('8520');
    expect(matchBlyntAccount('Partners Current Account', 'Equity', '', 'partnership')!.blynt_code).toBe('8535');
    expect(matchBlyntAccount('Drawings', 'Equity', '', 'ltd')!.blynt_code).toBe('8900');
    expect(getStatutoryDetails('8525').is_credit_area).toBe(false);
  });

  it('adds owner accounts on load without replacing a practice account on the same code', () => {
    const mine = { ...chart[0], code: '8520', name: 'My account', is_system: false, firm_id: 'f1' };
    db.importState({ blynt_accounts: [mine] });
    expect(db.blynt_accounts.filter((a) => a.code === '8520').map((a) => a.name)).toEqual(['My account']);
    expect(db.blynt_accounts.some((a) => a.code === '8525')).toBe(true);
    db.importState({ blynt_accounts: [] });
  });

  it('the server keeps a firm\'s new account to that firm and refuses a bad one', () => {
    const full: State = { firms: [{ id: 'f1' }, { id: 'f2' }], memberships: [{ firm_id: 'f1', user_id: 'u1', role: 'admin' }], users: [{ id: 'u1' }], blynt_accounts: chart };
    const actor = { id: 'u1', name: 'A', role: 'admin' as const, firmId: 'f1' };
    const v = JSON.parse(JSON.stringify(firmSlice(full, 'f1', 'u1')));
    v.blynt_accounts.push({ code: '1005', name: 'Online sales', type: 'Equity', firm_id: 'f2' });
    const out = mergeFirmState(full, v, actor);
    expect(out.blynt_accounts.find((a) => a.code === '1005')).toMatchObject({ firm_id: 'f1', type: 'Revenue' });
    expect(firmSlice(out, 'f2').blynt_accounts.some((a) => a.code === '1005')).toBe(false);
    const bad = JSON.parse(JSON.stringify(firmSlice(full, 'f1', 'u1')));
    bad.blynt_accounts.push({ code: 'zz', name: 'x' });
    expect(() => mergeFirmState(full, bad, actor)).toThrow(GuardError);
    const foreign = JSON.parse(JSON.stringify(firmSlice(full, 'f1', 'u1')));
    foreign.blynt_accounts.push({ code: '1005', name: 'Online sales', client_id: 'someone_elses' });
    expect(() => mergeFirmState(full, foreign, actor)).toThrow(GuardError);
  });
});

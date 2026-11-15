// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, freshWrite: async (f: () => unknown) => f(), currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { BUILT_IN_TAX, FLAT_RATE_CATEGORIES, inForce, inPeriod, vatFactsFor } from '../lib/tax';
import { addTaxEntry, removeTaxEntry } from '../lib/server/tax-library';

const FIRM = 'firm_blynt_uk';
const manager = { id: 'usr_admin', name: 'Dev Admin', role: 'admin' as const, firmId: FIRM };
const preparer = { id: 'usr_test_preparer', name: 'Prep', role: 'preparer' as const, firmId: FIRM };

beforeEach(() => db.seed(true));

describe('the VAT library', () => {
  it('looks a rate or limit up for a date, not today', () => {
    expect(inForce('vat.rate.standard', '2010-06-30')?.value).toBe(17.5);
    expect(inForce('vat.rate.standard', '2026-03-31')?.value).toBe(20);
    expect(inForce('vat.threshold.registration', '2024-03-31')?.value).toBe(85000);
    expect(inForce('vat.threshold.registration', '2024-04-01')?.value).toBe(90000);
    // Hospitality relief: catering was 4.5% between July 2020 and September 2021
    expect(inForce('vat.frs.catering', '2021-03-31')?.value).toBe(4.5);
    expect(inForce('vat.frs.catering', '2023-03-31')?.value).toBe(12.5);
    expect(inPeriod('vat.frs.pubs', '2021-04-01', '2022-03-31').map((t) => t.value)).toEqual([1, 4]);
  });

  it('every entry has a source, and each flat rate business type has a rate today', () => {
    expect(BUILT_IN_TAX.every((t) => t.source)).toBe(true);
    expect(FLAT_RATE_CATEGORIES.length).toBeGreaterThan(50);
    for (const c of FLAT_RATE_CATEGORIES) expect(inForce(`vat.frs.${c.key}`, '2026-11-15')).toBeTruthy();
  });

  it("a practice's own dated entry wins for its dates; only managers add or remove one", () => {
    expect(() => addTaxEntry(preparer, { key: 'vat.threshold.registration', value: 95000, from: '2027-04-01', source: 'Budget' })).toThrow(/manager/);
    const e = addTaxEntry(manager, { key: 'vat.threshold.registration', value: 95000, from: '2027-04-01', source: 'Spring Budget 2027' });
    expect(inForce('vat.threshold.registration', '2027-04-01', FIRM)?.value).toBe(95000);
    expect(inForce('vat.threshold.registration', '2027-03-31', FIRM)?.value).toBe(90000);
    // Another practice is not affected
    expect(inForce('vat.threshold.registration', '2027-04-01', 'firm_other')?.value).toBe(90000);
    expect(() => addTaxEntry(manager, { key: 'vat.rate.standard', value: 120, from: '2027-01-01', source: 'x' })).toThrow(/0 to 100/);
    expect(() => addTaxEntry(manager, { key: 'vat.rate.standard', value: 21, from: '2027-01-01', source: '' })).toThrow(/source/);
    removeTaxEntry(manager, e.id);
    expect(inForce('vat.threshold.registration', '2027-04-01', FIRM)?.value).toBe(90000);
  });
});

describe('the VAT position of a client year', () => {
  const setup = (client: Record<string, unknown>, revenue_p: string) => {
    const eng = db.engagements.find((e) => e.firm_id === FIRM)!;
    Object.assign(db.clients.find((c) => c.id === eng.client_id)!, client);
    db.account_mappings = [{ id: 'm1', engagement_id: eng.id, source_code: '200', source_name: 'Sales', source_type: 'Revenue', balance_p: `-${revenue_p}`, blynt_code: '1000', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any];
    return eng;
  };

  it('gives the flat rate in force, with the first-year discount, and warns when turnover passes the leaving limit', () => {
    const eng = setup({ vat_registered: true, vat_scheme: 'flat_rate', vat_flat_rate_category: 'accountancy', vat_registered_on: `${eng0().period_end.slice(0, 8)}01` }, '20000000'); // registered in the period's last month
    const v = vatFactsFor(eng.id)!;
    expect(v.flat_rate).toMatchObject({ category: 'accountancy', percent: 13.5, first_year_discount: true });
    // £200,000 plus 20% VAT is over £230,000
    expect(v.warnings.join(' ')).toMatch(/leaving limit \(£230,000\)/);
    expect(v.rates.standard).toBe(20);
  });

  it('asks for the business type when none is set, and flags turnover over the registration threshold when not registered', () => {
    let eng = setup({ vat_registered: true, vat_scheme: 'flat_rate', vat_flat_rate_category: undefined }, '1000000');
    expect(vatFactsFor(eng.id)!.warnings.join(' ')).toMatch(/no business category/);
    eng = setup({ vat_registered: false, vat_scheme: undefined }, '12000000');
    expect(vatFactsFor(eng.id)!.warnings.join(' ')).toMatch(/registration threshold/);
  });
});

function eng0() {
  return db.engagements.find((e) => e.firm_id === FIRM)!;
}

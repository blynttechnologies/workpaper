// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { paperContext } from '../lib/workpapers/engine';
import { dlaReview } from '../lib/workpapers/dla';
import { fromLedger } from '../lib/workpapers/fixed-assets';
import { equityReview } from '../lib/workpapers/equity';
import { reservesReview } from '../lib/workpapers/reserves';
import { mergeOfficers } from '../lib/workpapers/statutory';
import { fromCompaniesHouse } from '../lib/server/companies-house';

beforeEach(() => db.seed(true));

const eng = () => db.engagements[0];
/** Replace the engagement's accounts mapped under these chart prefixes with the ones given. */
function accounts(prefixes: string[], rows: { code: string; name: string; blynt: string; balance: string }[]) {
  const e = eng();
  for (let i = db.account_mappings.length - 1; i >= 0; i--) {
    const m = db.account_mappings[i];
    if (m.engagement_id === e.id && prefixes.some((p) => m.blynt_code?.startsWith(p))) db.account_mappings.splice(i, 1);
  }
  for (const r of rows) db.account_mappings.push({ id: `m_${r.code}`, engagement_id: e.id, source_code: r.code, source_name: r.name, source_type: '', balance_p: r.balance, blynt_code: r.blynt, status: 'confirmed', confidence: 100, method: 'manual' } as any);
}
const post = (id: string, account_code: string, date: string, amount_p: string, contact = '', description = id) =>
  db.transactions.push({ id, engagement_id: eng().id, account_code, account_name: account_code, date, contact, description, amount_p, vat_p: '0', gross_p: amount_p, source: 'Xero' } as any);
const mid = () => {
  const e = eng();
  return new Date((Date.parse(e.period_start) + Date.parse(e.period_end)) / 2).toISOString().slice(0, 10);
};

describe("director's loan per director", () => {
  it('gives each director their own account when the ledger has one each', () => {
    accounts(['7400', '7980'], [
      { code: 'DLA1', name: "Director's loan - Sri Perera", blynt: '7400', balance: '-100000' },
      { code: 'DLA2', name: "Director's loan - Chand", blynt: '7400', balance: '300000' },
    ]);
    post('t1', 'DLA1', mid(), '-50000');
    post('t2', 'DLA2', mid(), '200000', '', 'Transfer to director');
    const wp = db.addWorkpaper(eng().id, 'D-20')!;
    wp.data_json = { ...wp.data_json, directors: [{ id: 'd1', name: 'Sri Perera' }, { id: 'd2', name: 'Chand Silva' }] };
    const ctx = paperContext(wp);
    expect(dlaReview(ctx, 'd1')).toMatchObject({ opening: -50000n, closing: -100000n });
    expect(dlaReview(ctx, 'd2')).toMatchObject({ opening: 100000n, closing: 300000n });
    expect(dlaReview(ctx).closing).toBe(200000n);
  });

  it('splits a shared account by contact, with the brought forward entered for one and the rest to the other', () => {
    accounts(['7400', '7980'], [{ code: 'DLA', name: "Directors' loan", blynt: '7400', balance: '500000' }]);
    post('t1', 'DLA', mid(), '200000', 'Chand Silva', 'Transfer');
    post('t2', 'DLA', mid(), '-100000', 'Sri Perera', 'Repayment');
    const wp = db.addWorkpaper(eng().id, 'D-20')!;
    wp.data_json = { ...wp.data_json, directors: [{ id: 'd1', name: 'Sri Perera' }, { id: 'd2', name: 'Chand Silva', bf_p: '100000' }] };
    const ctx = paperContext(wp);
    expect(dlaReview(ctx, 'd1')).toMatchObject({ opening: 300000n, closing: 200000n });
    expect(dlaReview(ctx, 'd2')).toMatchObject({ opening: 100000n, closing: 300000n });
  });
});

describe('fixed assets from the ledger', () => {
  it('adds each purchase, an opening line per class, and returns credits as disposals', () => {
    accounts(['65', '66', '67', '68', '69'], [
      { code: 'VAN', name: 'Motor vehicles', blynt: '6700', balance: '1500000' },
      { code: 'VAND', name: 'Motor vehicles depreciation', blynt: '6710', balance: '-300000' },
    ]);
    post('v1', 'VAN', mid(), '500000', 'Ford', 'Transit van');
    post('v2', 'VAN', mid(), '-100000', 'Buyer', 'Old van sold');
    const wp = db.addWorkpaper(eng().id, 'F-10')!;
    const { assets, credits } = fromLedger(paperContext(wp), []);
    expect(assets).toEqual([
      expect.objectContaining({ class_code: '6700', source: 'opening', cost_p: '1100000', dep_bf_p: '300000' }),
      expect.objectContaining({ class_code: '6700', source: 'ledger', cost_p: '500000', desc: 'Transit van · Ford', from_tx: 'v1' }),
    ]);
    expect(credits).toEqual([expect.objectContaining({ amount: 100000n })]);
    // Pulling again adds nothing already there
    expect(fromLedger(paperContext(wp), assets.map((a, i) => ({ ...a, id: String(i), ref: '' }))).assets).toEqual([]);
  });
});

describe('opening reserves typed in', () => {
  it('on Reserves movement, used by Share capital and dividends too', () => {
    const e10 = db.addWorkpaper(eng().id, 'E-10')!;
    e10.data_json = { ...e10.data_json, bf_p: '' };
    const e20 = db.addWorkpaper(eng().id, 'E-20')!;
    e20.data_json = { ...e20.data_json, opening_p: '777700' };
    expect(reservesReview(paperContext(e20)).opening).toBe(777700n);
    expect(equityReview(paperContext(e10))).toMatchObject({ bf: 777700n, bfSource: 'entered' });
  });
});

describe('Companies House', () => {
  const profile = { company_name: 'X LTD', date_of_creation: '2019-02-01', sic_codes: ['62020'], registered_office_address: { address_line_1: '1 High St', locality: 'Leeds', postal_code: 'LS1 1AA' }, confirmation_statement: { last_made_up_to: '2026-02-01', next_due: '2027-02-15' } };
  const officers = {
    items: [
      { name: 'PERERA, Sri Lal', officer_role: 'director', appointed_on: '2019-02-01' },
      { name: 'SILVA, Chand', officer_role: 'director', appointed_on: '2020-01-01' },
      { name: 'OLD, Person', officer_role: 'director', appointed_on: '2019-02-01', resigned_on: '2021-01-01' },
    ],
  };
  const pscs = { items: [{ kind: 'individual-person-with-significant-control', name_elements: { forename: 'Sri', surname: 'PERERA' }, natures_of_control: ['ownership-of-shares-50-to-75-percent'] }] };

  it('reads directors, PSCs and the company details', () => {
    const r = fromCompaniesHouse(profile, officers, pscs);
    expect(r.company).toEqual({ registered_office: '1 High St, Leeds, LS1 1AA', incorporated: '2019-02-01', sic: '62020', last_cs: '2026-02-01', next_cs: '2027-02-15' });
    expect(r.people).toEqual([
      expect.objectContaining({ first_name: 'Sri', surname: 'Perera', is_director: true, psc: true, is_shareholder: true, ownership: '50-75%' }),
      expect.objectContaining({ first_name: 'Chand', surname: 'Silva', is_director: true, psc: false }),
      expect.objectContaining({ surname: 'Old', is_director: false, resigned: '2021-01-01' }),
    ]);
  });

  it('folds them into the paper, keeping share counts already entered', () => {
    const { people } = fromCompaniesHouse(profile, officers, pscs);
    let n = 0;
    const m = mergeOfficers([{ id: 'o1', first_name: 'Sri', surname: 'Perera', is_shareholder: true, shares: '60' }], people, () => `new${++n}`);
    expect(m).toMatchObject({ added: 2, updated: 1 });
    expect(m.officers[0]).toMatchObject({ id: 'o1', shares: '60', is_director: true, psc: true });
    expect(m.officers.map((o) => o.surname)).toEqual(['Perera', 'Silva', 'Old']);
  });
});

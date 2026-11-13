// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { journalCheck, journalSig, openItems, pair } from '../lib/workpapers/common';
import { creditorsJournal, supplierView } from '../lib/workpapers/creditors';
import { otherItemView } from '../lib/workpapers/other-debtors';
import { prepaidPart } from '../lib/workpapers/prepayments';
import { stockView } from '../lib/workpapers/stock';
import { accountsDue } from '../lib/workpapers/statutory';

beforeEach(() => db.seed(true));

const tx = (id: string, date: string, amount_p: string) => ({ id, engagement_id: 'e', account_code: 'X', account_name: 'X', date, contact: 'C', description: id, amount_p, vat_p: '0', gross_p: amount_p, source: 'Xero' as const });

describe('shared pieces', () => {
  it('clears open items oldest first and keeps what is left over', () => {
    const r = openItems([tx('i1', '2025-01-10', '1000'), tx('i2', '2025-03-01', '500'), tx('p1', '2025-03-05', '-1200')], '2025-03-31', 1n);
    expect(r.open.map((o) => [o.tx.id, o.amount])).toEqual([['i2', 300n]]);
    expect(r.balance).toBe(300n);
  });

  it('a sent journal stops passing when the decisions change, and a sent one with nothing needed fails too', () => {
    const lines = pair('7300', '4700', 38926n, 'x');
    expect(lines).toEqual([expect.objectContaining({ code: '7300', debit: 38926n }), expect.objectContaining({ code: '4700', credit: 38926n })]);
    expect(pair('7300', '4700', -5n, 'x')[0]).toMatchObject({ code: '4700', debit: 5n });
    expect(journalCheck(undefined, []).passed).toBe(true);
    expect(journalCheck(undefined, lines).passed).toBe(false);
    expect(journalCheck({ ref: 'AJE-1', sig: journalSig(lines) }, lines).passed).toBe(true);
    expect(journalCheck({ ref: 'AJE-1', sig: journalSig(lines) }, []).passed).toBe(false);
  });
});

describe('trade creditors', () => {
  it('suggests from the statement difference and builds the journal with VAT split out', () => {
    expect(supplierView({ id: 's', name: 'NF', ledger_p: '31250', statement_p: '55250', paid_after_p: '0' }).suggestion?.kind).toBe('missing_invoice');
    expect(supplierView({ id: 's', name: 'GP', ledger_p: '52732', statement_p: '22732', paid_after_p: '0' }).suggestion?.kind).toBe('timing');
    expect(supplierView({ id: 's', name: 'PT', ledger_p: '-15000', statement_p: '', paid_after_p: '0' }).suggestion?.kind).toBe('debtors');
    expect(supplierView({ id: 's', name: 'GP', ledger_p: '22732', statement_p: '22732', paid_after_p: '0', oldest_days: 125 }).status).toBe('dispute');
    const lines = creditorsJournal({
      suppliers: [
        { id: 'a', name: 'NF', ledger_p: '31250', statement_p: '55250', paid_after_p: '0', decision: 'missing_invoice', expense_code: '4300', vat_p: '4000' },
        { id: 'b', name: 'PT', ledger_p: '-15000', statement_p: '', paid_after_p: '0', decision: 'debtors' },
      ],
      search: { items: [{ id: 'x', date: '2026-04-18', contact: 'British Gas', desc: 'electricity', amount_p: '45000', code: '4100', decision: 'accrue' }] },
    });
    expect(lines.map((l) => [l.code, l.debit, l.credit])).toEqual([
      ['4300', 20000n, 0n],
      ['7800', 4000n, 0n],
      ['7500', 0n, 24000n],
      ['7200', 15000n, 0n],
      ['7500', 0n, 15000n],
      ['4100', 45000n, 0n],
      ['7600', 0n, 45000n],
    ]);
  });
});

describe('other debtors', () => {
  it('flags prepayments by description and stale unsupported balances', () => {
    expect(otherItemView({ id: 'a', account: '7490', desc: 'Annual software licence', date: '2026-01-01', amount_p: '96000' }, '2026-03-31', 0).suggestion?.kind).toBe('prepayment');
    expect(otherItemView({ id: 'b', account: '7490', desc: 'Balance brought forward', date: '2023-03-31', amount_p: '31000' }, '2026-03-31', 0).suggestion?.kind).toBe('write_off');
    expect(otherItemView({ id: 'b', account: '7490', desc: 'Balance brought forward', date: '2023-03-31', amount_p: '31000' }, '2026-03-31', 1).suggestion).toBeNull();
    expect(otherItemView({ id: 'c', account: '7200', desc: 'Insurance claim', date: '2026-02-14', amount_p: '125000', recovered_p: '125000', due: 'within' }, '2026-03-31', 0).supported).toBe(true);
  });
});

describe('prepayments', () => {
  it('works out the prepaid part by days, by months and in full', () => {
    const l = { id: 'x', desc: '', code: '4700', net_p: '192000' };
    expect(prepaidPart({ ...l, method: 'days', start: '2025-06-14', end: '2026-06-13' }, '2026-03-31')).toBe((192000n * 74n + 182n) / 365n);
    expect(prepaidPart({ ...l, net_p: '240000', method: 'months', start: '2026-03-01', end: '2026-05-31' }, '2026-03-31')).toBe(160000n);
    expect(prepaidPart({ ...l, net_p: '26400', method: 'months', start: '2025-10-01', end: '2026-09-30' }, '2026-03-31')).toBe(13200n);
    expect(prepaidPart({ ...l, net_p: '85000', method: 'all' }, '2026-03-31')).toBe(85000n);
    expect(prepaidPart({ ...l, method: 'days', start: '2025-01-01', end: '2025-12-31' }, '2026-03-31')).toBe(0n);
  });
});

describe('stock', () => {
  it('revalues to the latest invoice and writes down to net realisable value', () => {
    const sealant = stockView({ id: 's', desc: 'Sealant', qty: '60', unit_cost_p: '450', invoice_cost_p: '390' });
    expect(sealant.suggestions[0]).toMatchObject({ kind: 'revalue', amount: 3600n });
    expect(stockView({ ...sealant.l, decision_cost: 'revalue' }).closing).toBe(23400n);
    const display = stockView({ id: 'd', desc: 'Display units', qty: '4', unit_cost_p: '4500', nrv_p: '2000', decision_nrv: 'write_down' });
    expect(display).toMatchObject({ counted: 18000n, writeDown: 10000n, closing: 8000n });
    expect(stockView({ id: 'm', desc: 'Battens', qty: '400', unit_cost_p: '120' }).counted).toBe(48000n);
  });

  it('builds the closing stock journal against 700', () => {
    const wp = db.addWorkpaper(db.engagements[0].id, 'D-10')!;
    wp.data_json = { ...wp.data_json, lines: [{ id: 'a', desc: 'Stock', qty: '1', unit_cost_p: '162000' }] };
    const r = evaluatePaper(wp)!;
    expect(r.totals.closing).toBe(162000n);
    expect(r.checks.find((c) => c.id === 'agrees_ledger')!.passed).toBe(r.totals.ledger === 162000n);
  });
});

describe('statutory information', () => {
  it('works out when the accounts are due', () => {
    expect(accountsDue('2026-03-31')).toBe('2026-12-31');
    expect(accountsDue('2025-04-05')).toBe('2026-01-05');
    expect(accountsDue('2026-02-28')).toBe('2026-11-30');
  });
});

describe('share capital and dividends', () => {
  it('tests each dividend against reserves on the day it was paid', () => {
    const eng = db.engagements[0];
    const wp = db.addWorkpaper(eng.id, 'E-10')!;
    wp.data_json = {
      ...wp.data_json,
      bf_p: '1000000', // £10,000 brought forward
      classes: [{ id: 'c', name: 'Ordinary', shares: '100', nominal_p: '100' }],
      dividends: [
        { id: 'd1', date: eng.period_start, type: 'interim', amount_p: '500000' },
        { id: 'd2', date: eng.period_start, type: 'interim', amount_p: '600000' },
      ],
    };
    const r = evaluatePaper(wp)!;
    const lawful = r.checks.find((c) => c.id === 'lawful')!;
    // On the first day there is no profit yet: £10,000 covers the first £5,000 but not a further £6,000
    expect(lawful.passed).toBe(false);
    expect(lawful.detail).toContain('£6,000.00');
  });
});

import { matchBlyntAccount } from '../lib/mapping/auto-mapper';

describe('mapping confidence (review point 1)', () => {
  it('comes from the evidence, never 100% for a name match', () => {
    const sales = matchBlyntAccount('Sales', 'Revenue');
    expect(sales).toMatchObject({ blynt_code: '1000' });
    expect(sales!.confidence).toBeGreaterThanOrEqual(90);
    expect(sales!.confidence).toBeLessThan(100);
    // A catch-all target is worth a look, however the name reads
    const cleaning = matchBlyntAccount('Entertainment', 'Expense');
    expect(cleaning!.blynt_code).toBe('4990');
    expect(cleaning!.confidence).toBeLessThan(90);
    // The account type contradicting the match drags it down to an exception
    expect(matchBlyntAccount('Insurance', 'Current Liability')!.confidence).toBeLessThan(70);
    expect(matchBlyntAccount('Account XJ-9', '')!.confidence).toBeLessThan(70);
  });
});

import { assetYear } from '../lib/workpapers/fixed-assets';
import { groupOf, taxYearOf } from '../lib/workpapers/dla';

describe('fixed assets register (review point 7)', () => {
  const base = { id: 'a', ref: 'FA001', desc: 'Van', class_code: '6700' as const, acquired: '2023-05-01', cost_p: '1000000', dep_bf_p: '400000' };
  it('charges straight line on cost and reducing balance on book value, never below nil', () => {
    expect(assetYear(base, { method: 'rb', rate: '25' }, '2025-04-01', '2026-03-31').charge).toBe(150000n);
    expect(assetYear(base, { method: 'sl', rate: '25' }, '2025-04-01', '2026-03-31').charge).toBe(250000n);
    expect(assetYear({ ...base, dep_bf_p: '950000' }, { method: 'sl', rate: '25' }, '2025-04-01', '2026-03-31').charge).toBe(50000n);
    // A full year in the year of purchase
    expect(assetYear({ ...base, acquired: '2026-03-01', dep_bf_p: '0' }, { method: 'sl', rate: '25' }, '2025-04-01', '2026-03-31')).toMatchObject({ added: true, charge: 250000n });
  });
  it('a disposal has no charge and a profit against book value', () => {
    const y = assetYear({ ...base, disposed: '2026-01-12', proceeds_p: '180000' }, { method: 'rb', rate: '25' }, '2025-04-01', '2026-03-31');
    expect(y).toMatchObject({ disposed: true, charge: 0n, nbv: 0n, profit: 180000n - 600000n });
  });
});

describe("director's loan (review point 11)", () => {
  it('sorts movements and finds the tax year', () => {
    expect(groupOf('Dividend 30 Jun', -500000n)).toBe('dividends');
    expect(groupOf('Net pay March', -100000n)).toBe('salary');
    expect(groupOf('Transfer to director', 50000n)).toBe('transfers');
    expect(groupOf('Currys TV', 35000n)).toBe('personal');
    expect(groupOf('Repayment', -320000n)).toBe('repaid');
    expect(taxYearOf('2026-03-31')).toMatchObject({ start: '2025-04-06', end: '2026-04-05', label: '2025/26' });
    expect(taxYearOf('2026-04-30')).toMatchObject({ label: '2026/27' });
  });
});

describe('investments (review point 15)', () => {
  it('FRS 105 depreciates the building; FRS 102 takes the fair value movement with deferred tax', () => {
    const eng = db.engagements[0];
    const wp = db.addWorkpaper(eng.id, 'G-10')!;
    wp.data_json = { ...wp.data_json, properties: [{ id: 'p', address: 'Flat 2', acquired: '2000-01-01', cost_p: '20000000', land_p: '5000000', prior_value_p: '25000000', valuation_p: '26000000', valuer: 'independent', valuation_date: eng.period_end, title: 'T1' }] };
    eng.framework = 'Micro-entity (FRS 105)';
    expect(evaluatePaper(wp)!.totals.property).toBe(20000000n - 300000n);
    eng.framework = 'FRS 102 Section 1A';
    const r = evaluatePaper(wp)!;
    expect(r.totals).toMatchObject({ property: 26000000n, gains: 1000000n, deferred_tax: 250000n });
  });
});

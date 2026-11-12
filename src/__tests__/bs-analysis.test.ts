// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../lib/server/db';
import { evaluatePaper, paperContext } from '../lib/workpapers/engine';
import { bsAnalysis } from '../lib/workpapers/bs-analysis';

const ENG = 'eng_bs_test';
const PRIOR = 'eng_bs_prior';
const map = (eng: string, code: string, pence: number) =>
  ({ id: `m_${eng}_${code}`, engagement_id: eng, source_code: code, source_name: code, balance_p: String(pence), blynt_code: code, status: 'confirmed' }) as any;

beforeEach(() => {
  db.seed(true);
  db.engagements.push(
    { id: ENG, client_id: 'cli_harlow', firm_id: 'x', period_start: '2025-04-01', period_end: '2026-03-31', prior_engagement_id: PRIOR } as any,
    { id: PRIOR, client_id: 'cli_harlow', firm_id: 'x', period_start: '2024-04-01', period_end: '2025-03-31', prior_engagement_id: null } as any
  );
  // A balanced TB each year: sales 100,000 cr · materials 40,000 dr · cash · trade creditors · capital
  db.account_mappings.push(
    map(ENG, '100', -10000000), map(ENG, '200', 4000000), map(ENG, '600', 7000000), map(ENG, '750', -900000), map(ENG, '850', -100000),
    map(PRIOR, '100', -8000000), map(PRIOR, '200', 3000000), map(PRIOR, '600', 5200000), map(PRIOR, '750', -100000), map(PRIOR, '850', -100000)
  );
});

const z40 = () => db.addWorkpaper(ENG, 'Z-40')!;
const check = (wp: ReturnType<typeof z40>, id: string) => evaluatePaper(wp)!.checks.find((c) => c.id === id);

describe('balance sheet analysis (Z-40)', () => {
  it('balances, links each line to its paper and works out the ratios', () => {
    const wp = z40();
    db.addWorkpaper(ENG, 'B-10');
    const r = bsAnalysis(paperContext(wp));
    expect(r.balances).toBe(true);
    expect(r.a.netAssets.amount).toBe(6100000n); // cash 70,000 less creditors 9,000
    const cash = r.rows.find((x) => x.codes.includes('600'))!;
    expect(cash.schedules.find((s) => s.ref === 'B-10')?.wpId).toBeTruthy();
    expect(cash).toMatchObject({ prior: 5200000n, change: 1800000n, material: true });
    expect(r.ratios.now.creditorDays).toBeCloseTo((9000 / 40000) * 365, 5);
    expect(r.ratios.now.currentRatio).toBeCloseTo(70000 / 9000, 5);
    expect(check(wp, 'balances')!.passed).toBe(true);
  });

  it('asks for a paper behind every balance and an explanation for each material movement', () => {
    const wp = z40();
    expect(check(wp, 'schedules')!.passed).toBe(false); // no bank or creditors paper yet
    db.addWorkpaper(ENG, 'B-10');
    db.addWorkpaper(ENG, 'K-10');
    expect(check(wp, 'schedules')!.passed).toBe(true);
    expect(check(wp, 'movements')!.passed).toBe(false);
    const rows = bsAnalysis(paperContext(wp)).rows.filter((x) => x.material);
    wp.data_json.comments = Object.fromEntries(rows.map((x) => [x.key, 'Explained']));
    expect(check(wp, 'movements')!.passed).toBe(true);
  });

  it('is micro on two of three limits once employees are entered, and needs a going concern decision', () => {
    const wp = z40();
    expect(bsAnalysis(paperContext(wp)).microNow).toBe(true); // turnover and total both met
    expect(check(wp, 'size_gc')!.passed).toBe(false);
    wp.data_json.employees = '3';
    wp.data_json.going_concern = 'concern';
    expect(check(wp, 'size_gc')!.passed).toBe(false); // a concern needs a reason
    wp.data_json.going_concern_reason = 'Main customer lost in May';
    expect(check(wp, 'size_gc')!.passed).toBe(true);
    expect(evaluatePaper(wp)!.draftConclusion).toContain('Main customer lost in May');
  });
});

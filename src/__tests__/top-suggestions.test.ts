import { describe, it, expect } from 'vitest';
import { topSuggestions } from '@/lib/mapping/auto-mapper';
import { STANDARD_CHART } from '@/lib/standard-chart';

const line = (p: Partial<{ source_name: string; source_type: string; blynt_code: string | null; ai_alternatives: { blynt_code: string }[] }>) => ({
  source_name: 'Vehicle Insurance - L&G',
  source_type: 'Direct Costs',
  blynt_code: '1000',
  ...p,
});

describe('top suggestions for a line', () => {
  it('offers up to three accounts of the same kind sharing words with the name, never the current one', () => {
    const got = topSuggestions(line({}), STANDARD_CHART);
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(3);
    expect(got.every((a) => a.code !== '1000' && ['Cost of Sales', 'Overhead'].includes(a.type))).toBe(true);
    expect(got.some((a) => /insurance/i.test(a.name))).toBe(true);
  });

  it("puts the AI's own alternatives first", () => {
    const got = topSuggestions(line({ ai_alternatives: [{ blynt_code: '4990' }] }), STANDARD_CHART);
    expect(got[0].code).toBe('4990');
  });

  it('offers nothing when no account shares a word', () => {
    expect(topSuggestions(line({ source_name: 'Zzqx' }), STANDARD_CHART)).toEqual([]);
  });
});

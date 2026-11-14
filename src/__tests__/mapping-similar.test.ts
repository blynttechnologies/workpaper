import { describe, it, expect } from 'vitest';
import { nameShape, similarLines } from '../lib/mapping/similar';

const l = (id: string, source_name: string, source_type = 'Direct Costs') => ({ id, source_name, source_type });

describe('lines that look like the one corrected', () => {
  const lines = [
    l('a', 'Route 2V Wages'),
    l('b', 'Route 52 Wages'),
    l('c', 'Route 7 Wages', 'Expense'),
    l('d', 'Drivers Wages'),
    l('e', 'Route 2V Fuel'),
    l('f', '2V Cash Fares', 'Revenue'),
    l('g', 'Wages bonus', 'Revenue'),
  ];

  it('the same name but for codes and numbers is ticked; a shared word of the same type is offered', () => {
    expect(nameShape('Route 2V Wages')).toBe('route * wages');
    const found = similarLines(lines[0], lines).map((x) => [x.line.id, x.alike]);
    expect(found).toEqual([['b', true], ['c', true], ['d', false]]);
  });

  it('a name that is only a code matches nothing by shape', () => {
    expect(similarLines(l('x', '2026'), [l('y', '2025')])).toEqual([]);
  });
});

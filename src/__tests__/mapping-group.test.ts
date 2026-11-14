import { describe, it, expect } from 'vitest';
import { groupMappings } from '../lib/mapping/group';

const m = (source_code: string, source_type: string, balance_p: string) => ({ source_code, source_type, balance_p });

describe('mapping lines grouped by ledger type', () => {
  const rows = [
    m('001', 'Revenue', '-158710'),
    m('090', 'Bank', '500000'),
    m('005', 'Revenue', '-27236515'),
    m('2VW', 'Direct Costs', '2791096'),
    m('2VT', 'Revenue', '150810'),
    m('X1', 'Suspense', '100'),
  ];

  it('in trial balance order, largest balance first within each type, debit or credit', () => {
    const g = groupMappings(rows, 'amount');
    expect(g.map((x) => x.type)).toEqual(['Revenue', 'Direct Costs', 'Bank', 'Suspense']);
    expect(g[0].rows.map((r) => r.source_code)).toEqual(['005', '001', '2VT']);
    expect(g[0].total).toBe(-27236515n - 158710n + 150810n);
  });

  it('code order keeps the order given', () => {
    expect(groupMappings(rows, 'code')[0].rows.map((r) => r.source_code)).toEqual(['001', '005', '2VT']);
  });
});

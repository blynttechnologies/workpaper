// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pickBalances, type PrintedBalance } from '../lib/server/statement-reader';

const b = (date: string, balance_p: string, kind: PrintedBalance['kind'] = 'line'): PrintedBalance => ({ date, balance_p, page: 1, kind });
const statement = [
  b('2026-03-01', '7500000', 'opening'),
  b('2026-03-15', '8320000'),
  b('2026-03-28', '8135000'),
  b('2026-03-31', '8140000'), // two lines on the year end: the last one is the day's balance
  b('2026-03-31', '8132500'),
  b('2026-04-02', '8752500'),
  b('2026-04-10', '8752500', 'closing'),
];

describe('picking the year-end balance by date', () => {
  it('takes the last balance printed on the year end, then the days either side', () => {
    const { atEnd, others } = pickBalances(statement, '2026-03-31');
    expect(atEnd).toMatchObject({ date: '2026-03-31', balance_p: '8132500', label: 'Balance on 31 Mar 2026' });
    expect(others.map((o) => [o.label, o.date, o.balance_p])).toEqual([
      ['Previous balance', '2026-03-28', '8135000'],
      ['Next balance', '2026-04-02', '8752500'],
      ['Statement opening balance', '2026-03-01', '7500000'],
      ['Statement closing balance', '2026-04-10', '8752500'],
    ]);
  });

  it('with no movement on the year end, carries the last balance forward and dates it the year end', () => {
    const { atEnd, others } = pickBalances(statement.filter((x) => x.date !== '2026-03-31'), '2026-03-31');
    expect(atEnd).toMatchObject({ date: '2026-03-31', balance_p: '8135000', label: 'Balance on 31 Mar 2026 (no movement since 28 Mar 2026)' });
    expect(others[0]).toMatchObject({ label: 'Previous balance', date: '2026-03-15', balance_p: '8320000' });
  });

  it('reads a newest-first statement the right way round: the top line on the last day is its balance', () => {
    // As Monzo prints it: newest first, five lines on 30 Oct
    const line = (date: string, balance_p: string, amount_p: string): PrintedBalance => ({ date, balance_p, amount_p, page: 1, kind: 'line' });
    const monzo = [
      line('2026-10-30', '728940', '-98758'),
      line('2026-10-30', '827698', '3961'),
      line('2026-10-30', '823737', '-6149'),
      line('2026-10-30', '829886', '438'),
      line('2026-10-30', '829448', '-50000'),
      line('2026-10-28', '879448', '500000'),
    ];
    expect(pickBalances(monzo, '2026-10-31', '2026-10-31').atEnd).toMatchObject({ date: '2026-10-31', balance_p: '728940' });
    // Without amounts, the dates still show which way it runs
    expect(pickBalances(monzo.map(({ amount_p: _a, ...b }) => b), '2026-10-30').atEnd).toMatchObject({ balance_p: '728940' });
  });

  it('a statement whose printed period runs to the year end reaches it with no movement on the last day', () => {
    const only = statement.filter((x) => x.date <= '2026-03-28');
    expect(pickBalances(only, '2026-03-31').atEnd).toBeNull();
    expect(pickBalances(only, '2026-03-31', '2026-03-31').atEnd).toMatchObject({ date: '2026-03-31', balance_p: '8135000' });
  });

  it('gives no year-end balance when the statement stops before the year end or starts after it', () => {
    expect(pickBalances(statement.filter((x) => x.date < '2026-03-20'), '2026-03-31').atEnd).toBeNull();
    expect(pickBalances(statement.filter((x) => x.date > '2026-04-01'), '2026-03-31').atEnd).toBeNull();
  });
});

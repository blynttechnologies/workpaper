import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { db } from '@/lib/server/db';
import { CATEGORIES } from '@/lib/coa';
import { papersForCode } from '@/lib/workpapers/common';
import { NewAccountForm } from '../components/coa/NewAccountForm';

beforeEach(() => db.seed(true));
afterEach(cleanup);

const setup = (name: string) => {
  const onCreated = vi.fn();
  render(<NewAccountForm firmId="firm_blynt_uk" initialName={name} onCreated={onCreated} onCancel={() => {}} />);
  const category = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
  const pickCategory = (n: string) => fireEvent.change(category, { target: { value: String(CATEGORIES.findIndex((c) => c.name === n)) } });
  return { onCreated, pickCategory };
};

describe('new account: working paper', () => {
  it('a bank account goes on the bank reconciliation, with no choice to make', () => {
    const { onCreated, pickCategory } = setup('Savings account');
    pickCategory('Bank and cash');
    expect(screen.queryByRole('combobox', { name: 'Working paper' })).toBeNull();
    expect(screen.getByText('B-10 Bank and cash reconciliation')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and create' }));
    expect(papersForCode(onCreated.mock.calls[0][0].code).map((t) => t.ref)).toContain('B-10');
  });

  it('a current liability is put on the paper chosen, treated like an account on it', () => {
    const { onCreated, pickCategory } = setup('Pension creditor');
    pickCategory('Current liabilities');
    const paper = screen.getByRole('combobox', { name: 'Working paper' }) as HTMLSelectElement;
    expect([...paper.options].map((o) => o.value)).toEqual(expect.arrayContaining(['K-10', 'K-20', 'T-20', 'P-20']));
    fireEvent.change(paper, { target: { value: 'P-20' } });
    expect(paper.value).toBe('P-20');
    fireEvent.click(screen.getByRole('button', { name: 'Approve and create' }));
    const acc = onCreated.mock.calls[0][0];
    expect(papersForCode(acc.code).map((t) => t.ref)).toContain('P-20');
    expect(papersForCode(acc.parent_code).map((t) => t.ref)).toContain('P-20');
  });

  it('the account it is treated like can be changed, among accounts on the same paper only', () => {
    const { pickCategory } = setup('Payroll liability');
    pickCategory('Current liabilities');
    fireEvent.change(screen.getByRole('combobox', { name: 'Working paper' }), { target: { value: 'P-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    const like = screen.getByRole('combobox', { name: 'Treated like' }) as HTMLSelectElement;
    expect([...like.options].every((o) => papersForCode(o.value).some((t) => t.ref === 'P-20'))).toBe(true);
  });
});

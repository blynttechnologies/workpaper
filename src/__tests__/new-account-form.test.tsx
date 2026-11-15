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
  it('a bank account goes on the bank reconciliation, the only paper for its category', () => {
    const { onCreated, pickCategory } = setup('Savings account');
    pickCategory('Bank and cash');
    const paper = screen.getByRole('combobox', { name: 'Working paper' }) as HTMLSelectElement;
    expect(paper.value).toBe('B-10');
    expect([...paper.querySelectorAll('optgroup')[0].querySelectorAll('option')].map((o) => o.value)).toEqual(['B-10']);
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

  it('every working paper can be chosen; one from another category moves the account there', () => {
    const { onCreated, pickCategory } = setup('HSRL variances');
    pickCategory('Administrative expenses');
    const paper = screen.getByRole('combobox', { name: 'Working paper' }) as HTMLSelectElement;
    const others = [...paper.querySelectorAll('optgroup')[1].querySelectorAll('option')].map((o) => o.value);
    expect(others).toEqual(expect.arrayContaining(['B-10', 'K-20', 'D-10', 'T-20']));
    fireEvent.change(paper, { target: { value: 'D-10' } });
    expect(paper.value).toBe('D-10');
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe(String(CATEGORIES.findIndex((c) => c.name === 'Current assets')));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and create' }));
    const acc = onCreated.mock.calls[0][0];
    expect(Number(acc.code)).toBeGreaterThanOrEqual(7000);
    expect(papersForCode(acc.code).map((t) => t.ref)).toContain('D-10');
  });

  it('the account it is treated like is a choice among accounts on the same paper only', () => {
    const { pickCategory } = setup('Payroll liability');
    pickCategory('Current liabilities');
    fireEvent.change(screen.getByRole('combobox', { name: 'Working paper' }), { target: { value: 'P-20' } });
    const like = screen.getByRole('combobox', { name: 'Treated like' }) as HTMLSelectElement;
    expect(like.options.length).toBeGreaterThan(1);
    expect([...like.options].every((o) => papersForCode(o.value).some((t) => t.ref === 'P-20'))).toBe(true);
  });

  it('offers the suggestion for the name, and Use this sets category, working paper and treated like', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ suggested_blynt_code: '4800', reason: 'Consultancy is a professional fee', source: 'ai' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { pickCategory } = setup('Consulting');
      pickCategory('Bank and cash');
      const status = await screen.findByText(/AI suggests/, {}, { timeout: 2000 });
      expect(status.parentElement!.textContent).toContain('4800');
      expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toMatchObject({ name: 'Consulting', all: true });
      fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
      expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe(String(CATEGORIES.findIndex((c) => c.name === 'Administrative expenses')));
      expect((screen.getByRole('combobox', { name: 'Treated like' }) as HTMLSelectElement).value).toBe('4800');
      expect(screen.getByText('In use')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

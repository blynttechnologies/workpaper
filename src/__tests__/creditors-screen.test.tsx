import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { CreditorsSchedule } from '../components/workpaper/papers/creditors';
import type { Attachment } from '../lib/types/models';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(suppliers: any[], files: Record<string, Attachment[]> = {}, attachTo: (id: string) => void = () => {}) {
  db.seed(true);
  const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
  const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'K-10') ?? db.addWorkpaper(eng.id, 'K-10')!;
  wp.data_json = { ...wp.data_json, suppliers };
  const saved: Record<string, any>[] = [];
  const save = (p: Record<string, any>) => {
    saved.push(p);
    Object.assign(wp.data_json, p);
  };
  render(
    <CreditorsSchedule
      data={wp.data_json}
      result={evaluatePaper(wp)!}
      locked={false}
      save={save}
      filesFor={(id) => files[id] ?? []}
      attachTo={attachTo}
      preview={() => {}}
      tickFor={() => null}
      live={() => wp.data_json}
    />
  );
  return { saved, wp };
}

describe('trade creditors screen', () => {
  it('puts the suggestion and its decision in the row, as on trade debtors', () => {
    const { saved } = setup([{ id: 'sup_gsf', name: 'GSF Car Parts', ledger_p: '-25111', statement_p: '', paid_after_p: '0' }]);
    const row = screen.getByText('GSF Car Parts').closest('tr')!;
    expect(within(row).getByText('Suggested: move to debtors')).toBeTruthy();
    fireEvent.click(within(row).getByText('Move to debtors'));
    expect(saved.at(-1)!.suppliers[0].decision).toBe('debtors');
  });

  it('opens the details full width under the row', () => {
    setup([{ id: 'sup_bg', name: 'British Gas', ledger_p: '25376', statement_p: '', paid_after_p: '0', oldest_days: 335, overdue: true, invoices: [{ ref: '724663398', date: '2025-03-31', days: 335, amount_p: '20360' }] }]);
    fireEvent.click(screen.getByLabelText('Show details for British Gas'));
    const cell = screen.getByText(/^Open bills at/).closest('td')!;
    // A flex cell stops being a table cell and squeezes into the first column
    expect(cell.className).not.toMatch(/\bflex\b/);
    expect(Number(cell.getAttribute('colspan'))).toBeGreaterThan(5);
    expect(screen.getByText(/may be disputed or not owed/)).toBeTruthy();
  });

  it('reads an attached statement with AI and offers the balance', async () => {
    const att = { id: 'att_stmt', filename: 'british-gas.pdf' } as Attachment;
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ai: true, attachment: { id: 'att_stmt', category: 'Supplier statement' }, data: { closing_balance_p: { value: '25376', page: 1, confidence: 96 }, statement_date: { value: '2025-12-31' } } }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { saved } = setup([{ id: 'sup_bg', name: 'British Gas', ledger_p: '25376', statement_p: '', paid_after_p: '0' }], { sup_bg: [att] });
    await waitFor(() => expect(saved.some((p) => p.suppliers?.[0]?.ai_statement?.balance_p === '25376')).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/documents/att_stmt/extract', expect.objectContaining({ body: JSON.stringify({ overrideCategory: 'Supplier statement' }) }));
    // Nothing is filled in until someone uses it
    expect(saved.at(-1)!.suppliers[0].statement_p).toBe('');
  });
});

describe('trade creditors next steps', () => {
  it('offers to attach the statement, and says when the supplier was paid in full after the year end', () => {
    const attached: string[] = [];
    setup([{ id: 'sup_ea', name: 'Environment Agency', ledger_p: '9898', statement_p: '', paid_after_p: '9898' }], {}, (id) => attached.push(id));
    const row = screen.getByText('Environment Agency').closest('tr')!;
    expect(within(row).getByText('Paid in full after the year end')).toBeTruthy();
    fireEvent.click(within(row).getByText('Attach statement'));
    fireEvent.click(within(row).getByLabelText('Attach the statement for Environment Agency'));
    expect(attached).toEqual(['sup_ea', 'sup_ea']);
  });
});

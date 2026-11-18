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

function setup(suppliers: any[], files: Record<string, Attachment[]> = {}, attachTo: (id: string) => void = () => {}, dropFiles?: (files: File[], rowId: string | null) => void, swapEvidence?: (a: string, b: string) => void) {
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
      dropFiles={dropFiles}
      swapEvidence={swapEvidence}
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

  it('reads an attached statement with AI and fills in the balance', async () => {
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
    // An empty balance is filled in from the statement, and the row says the AI read it
    expect(saved.at(-1)!.suppliers[0].statement_p).toBe('25376');
  });
});

describe('trade creditors next steps', () => {
  it('attaches the statement from the paperclip only, and says when the supplier was paid in full after the year end', () => {
    const attached: string[] = [];
    setup([{ id: 'sup_ea', name: 'Environment Agency', ledger_p: '9898', statement_p: '', paid_after_p: '9898' }], {}, (id) => attached.push(id));
    const row = screen.getByText('Environment Agency').closest('tr')!;
    expect(within(row).getByText('Paid in full after the year end')).toBeTruthy();
    expect(within(row).queryByText('Attach statement')).toBeNull();
    fireEvent.click(within(row).getByLabelText('Attach the statement for Environment Agency'));
    expect(attached).toEqual(['sup_ea']);
  });
  it('says the client is not connected to Xero, with the way to put it right', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'This client is not connected to Xero yet.', code: 'XERO_NOT_CONNECTED' }) })));
    setup([{ id: 'sup_bg', name: 'British Gas', ledger_p: '25376', statement_p: '100', paid_after_p: '0' }]);
    fireEvent.click(screen.getByText('Check bank'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not connected to Xero/);
    expect(within(alert).getByText('Open the client’s page').getAttribute('href')).toMatch(/^\/clients\//);
  });
});

describe('trade creditors drag and drop', () => {
  it('highlights the row a statement is dragged over and attaches it to that supplier', () => {
    const dropped: [string, string | null][] = [];
    setup([{ id: 'sup_ea', name: 'Environment Agency', ledger_p: '9898', statement_p: '', paid_after_p: '0' }], {}, () => {}, (f, id) => dropped.push([f[0].name, id]));
    const row = screen.getByText('Environment Agency').closest('tr')!;
    const file = new File(['%PDF'], 'ea.pdf', { type: 'application/pdf' });
    fireEvent.dragOver(row, { dataTransfer: { files: [file] } });
    expect(row.className).toContain('outline-dashed');
    fireEvent.drop(row, { dataTransfer: { files: [file] } });
    expect(row.className).not.toContain('outline-dashed');
    expect(dropped).toEqual([['ea.pdf', 'sup_ea']]);
  });
});

describe('trade creditors AI statement reading', () => {
  it('says whose statement the AI read and how the balance compares with the ledger', () => {
    setup([
      { id: 'sup_rml', name: 'Raymond Martin Langley', ledger_p: '20833', statement_p: '', paid_after_p: '0', ai_statement: { file: 'att_1', balance_p: '499253', date: '2025-12-31', page: 1, supplier: 'Protran Services Limited' } },
      { id: 'sup_bg', name: 'British Gas', ledger_p: '25376', statement_p: '25376', paid_after_p: '0', ai_statement: { file: 'att_2', balance_p: '25376', supplier: 'British Gas Ltd' } },
    ], { sup_rml: [{ id: 'att_1', filename: 'protran.pdf' } as Attachment], sup_bg: [{ id: 'att_2', filename: 'bg.pdf' } as Attachment] });
    const wrong = screen.getByText('Raymond Martin Langley').closest('tr')!;
    expect(within(wrong).getByText(/This statement is from Protran Services Limited, not Raymond Martin Langley/)).toBeTruthy();
    expect(within(wrong).getByText(/4,784\.20 more than the ledger/)).toBeTruthy();
    expect(within(wrong).getByText('Use this balance')).toBeTruthy();
    const right = screen.getByText('British Gas').closest('tr')!;
    expect(within(right).getByText('Statement from British Gas Ltd')).toBeTruthy();
    expect(within(right).getByText('Agrees to the ledger')).toBeTruthy();
  });

  it('drops what the AI read when its file is deleted, and the balance only if the AI filled it', () => {
    const { saved } = setup([
      // The file att_1 is gone: the AI filled this balance, so both go
      { id: 'sup_rml', name: 'Raymond Martin Langley', ledger_p: '20833', statement_p: '499250', paid_after_p: '0', ai_statement: { file: 'att_1', balance_p: '499250', supplier: 'Protran Services Limited' } },
      // Its file is gone too, but someone typed another balance: that stays
      { id: 'sup_bg', name: 'British Gas', ledger_p: '25376', statement_p: '25000', paid_after_p: '0', ai_statement: { file: 'att_2', balance_p: '25376' } },
      // Still attached: untouched
      { id: 'sup_ea', name: 'Environment Agency', ledger_p: '9898', statement_p: '9898', paid_after_p: '0', ai_statement: { file: 'att_3', balance_p: '9898' } },
    ], { sup_ea: [{ id: 'att_3', filename: 'ea.pdf' } as Attachment] });
    const [rml, bg, ea] = saved.at(-1)!.suppliers;
    expect(rml).toMatchObject({ statement_p: '', ai_statement: undefined });
    expect(bg).toMatchObject({ statement_p: '25000', ai_statement: undefined });
    expect(ea).toMatchObject({ statement_p: '9898', ai_statement: { file: 'att_3' } });
  });

  it('offers to move a statement to the supplier it names', () => {
    const swaps: string[][] = [];
    const { saved } = setup(
      [
        { id: 'sup_pro', name: 'Protran Services Limited', ledger_p: '254983', statement_p: '', paid_after_p: '0' },
        { id: 'sup_rml', name: 'Raymond Martin Langley', ledger_p: '20833', statement_p: '499250', paid_after_p: '0', ai_statement: { file: 'att_1', balance_p: '499250', supplier: 'Protran Services Limited' } },
      ],
      { sup_rml: [{ id: 'att_1', filename: 'protran.pdf' } as Attachment] },
      () => {},
      undefined,
      (a, b) => swaps.push([a, b])
    );
    fireEvent.click(screen.getByText('Move it to Protran Services Limited'));
    expect(swaps).toEqual([['sup_rml', 'sup_pro']]);
    expect(saved.at(-1)!.suppliers.find((x: any) => x.id === 'sup_rml')).toMatchObject({ statement_p: '', ai_statement: undefined });
  });
});

describe('trade creditors refresh for a Xero client', () => {
  it('does not list suppliers from the ledger when the open bills in Xero have not been read', () => {
    const { saved, wp } = setup([]);
    const eng = db.engagements.find((e) => e.id === wp.engagement_id)!;
    delete eng.creditor_open_items;
    db.transactions.push({ ...(db.transactions[0] ?? {}), id: 'tx_xero_test', engagement_id: eng.id, source: 'Xero' } as any);
    fireEvent.click(screen.getByText('Refresh from ledger'));
    expect(screen.getByText(/open bills at .* have not been read for this client yet/)).toBeTruthy();
    expect(saved.some((p) => p.suppliers)).toBe(false);
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { PrepaymentsSchedule } from '../components/workpaper/papers/prepayments';
import type { Attachment } from '../lib/types/models';

afterEach(cleanup);
// Searching the ledger asks the AI to read what it found
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('prepayments screen', () => {
  it('searching again takes ledger suggestions under the amount off the list, added or not', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string, net_p: string, extra: Record<string, any> = {}) => ({ id, desc: id, code: '4600', net_p, method: 'days', start: '2025-01-27', found: true, ...extra });
    wp.data_json = {
      ...wp.data_json,
      min_p: '50000',
      scanned_at: '2026-01-01T00:00:00.000Z',
      prepayments: [
        line('added_small', '11900', { decision: 'add' }),
        line('undecided_small', '11464'),
        line('period_entered', '19450', { decision: 'add', end: '2026-01-26' }),
        line('has_invoice', '22032', { decision: 'add' }),
        line('by_hand', '5000', { found: false }),
        line('big', '87647', { decision: 'add' }),
        line('prep_tx_big', '90000', { decision: 'add' }),
      ],
    };
    db.account_mappings.push({ id: 'm_sub', engagement_id: eng.id, source_code: 'SUB', source_name: 'Subscriptions', source_type: 'Overheads', balance_p: '0', blynt_code: '4600', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
    db.transactions.push({ id: 'tx_big', engagement_id: eng.id, account_code: 'SUB', account_name: 'Subscriptions', date: eng.period_end, contact: 'Acme', description: 'Annual licence', amount_p: '90000', vat_p: '0', gross_p: '90000', source: 'Xero', external_url: 'https://go.xero.com/x', ref: 'INV-0042' });
    const save = (p: Record<string, any>) => Object.assign(wp.data_json, p);
    render(
      <PrepaymentsSchedule
        data={wp.data_json}
        result={evaluatePaper(wp)!}
        locked={false}
        save={save}
        filesFor={(id) => (id === 'has_invoice' ? [{ id: 'att_1', filename: 'invoice.pdf' } as Attachment] : [])}
        attachTo={() => {}}
        preview={() => {}}
        tickFor={() => null}
        live={() => wp.data_json}
      />
    );
    fireEvent.click(screen.getByText('Search the ledger again'));
    // A line found by an earlier search picks up where its cost opens in Xero
    expect(wp.data_json.prepayments.find((l: any) => l.id === 'prep_tx_big')).toMatchObject({ url: 'https://go.xero.com/x', ref: 'INV-0042', decision: 'add' });
    const ids = wp.data_json.prepayments.map((l: any) => l.id);
    expect(ids).not.toContain('added_small');
    expect(ids).not.toContain('undecided_small');
    expect(ids).toEqual(expect.arrayContaining(['period_entered', 'has_invoice', 'by_hand', 'big']));
    expect(screen.getByText(/2 taken off the list\./)).toBeTruthy();
  });

  it('undoes the decided suggestions in one go, keeping what was entered', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string, extra: Record<string, any>) => ({ id, desc: id, code: '4600', net_p: '87647', method: 'days', start: '2025-01-27', ...extra });
    wp.data_json = {
      ...wp.data_json,
      prepayments: [line('added', { found: true, decision: 'add', end: '2026-01-26' }), line('not', { found: true, decision: 'not' }), line('by_hand', {})],
    };
    render(
      <PrepaymentsSchedule
        data={wp.data_json}
        result={evaluatePaper(wp)!}
        locked={false}
        save={(p) => Object.assign(wp.data_json, p)}
        filesFor={() => []}
        attachTo={() => {}}
        preview={() => {}}
        tickFor={() => null}
        live={() => wp.data_json}
      />
    );
    fireEvent.click(screen.getByText('Undo 2 decided'));
    const [added, not, byHand] = wp.data_json.prepayments;
    expect(added).toMatchObject({ decision: undefined, end: '2026-01-26' });
    expect(not.decision).toBeUndefined();
    expect(byHand.id).toBe('by_hand');
  });

  it('links a found cost to Xero and keeps the AI reading of the costs still to decide', async () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string, extra: Record<string, any>) => ({ id, desc: id, code: '4600', net_p: '87647', method: 'days', start: '2025-01-27', found: true, ...extra });
    wp.data_json = { ...wp.data_json, prepayments: [line('open', { url: 'https://go.xero.com/x', ref: 'INV-0042' }), line('decided', { decision: 'not' })] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'open', from: '2025-01-27', to: '2026-01-26', summary: 'Annual licence, so part runs past the year end.' }] }) });
    render(
      <PrepaymentsSchedule
        data={wp.data_json}
        result={evaluatePaper(wp)!}
        locked={false}
        save={(p) => Object.assign(wp.data_json, p)}
        filesFor={() => []}
        attachTo={() => {}}
        preview={() => {}}
        tickFor={() => null}
        live={() => wp.data_json}
      />
    );
    expect(screen.getByText('INV-0042').getAttribute('href')).toBe('https://go.xero.com/x');
    fireEvent.click(screen.getByText('Read with AI'));
    await waitFor(() => expect(wp.data_json.prepayments[0].ai).toEqual({ from: '2025-01-27', to: '2026-01-26', summary: 'Annual licence, so part runs past the year end.' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/engagements/${eng.id}/ai-prepaid-costs`, expect.objectContaining({ body: JSON.stringify({ ids: ['open'] }) }));
  });
});

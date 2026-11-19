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

  it('does not suggest a cost again when a new pull from Xero has renumbered the ledger', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string, extra: Record<string, any> = {}) => ({ id, desc: 'Acme · Annual licence', code: '4600', invoice_date: eng.period_end, start: eng.period_end, net_p: '90000', method: 'days', found: true, ...extra });
    wp.data_json = {
      ...wp.data_json,
      min_p: '0',
      // The line added before the pull, and the same cost suggested again under its new id
      prepayments: [line('prep_tx_old', { decision: 'add', end: '2027-01-26' }), line('prep_tx_new')],
    };
    db.account_mappings.push({ id: 'm_sub', engagement_id: eng.id, source_code: 'SUB', source_name: 'Subscriptions', source_type: 'Overheads', balance_p: '0', blynt_code: '4600', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
    db.transactions.push({ id: 'tx_new', engagement_id: eng.id, account_code: 'SUB', account_name: 'Subscriptions', date: eng.period_end, contact: 'Acme', description: 'Annual licence', amount_p: '90000', vat_p: '0', gross_p: '90000', source: 'Xero', external_url: 'https://go.xero.com/x' });
    const search = () => {
      render(<PrepaymentsSchedule data={wp.data_json} result={evaluatePaper(wp)!} locked={false} save={(p) => Object.assign(wp.data_json, p)} filesFor={() => []} attachTo={() => {}} preview={() => {}} tickFor={() => null} live={() => wp.data_json} />);
      fireEvent.click(screen.getByText(/^Search the ledger/));
      cleanup();
      return wp.data_json.prepayments.filter((l: any) => l.desc === 'Acme · Annual licence');
    };
    // The earlier line stays with its decision and period, and takes the link; the repeat goes
    expect(search()).toEqual([expect.objectContaining({ id: 'prep_tx_old', decision: 'add', end: '2027-01-26', url: 'https://go.xero.com/x' })]);
    // And searching again does not bring it back
    expect(search()).toHaveLength(1);
  });

  it('leaves out a cost the AI read as wholly within the year', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string, to: string) => ({ id, desc: id, code: '4600', net_p: '87647', method: 'days', start: '2025-01-27', found: true, ai: { from: '2025-01-27', to, summary: `${id} reading` } });
    wp.data_json = { ...wp.data_json, scanned_at: '2026-01-01T00:00:00.000Z', prepayments: [line('weekly_rent', eng.period_end), line('annual_licence', '2099-01-26')] };
    const view = () => render(<PrepaymentsSchedule data={wp.data_json} result={evaluatePaper(wp)!} locked={false} save={(p) => Object.assign(wp.data_json, p)} filesFor={() => []} attachTo={() => {}} preview={() => {}} tickFor={() => null} live={() => wp.data_json} />);
    view();
    expect(screen.queryByText('weekly_rent')).toBeNull();
    expect(screen.getByText('annual_licence')).toBeTruthy();
    // The review does not ask for a decision on it either
    expect(evaluatePaper(wp)!.checks.find((c) => c.id === 'found_reviewed')!.detail).toBe('Decide on annual_licence.');
    // It can still be looked at, and accepting the suggestions does not add it
    fireEvent.click(screen.getByText('Show'));
    expect(screen.getByText('weekly_rent')).toBeTruthy();
    fireEvent.click(screen.getByText(/^Accept/));
    expect(wp.data_json.prepayments.map((l: any) => l.decision)).toEqual([undefined, 'add']);
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
    // The name is the link; a found cost has no box to retype it in
    expect(screen.getByText('open').getAttribute('href')).toBe('https://go.xero.com/x');
    expect(screen.queryAllByLabelText('Item')).toHaveLength(0);
    fireEvent.click(screen.getByText('Read with AI'));
    await waitFor(() => expect(wp.data_json.prepayments[0].ai).toEqual({ from: '2025-01-27', to: '2026-01-26', summary: 'Annual licence, so part runs past the year end.' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/engagements/${eng.id}/ai-prepaid-costs`, expect.objectContaining({ body: JSON.stringify({ ids: ['open'] }) }));
  });
});

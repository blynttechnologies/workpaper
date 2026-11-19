import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { PrepaymentsSchedule } from '../components/workpaper/papers/prepayments';
import { prepaymentsJournal } from '../lib/workpapers/prepayments';
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

  it("shows each line's suggestion from the rules and the gate, and accepting all takes only the Ready ones, as suggested", async () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string, ai?: Record<string, any>) => ({ id, desc: id, code: '4600', net_p: '87647', method: 'days', start: '2025-01-27', found: true, ...(ai ? { ai: { from: '', to: '', summary: `${id} reading`, supplier: id, ...ai } } : {}) });
    wp.data_json = {
      ...wp.data_json,
      scanned_at: '2026-01-01T00:00:00.000Z',
      prepayments: [
        line('ready_add', { classification: 'add', confidence: 95, gate: 'ready', source: 'ai' }),
        line('ruled_not', { classification: 'not', confidence: 100, gate: 'ready', source: 'rule', rule_id: 'rule_1' }),
        line('unsure', { classification: 'add', confidence: 75, gate: 'check', source: 'ai' }),
        line('unread'),
      ],
    };
    render(<PrepaymentsSchedule data={wp.data_json} result={evaluatePaper(wp)!} locked={false} save={(p) => Object.assign(wp.data_json, p)} filesFor={() => []} attachTo={() => {}} preview={() => {}} tickFor={() => null} live={() => wp.data_json} />);
    // The one the gate wants checked is not offered in bulk
    expect(screen.getByText('3 suggestions ready')).toBeTruthy();
    // The banner names the ones accepting would add, and says what happens to the other
    expect(screen.getByText(/ready_add · unread read like costs that run past the year end.* 1 will be marked "Not a prepayment" and left out of the journal\./)).toBeTruthy();
    expect(screen.getByText(/AI 75% sure/)).toBeTruthy();
    expect(screen.getAllByText('Check')).toHaveLength(1);
    expect(screen.getByText(/learned rule/)).toBeTruthy();
    // A read keeps what the route says of each line: the reading, the suggestion and where it came from
    const reading = { from: '', to: '', summary: 'Monthly charge.', classification: 'not', confidence: 96, gate: 'ready', source: 'ai', supplier: 'Unread Ltd', model: 'm' };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'unread', ...reading }] }) });
    fireEvent.click(screen.getByText('Read with AI'));
    await waitFor(() => expect(wp.data_json.prepayments[3].ai).toEqual(reading));
    fireEvent.click(screen.getByText(/^Accept/));
    expect(wp.data_json.prepayments.map((l: any) => l.decision)).toEqual(['add', 'not', undefined, 'not']);
  });

  it('does not accept in bulk a suggestion that a rule learned since now contradicts', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const line = (id: string) => ({ id, desc: id, code: '4600', net_p: '87647', method: 'days', start: '2025-01-27', found: true, ai: { from: '', to: '', summary: 's', supplier: 'Acme', classification: 'add', confidence: 95, gate: 'ready', source: 'ai' } });
    wp.data_json = { ...wp.data_json, scanned_at: '2026-01-01T00:00:00.000Z', prepayments: [line('first'), line('second')] };
    // The person said no to the first line from this supplier, which taught the rule; the second still carries the earlier reading
    db.learned_rules = [{ id: 'rule_acme', firm_id: eng.firm_id, client_id: eng.client_id, supplier_name: 'Acme', type: 'prepayment', scope: 'client', pattern: 'supplier:acme', target_value: 'not', created_by: 'usr_admin', created_by_name: 'Admin', created_at: '', times_used: 0, active: true }];
    wp.data_json.prepayments[0].decision = 'not';
    render(<PrepaymentsSchedule data={wp.data_json} result={evaluatePaper(wp)!} locked={false} save={(p) => Object.assign(wp.data_json, p)} filesFor={() => []} attachTo={() => {}} preview={() => {}} tickFor={() => null} live={() => wp.data_json} />);
    expect(screen.queryByText(/suggestions? ready/)).toBeNull();
    expect(wp.data_json.prepayments[1].decision).toBeUndefined();
    // It is still there to decide by hand
    fireEvent.click(screen.getByRole('button', { name: 'Add as prepayment' }));
    expect(wp.data_json.prepayments[1].decision).toBe('add');
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

describe('accrued income tab', () => {
  const day = (pe: string, n: number) => new Date(Date.parse(pe) + n * 86_400_000).toISOString().slice(0, 10);
  const setUp = () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === 'eng_harlow_fy26')!;
    const pe = eng.period_end;
    const wp = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'C-20') ?? db.addWorkpaper(eng.id, 'C-20')!;
    const revenue = db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'I-10') ?? db.addWorkpaper(eng.id, 'I-10')!;
    db.transactions = db.transactions.filter((t) => t.engagement_id !== eng.id);
    db.account_mappings.push({ id: 'm_sal', engagement_id: eng.id, source_code: 'SAL', source_name: 'Sales', source_type: 'Revenue', balance_p: '0', blynt_code: '1000', status: 'confirmed', confidence: 100, method: 'manual', confirmed_by: null, confirmed_at: null } as any);
    const sale = (id: string, date: string, amount_p: string, description: string) =>
      db.transactions.push({ id, engagement_id: eng.id, account_code: 'SAL', account_name: 'Sales', date, contact: 'Brightside', description, amount_p, vat_p: '0', gross_p: amount_p, source: 'Xero', external_url: `https://go.xero.com/${id}` } as any);
    sale('tx_march', day(pe, 10), '-120000', 'March retainer');
    sale('tx_on_revenue', day(pe, 12), '-80000', 'Job 41');
    sale('tx_small', day(pe, 5), '-900', 'Postage recharged');
    sale('tx_in_year', day(pe, -5), '-70000', 'February retainer');
    sale('tx_late', day(pe, 90), '-60000', 'June retainer');
    // The Revenue cut-off has already accrued one of them, under the row number it had before a new pull from Xero
    revenue.data_json = { ...revenue.data_json, cutoff: { items: [{ id: 'tx_before_the_pull', date: day(pe, 12), contact: 'Brightside', desc: 'Job 41', amount_p: '80000', code: '1000', decision: 'accrue' }] } };
    wp.data_json = { ...wp.data_json, min_p: '10000', prepayments: [], accrued_income: [] };
    const view = () => render(<PrepaymentsSchedule data={wp.data_json} result={evaluatePaper(wp)!} locked={false} save={(p) => Object.assign(wp.data_json, p)} filesFor={() => []} attachTo={() => {}} preview={() => {}} tickFor={() => null} live={() => wp.data_json} />);
    return { eng, pe, wp, revenue, view };
  };

  it('searches the ledger for sales invoiced after the year end and asks the AI to read them, like prepayments', async () => {
    const { eng, pe, wp, view } = setUp();
    view();
    fireEvent.click(screen.getByRole('tab', { name: /^Accrued income/ }));
    // What the Revenue paper accrued shows as it is
    expect(screen.getByText('From Revenue')).toBeTruthy();
    fireEvent.click(screen.getByText('Search the ledger'));
    // Only the sale after the year end, over the amount, that Revenue has not decided; its period is left for the invoice to give
    expect(wp.data_json.accrued_income).toEqual([{ id: 'acc_tx_march', desc: 'Brightside · March retainer', code: '1000', invoice_date: day(pe, 10), net_p: '120000', method: 'days', found: true, url: 'https://go.xero.com/tx_march' }]);
    expect(wp.data_json.prepayments).toEqual([]);
    expect(screen.getByText(/2 sales invoiced in the 60 days after the year end; 1 new one to check/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/engagements/${eng.id}/ai-accrued-sales`, expect.objectContaining({ body: JSON.stringify({ ids: ['acc_tx_march'] }) }));
    await waitFor(() => expect(screen.queryByText('Reading the description…')).toBeNull());
  });

  it('accrues the part earned by the year end in the journal, and not twice once the Revenue paper accrues the sale', () => {
    const { pe, wp, revenue, view } = setUp();
    wp.data_json.accrued_income = [
      { id: 'acc_tx_march', desc: 'Brightside · March retainer', code: '1000', invoice_date: day(pe, 10), net_p: '120000', method: 'days', found: true, ai: { from: day(pe, -30), to: pe, summary: 'March retainer.' } },
      { id: 'acc_tx_next', desc: 'Brightside · April retainer', code: '1000', invoice_date: day(pe, 20), net_p: '50000', method: 'days', found: true, ai: { from: day(pe, 1), to: day(pe, 30), summary: 'April retainer.' } },
    ];
    view();
    fireEvent.click(screen.getByRole('tab', { name: /^Accrued income/ }));
    // The sale the AI read as wholly next year is left out, and accepting does not add it
    expect(screen.queryByText('Brightside · April retainer')).toBeNull();
    expect(screen.getByText(/1 sale the AI read as wholly after the year end left out\./)).toBeTruthy();
    fireEvent.click(screen.getByText('Add as accrued income'));
    expect(wp.data_json.accrued_income.map((l: any) => l.decision)).toEqual(['add', undefined]);
    // No period yet, so nothing is accrued and the review asks for it
    expect(evaluatePaper(wp)!.totals.accrued).toBe(80000n);
    // It is the accrued tab's own check that fails, so the review panel shows it on that tab and not on Prepayments
    const check = (id: string) => evaluatePaper(wp)!.checks.find((c) => c.id === id)!;
    expect(check('acc_worked')).toMatchObject({ passed: false, view: 'Accrued income' });
    expect(check('worked')).toMatchObject({ passed: true, view: 'Prepayments' });
    expect(check('mapped').view).toBeUndefined();
    Object.assign(wp.data_json.accrued_income[0], { start: day(pe, -9), end: day(pe, 10) });
    // 10 of the 20 days fall up to the year end
    const r = evaluatePaper(wp)!;
    expect(r.totals.accrued).toBe(80000n + 60000n);
    // The accrual is not in the TB until its journal is sent, so the tie to the TB is open and says why
    expect(check('tb')).toMatchObject({ passed: false, detail: expect.stringContaining('until the journal is sent') });
    const ctx = { engagementId: wp.engagement_id, priorId: null, periodEnd: pe, tb: () => ({ draft: 0n, adjustments: 0n, final: 0n, mapped: true }) };
    expect(prepaymentsJournal(ctx as any, wp.data_json)).toEqual([
      expect.objectContaining({ code: '7300', debit: 60000n, narrative: 'Brightside · March retainer: accrued income' }),
      expect.objectContaining({ code: '1000', credit: 60000n }),
    ]);
    // The Revenue paper then accrues the same sale, renumbered by a new pull from Xero: it is posted by that journal, so this paper drops it
    revenue.data_json.cutoff.items.push({ id: 'tx_march_renumbered', date: day(pe, 10), contact: 'Brightside', desc: 'March retainer', amount_p: '120000', code: '1000', decision: 'accrue' });
    expect(prepaymentsJournal(ctx as any, wp.data_json)).toEqual([]);
    expect(evaluatePaper(wp)!.totals.accrued).toBe(80000n + 120000n);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { db } from '../lib/server/db';
import { evaluatePaper } from '../lib/workpapers/engine';
import { PrepaymentsSchedule } from '../components/workpaper/papers/prepayments';
import type { Attachment } from '../lib/types/models';

afterEach(cleanup);

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
      ],
    };
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
    const ids = wp.data_json.prepayments.map((l: any) => l.id);
    expect(ids).not.toContain('added_small');
    expect(ids).not.toContain('undecided_small');
    expect(ids).toEqual(expect.arrayContaining(['period_entered', 'has_invoice', 'by_hand', 'big']));
    expect(screen.getByText(/2 taken off the list\./)).toBeTruthy();
  });
});

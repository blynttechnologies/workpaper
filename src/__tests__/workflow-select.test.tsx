import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { db } from '../lib/server/db';

let params: Record<string, string> = {};
vi.mock('next/navigation', () => ({ useParams: () => params, useRouter: () => ({ push: () => {} }) }));
vi.mock('../lib/session', () => ({ getActor: () => ({ id: 'usr_test_preparer', name: 'Test Preparer', role: 'preparer', firmId: 'firm_blynt_uk' }) }));

import WorkflowDetailPage from '../app/(dashboard)/engagements/[id]/workflows/[wfId]/page';

afterEach(cleanup);

describe('ticking papers on a workflow', () => {
  const setup = () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.client_id === 'cli_harlow' && e.period_end === '2026-09-30')!;
    eng.status = 'fieldwork';
    db.workpapers = db.workpapers.filter((w) => w.engagement_id !== eng.id);
    db.addWorkpaper(eng.id, 'B-10');
    db.addWorkpaper(eng.id, 'I-10');
    db.engagement_workflows = db.engagement_workflows.filter((w) => w.engagement_id !== eng.id);
    params = { id: eng.id, wfId: 'default' };
    render(<WorkflowDetailPage />);
    return eng;
  };
  const box = (ref: RegExp) => screen.getByRole('checkbox', { name: ref }) as HTMLInputElement;

  it('unticking asks why and moves the paper to not applicable; ticking brings it back', () => {
    const eng = setup();
    const i10 = () => db.workpapers.find((w) => w.engagement_id === eng.id && w.ref === 'I-10')!;
    expect(box(/Use I-10/).checked).toBe(true);

    fireEvent.click(box(/Use I-10/));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No sales this year' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(i10().applicable).toBe(false);
    expect(i10().na_reason).toBe('No sales this year');
    expect(box(/Use I-10/).checked).toBe(false);
    expect(screen.getByText(/Not applicable \(1\)/)).toBeTruthy();

    fireEvent.click(box(/Use I-10/));
    expect(i10().applicable).toBe(true);
    expect(box(/Use I-10/).checked).toBe(true);
    expect(screen.queryByText(/Not applicable \(/)).toBeNull();
  });

  it('cancelling the reason keeps the paper ticked', () => {
    setup();
    fireEvent.click(box(/Use B-10/));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(box(/Use B-10/).checked).toBe(true);
  });

  it('offers one button to sign every paper not yet prepared', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Mark all prepared (2)' })).toBeTruthy();
  });
});

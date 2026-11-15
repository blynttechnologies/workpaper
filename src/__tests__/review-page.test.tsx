import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { db } from '../lib/server/db';

const ENG = 'eng_harlow_fy26';
let role = 'preparer';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ENG }), useRouter: () => ({ push: () => {} }), usePathname: () => `/engagements/${ENG}/review` }));
vi.mock('@/context/CompanyContext', () => ({ useCompany: () => ({ activeEngagement: null, refreshCompanyData: () => {} }) }));
vi.mock('@/lib/session', () => ({ getActor: () => ({ id: 'usr_admin', name: 'Tester', role }) }));

import ReviewPage from '../app/(dashboard)/engagements/[id]/review/page';

afterEach(() => {
  cleanup();
  role = 'preparer';
});

const seedWithNote = () => {
  db.seed(true);
  const wp = db.workpapers.find((w) => w.engagement_id === ENG)!;
  db.comments = db.comments.filter((c) => !db.workpapers.some((w) => w.id === c.workpaper_id && w.engagement_id === ENG));
  db.comments.push({ id: 'c_test', workpaper_id: wp.id, type: 'review_note', status: 'open', body: 'Please agree the closing balance to the bank letter', created_by: 'usr_admin', created_by_name: 'Reviewer', created_at: '2026-11-14T10:00:00Z', replies: [] } as any);
  return wp;
};

describe('review page', () => {
  it('lists open points and tells a preparer who resolves them', async () => {
    const wp = seedWithNote();
    render(<ReviewPage />);
    await screen.findByText('Please agree the closing balance to the bank letter', { selector: 'span' });
    expect(screen.getByRole('button', { name: /^Open 1/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: `Review point on ${wp.ref}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Resolve|Reply and resolve)$/ })).toBeNull();
    expect(screen.getByText(/A reviewer resolves the point/)).toBeTruthy();
  });

  it('lets a reviewer resolve, which clears the open list', async () => {
    role = 'reviewer';
    seedWithNote();
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(screen.getByText(/Nothing open/)).toBeTruthy());
    expect(db.comments.find((c) => c.id === 'c_test')?.status).toBe('resolved');
  });

  it('works the sign-off checks out from the file and keeps the lock off while points are open', async () => {
    const wp = seedWithNote();
    wp.status = 'unreconciled';
    render(<ReviewPage />);
    await screen.findAllByText(wp.ref);
    fireEvent.click(screen.getByRole('tab', { name: /Sign-off and lock/ }));
    const checks = screen.getByRole('region', { name: 'Sign-off checks' });
    const row = (t: string) => within(checks).getByText(new RegExp(t)).closest('li')!;
    expect(row('Review points cleared').textContent).toContain('Not yet');
    expect(row('Schedules agree').textContent).toContain(wp.ref);
    expect(row('Opening balances').textContent).toContain('By hand');
    expect((within(checks).getByRole('button', { name: /Approve file/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

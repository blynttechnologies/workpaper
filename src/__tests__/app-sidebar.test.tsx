import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { db } from '../lib/server/db';

const ENG = 'eng_harlow_fy26';
let path = '/';
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => ({ push: () => {} }) }));
vi.mock('@/context/CompanyContext', () => ({ useCompany: () => ({ activeCompany: null, activeEngagement: null }) }));
vi.mock('@/context/LocaleContext', () => ({ useLocale: () => ({ jurisdiction: { label: 'United Kingdom', currency: 'GBP', frameworkLabel: 'FRS 102' } }) }));

import { AppSidebar } from '../components/layout/AppSidebar';

afterEach(cleanup);

describe('sidebar', () => {
  it('shows only practice and library links outside a client file', () => {
    db.seed(true);
    path = '/';
    render(<AppSidebar />);
    expect(screen.getByRole('navigation', { name: 'Practice' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Library' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Prepare' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
  });

  it('inside a client file, names the client and groups the work, with the review count', () => {
    db.seed(true);
    const eng = db.engagements.find((e) => e.id === ENG)!;
    const client = db.clients.find((c) => c.id === eng.client_id)!;
    const paper = db.workpapers.find((w) => w.engagement_id === ENG)!;
    db.comments = db.comments.filter((c) => !(c.type === 'review_note' && c.status === 'open'));
    db.comments.push({ id: 'c_side', workpaper_id: paper.id, type: 'review_note', status: 'open', body: 'x', created_by: 'u', created_by_name: 'u', created_at: '2026-11-14T10:00:00Z', replies: [] } as any);
    path = `/engagements/${ENG}/review`;
    render(<AppSidebar />);

    expect(screen.getByText('Working on')).toBeTruthy();
    expect(screen.getByRole('link', { name: client.name })).toBeTruthy();
    for (const g of ['Prepare', 'Report', 'Finish']) expect(screen.getByRole('navigation', { name: g })).toBeTruthy();
    const review = within(screen.getByRole('navigation', { name: 'Finish' })).getByRole('link', { name: /Review/ });
    expect(review.getAttribute('aria-current')).toBe('page');
    expect(within(review).getByLabelText('1 open review note')).toBeTruthy();
  });
});

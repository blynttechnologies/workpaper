import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { db } from '../lib/server/db';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));
vi.mock('@/context/CompanyContext', () => ({ useCompany: () => ({ clients: db.clients, setActiveCompanyId: () => {} }) }));
vi.mock('@/context/LocaleContext', () => ({
  useLocale: () => ({ formatDate: (iso: string) => iso.slice(0, 10), jurisdiction: { filingDeadlineLabel: 'Statutory filing' } }),
}));

import PracticeHomePage from '../app/(dashboard)/page';

afterEach(cleanup);

describe('practice dashboard', () => {
  it('lists every active client with its progress, and no workflow cards', () => {
    db.seed(true);
    render(<PracticeHomePage />);
    const list = screen.getByRole('region', { name: 'Clients' });
    for (const c of db.clients.filter((x) => !x.archived_at)) expect(within(list).getByText(c.name)).toBeTruthy();
    expect(screen.queryByText('Workflows')).toBeNull();
  });

  it('counts the papers by where they stand, and every client in exactly one stage', () => {
    db.seed(true);
    render(<PracticeHomePage />);
    const papers = screen.getByRole('region', { name: 'Working papers' });
    const counted = within(papers).getAllByRole('definition').reduce((n, dd) => n + Number(dd.textContent), 0);
    expect(counted).toBeGreaterThan(0);
    expect(within(papers).getByText(new RegExp(`of ${counted}$`))).toBeTruthy();

    const stages = screen.getByRole('list', { name: 'Engagements by stage' });
    const inStages = within(stages).getAllByRole('listitem').reduce((n, li) => n + Number(li.getAttribute('title')!.split(': ')[1]), 0);
    const withEngagement = db.clients.filter((c) => !c.archived_at && db.engagements.some((e) => e.client_id === c.id)).length;
    expect(inStages).toBe(withEngagement);
  });
});

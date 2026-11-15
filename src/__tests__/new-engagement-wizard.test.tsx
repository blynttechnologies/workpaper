import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { db } from '../lib/server/db';

let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/engagements/new',
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock('@/context/CompanyContext', () => ({ useCompany: () => ({ setActiveCompanyId: () => {}, refreshCompanyData: () => {} }) }));

import NewEngagementPage from '../app/(dashboard)/engagements/new/page';

afterEach(() => {
  cleanup();
  query = '';
});

describe('new engagement wizard', () => {
  it('starts as a new client and asks for its name', () => {
    db.seed(true);
    render(<NewEngagementPage />);
    expect(screen.queryByText('New period for')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/name/);
  });

  it('opened from a client, adds a period for that client', () => {
    db.seed(true);
    const client = db.clients.find((c) => !c.archived_at)!;
    query = `client_id=${client.id}`;
    render(<NewEngagementPage />);
    expect(screen.getByText('New period for')).toBeTruthy();
    expect(screen.getByText(client.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New client instead' }));
    expect(screen.queryByText('New period for')).toBeNull();
  });

  it('shows how many papers the entity gives, then moves on to the period', () => {
    db.seed(true);
    render(<NewEngagementPage />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Acme Ltd' } }); // the legal name comes first for a new client
    fireEvent.click(screen.getByRole('radio', { name: /^Partnership/ }));
    expect(screen.getByText(/working papers will be created under UK GAAP\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'Period' })).toBeTruthy();
  });
});

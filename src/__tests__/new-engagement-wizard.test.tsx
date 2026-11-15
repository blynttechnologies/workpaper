import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { db } from '../lib/server/db';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/engagements/new' }));
vi.mock('@/context/CompanyContext', () => ({ useCompany: () => ({ setActiveCompanyId: () => {}, refreshCompanyData: () => {} }) }));

import NewEngagementWizard from '../app/(dashboard)/engagements/new/page';

afterEach(cleanup);

describe('new engagement wizard', () => {
  it('picks an entity, updates the summary and moves on to the period', () => {
    db.seed(true);
    render(<NewEngagementWizard />);
    fireEvent.click(screen.getByRole('radio', { name: /^Partnership/ }));
    const summary = screen.getByText('Your engagement').parentElement!;
    expect(within(summary).getByText('Partnership')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: 'Period' })).toBeTruthy();
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
  });

  it('asks for a name before leaving the first step for a new client', () => {
    db.seed(true);
    render(<NewEngagementWizard />);
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: '__new__' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/name/);
  });
});

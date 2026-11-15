import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

let path = '/';
const push = vi.fn();
const setActiveCompanyId = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => ({ push }) }));
vi.mock('@/context/CompanyContext', () => ({
  useCompany: () => ({
    clients: [
      { id: 'cli_a', name: 'Alpha Ltd', company_no: '01234567', company_type: 'Small company (FRS 102 1A)' },
      { id: 'cli_b', name: 'Beta', company_no: '', company_type: 'Sole trader' },
    ],
    engagements: [
      { id: 'eng_a', client_id: 'cli_a', status: 'planning' },
      { id: 'eng_b', client_id: 'cli_b', status: 'planning' },
    ],
    activeCompany: { id: 'cli_a', name: 'Alpha Ltd', company_no: '01234567', company_type: 'Small company (FRS 102 1A)' },
    setActiveCompanyId,
  }),
}));

import { CompanySelector } from '../components/layout/CompanySelector';

afterEach(() => {
  cleanup();
  push.mockClear();
  setActiveCompanyId.mockClear();
});

const pick = (name: string) => {
  render(<CompanySelector variant="header" />);
  fireEvent.click(screen.getByRole('button', { name: /Alpha Ltd/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
};

describe('switching company in the header', () => {
  it('opens the chosen client on a client page', () => {
    path = '/clients/cli_a';
    pick('Beta');
    expect(setActiveCompanyId).toHaveBeenCalledWith('cli_b');
    expect(push).toHaveBeenCalledWith('/clients/cli_b');
  });

  it('keeps the section but drops the old paper id', () => {
    path = '/engagements/eng_a/workpapers/wp_eng_a_b10';
    pick('Beta');
    expect(push).toHaveBeenCalledWith('/engagements/eng_b/workpapers');
  });

  it('goes to the engagement overview from a workflow', () => {
    path = '/engagements/eng_a/workflows/wf_1';
    pick('Beta');
    expect(push).toHaveBeenCalledWith('/engagements/eng_b');
  });

  it('stays on the new engagement form', () => {
    path = '/engagements/new';
    pick('Beta');
    expect(push).not.toHaveBeenCalled();
  });

  it('shows no empty company number', () => {
    path = '/';
    render(<CompanySelector variant="header" />);
    fireEvent.click(screen.getByRole('button', { name: /Alpha Ltd/ }));
    expect(screen.getByText('Sole trader')).toBeTruthy();
  });
});

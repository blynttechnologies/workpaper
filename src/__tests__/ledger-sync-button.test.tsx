import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { db } from '../lib/server/db';

let path = '/';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('@/context/CompanyContext', () => ({ useCompany: () => ({ activeEngagement: null }) }));

import { LedgerSyncButton } from '../components/layout/LedgerSyncButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (source?: 'xero' | 'quickbooks') => {
  db.seed(true);
  const eng = db.engagements.find((e) => e.client_id === 'cli_harlow' && e.period_end === '2026-09-30')!;
  db.clients.find((c) => c.id === 'cli_harlow')!.data_source = source;
  path = `/engagements/${eng.id}/workpapers/x`;
  render(<LedgerSyncButton />);
  return eng;
};

describe('the Sync button in the header', () => {
  it('only shows for a client connected to Xero or QuickBooks', () => {
    open(undefined);
    expect(screen.queryByRole('button', { name: /Sync/ })).toBeNull();
  });

  it("pulls the open year from the client's Xero and says what changed", async () => {
    const eng = open('xero');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ lineCount: 513, changes: [{}, {}] }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    fireEvent.click(screen.getByRole('button', { name: /Sync Xero/ }));
    expect(await screen.findByText(/Synced with Xero: 513 accounts, 2 changed since the last pull/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/integrations/xero/sync', expect.objectContaining({ method: 'POST', body: JSON.stringify({ engagementId: eng.id }) }));
  });

  it('points to the client page when the connection needs renewing', async () => {
    open('quickbooks');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The QuickBooks connection has expired.', code: 'QBO_RECONNECT' }), { status: 409 })));
    fireEvent.click(screen.getByRole('button', { name: /Sync QuickBooks/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('expired'));
    expect(screen.getByRole('link', { name: /Reconnect on the client page/ }).getAttribute('href')).toBe('/clients/cli_harlow');
  });
});

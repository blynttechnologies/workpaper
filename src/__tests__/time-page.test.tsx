import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import TimeLogPage from '../app/(dashboard)/time/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Midday UTC, so the local day is the same in any UK-ish time zone
const entry = (id: string, client: string, user: string, day: string, minutes: number) => ({
  id,
  firm_id: 'f',
  engagement_id: `eng_${client}`,
  client_name: client,
  user_id: `u_${user}`,
  user_name: user,
  started_at: `${day}T12:00:00.000Z`,
  ended_at: new Date(Date.parse(`${day}T12:00:00.000Z`) + minutes * 60_000).toISOString(),
});

function setup(all: boolean) {
  const entries = [
    entry('1', 'Acme Ltd', 'Poorna', '2026-11-01', 60),
    entry('2', 'Acme Ltd', 'Sri', '2026-11-10', 30),
    entry('3', 'Beta plc', 'Sri', '2026-11-10', 15),
  ];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ all, entries }), { status: 200 })));
  render(<TimeLogPage />);
}

describe('Time log', () => {
  it('totals by client, largest first, with the number of staff', async () => {
    setup(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Total by client' }));
    // The sessions table stays in the page, hidden; the totals table is the visible one
    const table = [...document.querySelectorAll('table')].find((t) => !t.parentElement!.classList.contains('hidden'))!;
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([
      ['Acme Ltd', '2', '2', '1:30:00'], // client, staff, sessions, total
      ['Beta plc', '1', '1', '0:15:00'],
    ]);
  });

  it('filters by date, and the totals follow', async () => {
    setup(true);
    await screen.findByRole('button', { name: 'Total by client' });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-05' } });
    expect(screen.getByText(/across 2 sessions/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-11-09' } });
    expect(screen.getByText(/across 0 sessions/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Any date' }));
    expect(screen.getByText(/across 3 sessions/)).toBeTruthy();
  });

  it('offers total by client but not by staff to someone who sees only their own time', async () => {
    setup(false);
    expect(await screen.findByRole('button', { name: 'Total by client' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Total by staff' })).toBeNull();
  });
});

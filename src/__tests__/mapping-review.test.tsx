import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'eng_harlow_fy26' }), usePathname: () => '/engagements/eng_harlow_fy26/mapping', useRouter: () => ({ push: () => {} }) }));

import { db } from '@/lib/server/db';
import AccountMappingPage from '../app/(dashboard)/engagements/[id]/mapping/page';

const ENG = 'eng_harlow_fy26';
const lines = () => db.account_mappings.filter((m) => m.engagement_id === ENG);

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => db.seed(true));
afterEach(cleanup);

describe('mapping review', () => {
  it('folds confirmed lines into Saved accounts, shown on request', () => {
    const confirmed = lines().filter((m) => m.status === 'confirmed');
    expect(confirmed.length).toBeGreaterThan(0);
    render(<AccountMappingPage />);
    const toggle = screen.getByRole('button', { name: /Saved accounts/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(confirmed[0].source_name)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByText(confirmed[0].source_name).length).toBeGreaterThan(0);
  });

  it('confirms every line suggested for one account at once, and remembers each for the client', () => {
    render(<AccountMappingPage />);
    const panel = screen.getByRole('heading', { name: 'Confirm by account' }).parentElement!.parentElement!;
    const first = within(panel).getAllByRole('button', { name: /^Confirm \d+ lines? as / })[0];
    const code = first.getAttribute('aria-label')!.match(/ as (\S+)/)![1];
    const ids = lines().filter((m) => m.status !== 'confirmed' && m.blynt_code === code).map((m) => m.id);
    fireEvent.click(first);
    const after = lines().filter((m) => ids.includes(m.id));
    expect(after.some((m) => m.status === 'confirmed')).toBe(true);
    const clientId = db.engagements.find((e) => e.id === ENG)!.client_id;
    for (const m of after.filter((x) => x.status === 'confirmed' && x.method !== 'rule')) {
      expect(db.learned_rules.some((r) => r.scope === 'client' && r.client_id === clientId && r.pattern === `code:${m.source_code}` && r.target_value === code)).toBe(true);
    }
  });

  it('works from the keyboard: arrow to a line, Enter confirms it, / goes to search', () => {
    render(<AccountMappingPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Account mapping');
    const firstOpen = document.querySelector('tr[data-row]')!.getAttribute('data-row')!;
    const line = lines().find((m) => m.id === firstOpen)!;
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.querySelector(`tr[data-row="${firstOpen}"]`)!.getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    if (line.blynt_code) expect(lines().find((m) => m.id === firstOpen)!.status).toBe('confirmed');
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement?.id).toBe('mapping-search');
  });

  it('offers other likely accounts under a line that is not yet sure', () => {
    render(<AccountMappingPage />);
    expect(screen.queryAllByLabelText(/^Other suggestions for /).length).toBeGreaterThan(0);
  });
});

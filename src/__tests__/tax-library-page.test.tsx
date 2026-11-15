import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { db } from '../lib/server/db';
import { BUILT_IN_TAX } from '../lib/tax';

vi.mock('@/lib/session', () => ({ getActor: () => ({ id: 'usr_admin', name: 'Admin', role: 'admin' }) }));

import TaxLibraryPage from '../app/(dashboard)/library/tax/page';

afterEach(cleanup);

describe('tax library page', () => {
  it('puts every flat rate business type in a named sector', () => {
    db.seed(true);
    render(<TaxLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: /^Flat rate percentages/ }));
    const section = screen.getByRole('region', { name: /Flat rate percentages/ });
    const types = new Set(BUILT_IN_TAX.filter((t) => t.group === 'Flat rate percentages').map((t) => t.key));
    const rows = within(section).getAllByRole('row').filter((r) => within(r).queryAllByRole('rowheader').length);
    expect(rows.length).toBe(types.size);
    // "Personal and other services" also takes anything not listed; it must hold only the types meant for it
    const other = within(section).getByRole('table', { name: /Personal and other services/ });
    expect(within(other).getAllByRole('rowheader').length).toBe(9);
  });

  it('shows one category at a time when chosen, and all again', () => {
    db.seed(true);
    render(<TaxLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: /^VAT rates/ }));
    expect(screen.getByRole('region', { name: /VAT rates/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: /VAT thresholds/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^All categories/ }));
    expect(screen.getByRole('region', { name: /VAT thresholds/ })).toBeTruthy();
  });

  it('offers a pull from GOV.UK to managers', () => {
    db.seed(true);
    render(<TaxLibraryPage />);
    expect(screen.getByRole('button', { name: 'Pull from GOV.UK' })).toBeTruthy();
  });
});

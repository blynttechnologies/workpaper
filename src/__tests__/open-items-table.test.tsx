import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OpenItemsTable } from '../components/workpaper/OpenItemsTable';

const rows = [
  { ref: '12508', date: '2024-12-31', due: '2025-12-31', days: 1, amount_p: '14773198', total_p: '14773198', payments: [{ date: '2026-07-31', amount_p: '14773198', how: 'payment' as const }] },
  {
    ref: '12704', date: '2025-12-31', due: '2025-12-31', days: 1, amount_p: '1984236', total_p: '3484236',
    payments: [
      { date: '2025-07-22', amount_p: '1000000', how: 'payment' as const },
      { date: '2025-09-08', amount_p: '500000', how: 'payment' as const },
      { date: '2026-08-13', amount_p: '1984236', how: 'payment' as const },
    ],
  },
];

describe('open invoices, laid out like the working spreadsheet', () => {
  it('shows paid date and paid amount; several payments fold into one row that opens', () => {
    render(<OpenItemsTable items={rows} peLabel="31 Dec 2025" title="Open invoices" byDue warnAfter={60} />);
    const one = screen.getByText('12508').closest('tr')!;
    expect(within(one).getByText('31 Jul 2026')).toBeTruthy();
    expect(within(one).getAllByText('147,731.98')).toHaveLength(3); // amount, paid, open

    const many = screen.getByText('12704').closest('tr')!;
    expect(within(many).getAllByText('34,842.36')).toHaveLength(2); // amount, and paid in total
    const toggle = within(many).getByRole('button', { name: /3 payments/ });
    expect(screen.queryByText('22 Jul 2025')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('22 Jul 2025')).toBeTruthy();
    expect(screen.getByText('5,000.00')).toBeTruthy();
    expect(screen.queryByText(/next pull from Xero/)).toBeNull();
    // Fully paid, so nothing overdue; days overdue sit under the due date
    expect(within(many).getAllByText('–').length).toBeGreaterThan(0);
    expect(within(one).getByText(/due 31 Dec 2025 · 1 day overdue/)).toBeTruthy();
  });

  it('overdue is the invoice total less everything paid against it', () => {
    render(
      <OpenItemsTable
        items={[{ ref: '12705', date: '2025-12-31', due: '2026-01-30', days: 0, amount_p: '1103910', total_p: '1103910' }, { ref: '12800', date: '2025-11-01', due: '2025-12-01', days: 31, amount_p: '50000', total_p: '80000', payments: [{ date: '2025-11-20', amount_p: '30000', how: 'payment' }] }]}
        peLabel="31 Dec 2025" title="Open invoices" byDue warnAfter={60}
      />
    );
    expect(within(screen.getByText('12705').closest('tr')!).getAllByText('11,039.10')).toHaveLength(3); // amount, open, overdue
    expect(within(screen.getByText('12705').closest('tr')!).getByText(/not due/)).toBeTruthy();
    expect(within(screen.getByText('12800').closest('tr')!).getAllByText('500.00')).toHaveLength(2); // open at the period end, and still overdue
  });

  it('asks for a fresh pull when the invoices were read before amounts and payments were', () => {
    render(<OpenItemsTable items={[{ ref: '12658', date: '2025-01-01', due: '2025-01-31', days: 335, amount_p: '115755' }]} peLabel="31 Dec 2025" title="Open invoices" byDue warnAfter={60} />);
    expect(screen.getByText(/next pull from Xero/)).toBeTruthy();
  });
});

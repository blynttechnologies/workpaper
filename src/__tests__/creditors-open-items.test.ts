// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { openDebtorItems } from '../lib/server/xero';
import { suppliersFromOpenItems, supplierView } from '../lib/workpapers/creditors';

const PE = '2025-12-31';
const bill = (p: Record<string, unknown>) => ({ Type: 'ACCPAY', Status: 'AUTHORISED', InvoiceID: String(p.InvoiceNumber), Contact: { Name: 'Fuel Direct' }, ...p });

describe("creditors open at the period end, as Xero's Aged Payables shows them", () => {
  const items = openDebtorItems(
    PE,
    null,
    {
      invoices: [
        // A bill from last year still unpaid
        bill({ InvoiceNumber: 'B-100', DateString: '2024-10-01T00:00:00', DueDateString: '2024-10-31T00:00:00', Total: 400, AmountDue: 400 }),
        // Due on the period end, part paid before it and the rest in January
        bill({ InvoiceNumber: 'B-200', Status: 'PAID', DateString: '2025-12-01T00:00:00', DueDateString: '2025-12-31T00:00:00', Total: 900, AmountDue: 0, Payments: [{ DateString: '2025-12-15T00:00:00', Amount: 300 }, { DateString: '2026-01-20T00:00:00', Amount: 600 }] }),
        // Paid long after the window
        bill({ InvoiceNumber: 'B-300', Status: 'PAID', DateString: '2025-12-20T00:00:00', DueDateString: '2026-01-19T00:00:00', Total: 250, AmountDue: 0, Payments: [{ DateString: '2026-06-01T00:00:00', Amount: 250 }] }),
        // A sales invoice is not a creditor
        bill({ InvoiceNumber: 'INV-1', Type: 'ACCREC', DateString: '2025-12-01T00:00:00', AmountDue: 999 }),
      ],
      creditNotes: [{ Type: 'ACCPAYCREDIT', Status: 'AUTHORISED', CreditNoteID: 'c1', CreditNoteNumber: 'SC-1', Contact: { Name: 'Fuel Direct' }, DateString: '2025-12-10T00:00:00', RemainingCredit: 50 }],
      prepayments: [{ Type: 'SPEND-PREPAYMENT', Status: 'AUTHORISED', PrepaymentID: 'p1', Contact: { Name: 'Insurer Ltd' }, DateString: '2025-11-01T00:00:00', RemainingCredit: 120 }],
      overpayments: [],
    },
    'purchases'
  );

  it('reads bills, supplier credits and money paid on account, not sales documents', () => {
    expect(items.map((i) => i.ref).sort()).toEqual(['B-100', 'B-200', 'B-300', 'Prepayment', 'SC-1']);
    expect(items.find((i) => i.ref === 'B-200')).toMatchObject({ amount_p: '60000', total_p: '90000', received_after_p: '60000' });
    expect(items.find((i) => i.ref === 'B-100')?.url).toContain('/AccountsPayable/');
  });

  it('gives one row per supplier with what was owed, paid in the window and days overdue', () => {
    const rows = suppliersFromOpenItems(items, 'eng_none', PE, 60, [{ id: 'keep', name: 'Fuel Direct', ledger_p: '0', statement_p: '95000', paid_after_p: '0', decision: 'leave', reason: 'agreed' }]);
    const fuel = rows.find((r) => r.name === 'Fuel Direct')!;
    // 400 + 600 + 250 - 50 owed; only the January payment falls inside 60 days
    expect(fuel).toMatchObject({ id: 'keep', ledger_p: String(40000 + 60000 + 25000 - 5000), paid_after_p: '60000', statement_p: '95000', decision: 'leave', overdue: true });
    // B-100 was due 31 Oct 2024: 427 days overdue counting the due date; B-200, due on the period end, is 1 day
    expect(fuel.oldest_days).toBe(427);
    expect(fuel.invoices?.find((i) => i.ref === 'B-200')).toMatchObject({ days: 1, due: '2025-12-31' });
    expect(fuel.payments_after).toEqual([expect.objectContaining({ date: '2026-01-20', amount_p: '60000', desc: 'Paid against B-200' })]);
    // Money paid on account is a debit balance, for other debtors
    expect(supplierView(rows.find((r) => r.name === 'Insurer Ltd')!).debit).toBe(true);
  });
});

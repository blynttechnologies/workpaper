// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/server/store', () => ({ syncIn: async () => {}, syncOut: async () => {}, currentVersion: () => 1, hasDatabase: () => false }));

import { openDebtorItems } from '../lib/server/xero';
import { agedFromOpenItems } from '../lib/workpapers/debtors';

const PE = '2025-12-31';
const inv = (p: Record<string, unknown>) => ({ Type: 'ACCREC', Status: 'AUTHORISED', InvoiceID: String(p.InvoiceNumber), Contact: { Name: 'Black Rock Tyres' }, ...p });

describe("debtors open at the period end, as Xero's Aged Receivables shows them", () => {
  const items = openDebtorItems(PE, null, {
    invoices: [
      // Raised last year and still unpaid: one year's transactions never saw it
      inv({ InvoiceNumber: 'INV-0900', DateString: '2024-11-10T00:00:00', DueDateString: '2024-12-10T00:00:00', AmountDue: 1200 }),
      // Paid in full in January: open at the period end, though Xero calls it PAID now
      inv({ InvoiceNumber: 'INV-1500', Status: 'PAID', DateString: '2025-12-01T00:00:00', DueDateString: '2025-12-31T00:00:00', Total: 700, AmountDue: 0, Payments: [{ DateString: '2026-01-12T00:00:00', Amount: 500 }, { DateString: '2025-12-10T00:00:00', Amount: 200 }] }),
      // Paid before the period end: not open
      inv({ InvoiceNumber: 'INV-1400', Status: 'PAID', DateString: '2025-10-01T00:00:00', AmountDue: 0, Payments: [{ DateString: '2025-11-01T00:00:00', Amount: 300 }] }),
      // Part paid by money on account used after the period end
      inv({ InvoiceNumber: 'INV-1501', DateString: '2025-12-20T00:00:00', DueDateString: '2026-01-19T00:00:00', AmountDue: 0, Status: 'PAID', Prepayments: [{ DateString: '2026-01-05T00:00:00', AppliedAmount: 800 }] }),
      // A bill and a draft are not debtors
      inv({ InvoiceNumber: 'BILL-1', Type: 'ACCPAY', AmountDue: 999 }),
      inv({ InvoiceNumber: 'DRAFT-1', Status: 'DRAFT', DateString: '2025-12-01T00:00:00', AmountDue: 999 }),
      // Raised after the period end
      inv({ InvoiceNumber: 'INV-1600', DateString: '2026-01-03T00:00:00', AmountDue: 700 }),
    ],
    creditNotes: [{ Type: 'ACCRECCREDIT', Status: 'AUTHORISED', CreditNoteID: 'cn1', CreditNoteNumber: 'CN-7', Contact: { Name: 'Black Rock Tyres' }, DateString: '2025-12-15T00:00:00', RemainingCredit: 100 }],
    prepayments: [
      // Received in December, used in January: a credit at the period end
      { Type: 'RECEIVE-PREPAYMENT', Status: 'PAID', PrepaymentID: 'pp1', Contact: { Name: 'Card Payments' }, DateString: '2025-12-28T00:00:00', RemainingCredit: 0, Allocations: [{ DateString: '2026-01-05T00:00:00', Amount: 800 }] },
    ],
    overpayments: [],
  });
  const ref = (r: string) => items.find((i) => i.ref === r);

  it('takes every sales invoice open at the period end, however old, with what was paid after it', () => {
    expect(ref('INV-0900')).toMatchObject({ amount_p: '120000', received_after_p: '0', due: '2024-12-10' });
    expect(ref('INV-1500')).toMatchObject({ amount_p: '50000', received_after_p: '50000', received_after_on: '2026-01-12', total_p: '70000' });
    // Every payment on the invoice, oldest first, for the drill-down
    expect(ref('INV-1500')?.payments).toEqual([
      { date: '2025-12-10', amount_p: '20000', how: 'payment' },
      { date: '2026-01-12', amount_p: '50000', how: 'payment' },
    ]);
    expect(ref('INV-1501')).toMatchObject({ amount_p: '80000', received_after_p: '0' });
    for (const r of ['INV-1400', 'BILL-1', 'DRAFT-1', 'INV-1600']) expect(ref(r)).toBeUndefined();
  });

  it('counts credit notes and money on account still unused at the period end as credits', () => {
    expect(ref('CN-7')).toMatchObject({ kind: 'credit note', amount_p: '-10000' });
    expect(items.find((i) => i.kind === 'prepayment')).toMatchObject({ contact: 'Card Payments', amount_p: '-80000' });
  });

  it('ages each customer by days past due at the period end, and keeps decisions', () => {
    const lines = agedFromOpenItems(items, PE, [{ id: 'keep', desc: 'Black Rock Tyres', current_p: '0', d30_p: '0', d60_p: '0', d90_p: '0', after_date_p: '0', decision: 'provide', provision_p: '120000' }]);
    const brt = lines.find((l) => l.desc === 'Black Rock Tyres')!;
    // INV-0900 is over a year overdue; INV-1500 falls due on the period end, so it is 1 to 30 overdue,
    // and INV-1501 after it; the credit note is aged by its own date, 16 days before the period end, as Xero does
    expect(brt).toMatchObject({ id: 'keep', d90_p: '120000', current_p: '80000', d30_p: String(50000 - 10000), d60_p: '0', after_date_p: '50000', decision: 'provide' });
    expect(brt.oldest_days).toBe(387);
    expect(brt.invoices?.find((i) => i.ref === 'INV-1500')).toMatchObject({ due: '2025-12-31', days: 1, total_p: '70000' });
    expect(brt.invoices?.find((i) => i.ref === 'INV-1501')).toMatchObject({ days: 0 });
    expect(brt.receipts).toEqual([expect.objectContaining({ date: '2026-01-12', amount_p: '50000' })]);
    expect(lines.find((l) => l.desc === 'Card Payments')).toMatchObject({ d30_p: '-80000', after_date_p: '0' });
  });

  it('can age by invoice date instead: up to 30 days old, 31 to 60, 61 to 90, over 90', () => {
    const brt = agedFromOpenItems(items, PE, [], 'invoice').find((l) => l.desc === 'Black Rock Tyres')!;
    // INV-1500 is exactly 30 days old, INV-1501 and the credit note younger; INV-0900 is 416 days old
    expect(brt).toMatchObject({ current_p: String(50000 + 80000 - 10000), d30_p: '0', d60_p: '0', d90_p: '120000' });
    expect(brt.oldest_days).toBe(416);
  });
});

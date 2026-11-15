import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import type { DebtorPayment } from '@/lib/types/models';

export interface OpenItemRow {
  ref: string;
  date: string;
  due?: string;
  days: number;
  amount_p: string;
  url?: string;
  total_p?: string;
  payments?: DebtorPayment[];
}

const money = (p: string | bigint) => formatPence(asPence(p), { symbol: '' });

/**
 * Invoices or bills open at the period end, laid out like a working spreadsheet: number, date (and due
 * date), amount, paid date and paid amount (several payments fold into one row that opens), what was open
 * at the period end and how overdue or old it was.
 */
export function OpenItemsTable({ items, peLabel, title, byDue, warnAfter, refLabel = 'Inv #' }: { items: OpenItemRow[]; peLabel: string; title: string; byDue: boolean; warnAfter: number; refLabel?: string }) {
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setOpened((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set(s).add(i)));
  const cell = 'py-1 pr-3';
  const how = (p: DebtorPayment) => (p.how !== 'payment' ? ` (${p.how})` : '');
  return (
    <div className="flex flex-col gap-1">
      <table className="w-full text-[11px]">
        <caption className="text-left font-semibold text-[#4A5878] pb-1">{title}</caption>
        <thead>
          <tr className="text-[10px] text-[#4A5878] text-left">
            <th scope="col" className={`${cell} font-semibold`}>{refLabel}</th>
            <th scope="col" className={`${cell} font-semibold`}>Date</th>
            <th scope="col" className={`${cell} font-semibold text-right`}>Amount</th>
            <th scope="col" className={`${cell} font-semibold`}>Paid date</th>
            <th scope="col" className={`${cell} font-semibold text-right`}>Paid amount</th>
            <th scope="col" className={`${cell} font-semibold text-right`}>Open at {peLabel}</th>
            <th scope="col" className="py-1 font-semibold text-right">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {items.map((inv, i) => {
            const pays = inv.payments ?? [];
            const many = pays.length > 1;
            const open = opened.has(i);
            const paid = pays.reduce((s, p) => s + asPence(p.amount_p), 0n);
            // Still unpaid: the invoice total less everything paid or credited against it, before and after the period end
            const unpaid = inv.total_p ? asPence(inv.total_p) - paid : null;
            const age = byDue ? (inv.days ? `${inv.days} day${inv.days === 1 ? '' : 's'} overdue` : 'not due') : `${inv.days} days old`;
            return (
              <React.Fragment key={i}>
                <tr className="border-t border-[#EEF1F6] align-top">
                  <td className={cell}>
                    {inv.url ? (
                      <a href={inv.url} target="_blank" rel="noreferrer" className="text-[#1D4E89] underline">
                        {inv.ref || 'Invoice'}
                      </a>
                    ) : (
                      inv.ref || 'Invoice'
                    )}
                  </td>
                  <td className={cell}>
                    {ukDate(inv.date)}
                    {/* Only an invoice still owed has a due date worth reading; one read before amounts came in counts as owed */}
                    {(unpaid === null ? asPence(inv.amount_p) > 0n : unpaid > 0n) && (
                      <span className={`block text-[10px] ${inv.days > warnAfter ? 'text-[#B42318]' : 'text-[#4A5878]'}`}>
                        {inv.due ? `due ${ukDate(inv.due)} · ` : ''}
                        {age}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} text-right font-mono`}>{inv.total_p ? money(inv.total_p) : '–'}</td>
                  <td className={cell}>
                    {many ? (
                      <button type="button" onClick={() => toggle(i)} aria-expanded={open} className="inline-flex items-center gap-0.5 text-[#1D4E89] hover:underline">
                        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                        {pays.length} payments
                      </button>
                    ) : pays.length ? (
                      `${ukDate(pays[0].date)}${how(pays[0])}`
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className={`${cell} text-right font-mono`}>{pays.length ? money(paid) : '–'}</td>
                  <td className={`${cell} text-right font-mono`}>{money(inv.amount_p)}</td>
                  <td className={`py-1 text-right font-mono ${unpaid && unpaid > 0n ? 'text-[#B42318] font-bold' : ''}`}>{unpaid ? money(unpaid) : '–'}</td>
                </tr>
                {many &&
                  open &&
                  pays.map((p, k) => (
                    <tr key={k} className="text-[#4A5878]">
                      <td colSpan={3} />
                      <td className={`${cell} pl-4`}>{ukDate(p.date)}{how(p)}</td>
                      <td className={`${cell} text-right font-mono`}>{money(p.amount_p)}</td>
                      <td colSpan={2} />
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {!items.some((i) => i.total_p) && items.some((i) => asPence(i.amount_p) > 0n) && (
        <p className="text-[10px] text-[#6B4700]">Amounts and payments come with the next pull from Xero. Pull again, then refresh, to see them here.</p>
      )}
    </div>
  );
}

import React from 'react';
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

const money = (p: string) => formatPence(asPence(p), { symbol: '' });

/**
 * Invoices or bills open at the period end: date and due date, full amount, every payment (folded
 * when there is more than one), what was open at the period end and how overdue or old it was.
 */
export function OpenItemsTable({ items, peLabel, title, byDue, warnAfter }: { items: OpenItemRow[]; peLabel: string; title: string; byDue: boolean; warnAfter: number }) {
  const payRow = (p: DebtorPayment, k: number) => (
    <span key={k} className="flex justify-between gap-2">
      <span>{ukDate(p.date)}{p.how !== 'payment' ? ` (${p.how})` : ''}</span>
      <span className="font-mono">{money(p.amount_p)}</span>
    </span>
  );
  return (
    <table className="w-full text-[11px]">
      <caption className="text-left font-semibold text-[#4A5878] pb-1">{title}</caption>
      <thead>
        <tr className="text-[10px] text-[#4A5878] text-left">
          <th scope="col" className="py-1 font-semibold">Ref</th>
          <th scope="col" className="py-1 font-semibold">Date</th>
          <th scope="col" className="py-1 font-semibold text-right">Amount</th>
          <th scope="col" className="py-1 pl-3 font-semibold">Paid</th>
          <th scope="col" className="py-1 font-semibold text-right">Open at {peLabel}</th>
          <th scope="col" className="py-1 pl-3 font-semibold">{byDue ? 'Overdue' : 'Age'}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((inv, i) => {
          const pays = inv.payments ?? [];
          return (
            <tr key={i} className="border-t border-[#EEF1F6] align-top">
              <td className="py-1">
                {inv.url ? (
                  <a href={inv.url} target="_blank" rel="noreferrer" className="text-[#1D4E89] underline">
                    {inv.ref || 'Invoice'}
                  </a>
                ) : (
                  inv.ref || 'Invoice'
                )}
              </td>
              <td className="py-1">
                {ukDate(inv.date)}
                {inv.due && <span className="block text-[10px] text-[#4A5878]">due {ukDate(inv.due)}</span>}
              </td>
              <td className="py-1 text-right font-mono">{inv.total_p ? money(inv.total_p) : '–'}</td>
              <td className="py-1 pl-3 min-w-[150px]">
                {pays.length === 0 ? (
                  '–'
                ) : pays.length === 1 ? (
                  payRow(pays[0], 0)
                ) : (
                  <details>
                    <summary className="cursor-pointer text-[#1D4E89]">
                      {pays.length} payments · <span className="font-mono">{money(pays.reduce((s, p) => s + asPence(p.amount_p), 0n).toString())}</span>
                    </summary>
                    {pays.map(payRow)}
                  </details>
                )}
              </td>
              <td className="py-1 text-right font-mono">{money(inv.amount_p)}</td>
              <td className={`py-1 pl-3 ${inv.days > warnAfter ? 'text-[#B42318]' : ''}`}>
                {byDue ? (inv.days ? `${inv.days} day${inv.days === 1 ? '' : 's'}` : 'Not due') : `${inv.days} days old`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

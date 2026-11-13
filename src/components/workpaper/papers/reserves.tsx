'use client';

import React from 'react';
import { formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput } from '../parts';
import type { ScheduleProps } from '../schedules';
import { btnPrimary, btnSecondary, card, CodePicker, contextOf, JournalPanel, money, Pill, SuggestionRow, Tiles } from '../kit';
import { expenseCodes } from '@/lib/workpapers/common';
import { reservesReview } from '@/lib/workpapers/reserves';

export function ReservesSchedule({ data, result, locked, save }: ScheduleProps) {
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = reservesReview(ctx);
  const abs = r.difference < 0n ? -r.difference : r.difference;
  const openingSource = r.entered !== null ? "Entered from last year's accounts" : r.signed !== null ? "Last year's accounts" : r.reMapped ? 'Trial balance (no prior year on file)' : 'Retained earnings not mapped in the TB: enter the figure';
  const rows: { label: string; amount: bigint; source: string; strong?: boolean; opening?: boolean }[] = [
    { label: `At ${ukDate(ctx.periodStart)}`, amount: r.opening, source: openingSource, opening: true },
    ...(r.pya ? [{ label: 'Prior-year adjustment', amount: r.pya, source: data.reason || 'Restated' }] : []),
    { label: 'Profit after tax', amount: r.eq.pat, source: `P&L ${r.eq.taxPosted ? '' : `less the ${formatPence(r.eq.tax)} tax estimate`}` },
    { label: 'Dividends', amount: -r.eq.total, source: 'Share capital and dividends' },
    { label: `At ${ukDate(ctx.periodEnd)}`, amount: r.closing, source: '', strong: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Opening reserves', value: formatPence(r.opening), sub: r.entered !== null ? 'entered' : r.signed !== null ? "from last year's accounts" : r.reMapped ? 'from the trial balance' : 'retained earnings not mapped', tone: !r.reMapped && r.entered === null ? 'warn' : 'plain' },
          { label: 'Opening vs TB', value: r.difference === 0n ? 'Agrees' : formatPence(abs), tone: r.difference === 0n ? 'good' : r.decision ? 'plain' : 'bad', sub: r.difference === 0n ? 'trial balance agrees' : `TB ${r.difference > 0n ? 'higher' : 'lower'} than last year's accounts` },
          { label: 'Profit after tax', value: formatPence(r.eq.pat), sub: 'from the P&L' },
          { label: 'Dividends', value: formatPence(r.eq.total), sub: `${r.eq.tested.length} in the year` },
          { label: 'Distributable reserves', value: formatPence(r.distributable), tone: r.distributable < 0n ? 'bad' : 'plain', sub: 'available for future dividends' },
        ]}
      />

      {r.difference !== 0n && r.signed !== null && r.reMapped && (
        r.decision ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#4A5878]">
            <Pill tone="info">{r.decision === 'this_year' ? 'Taken into this year' : 'Prior-year adjustment'}</Pill>
            {r.decision === 'this_year' && (
              <>
                charged to
                <CodePicker label="Where the difference goes" value={r.code} codes={expenseCodes()} disabled={locked} onChange={(c) => save({ code: c })} />
              </>
            )}
            {r.decision === 'prior_year' && (
              <span className="w-80">
                <TextInput label="Why last year is restated" value={data.reason} disabled={locked} placeholder="Reason for restating (required)" onCommit={(v) => save({ reason: v })} />
              </span>
            )}
            {!locked && (
              <button type="button" className="text-[#1D4E89] underline" onClick={() => save({ decision: undefined })}>
                Undo
              </button>
            )}
          </div>
        ) : (
          <SuggestionRow
            actions={
              !locked && (
                <>
                  <button type="button" className={r.small ? btnPrimary : btnSecondary} onClick={() => save({ decision: 'this_year' })}>
                    Take into this year{r.small ? ' (suggested)' : ''}
                  </button>
                  <button type="button" className={r.small ? btnSecondary : btnPrimary} onClick={() => save({ decision: 'prior_year' })}>
                    Prior-year adjustment{r.small ? '' : ' (suggested)'}
                  </button>
                </>
              )
            }
          >
            The trial balance&apos;s opening retained earnings are {formatPence(abs)} {r.difference > 0n ? 'higher' : 'lower'} than last year&apos;s accounts ({formatPence(r.tbOpening)} against {formatPence(r.signed)}). Something was posted into last year after its accounts were finalised; check the ledger for entries dated before {ukDate(ctx.periodStart)}.{' '}
            {r.small ? 'It is under 5% of profit, so taking it into this year is enough.' : 'It is material, so restating last year may be needed.'}
          </SuggestionRow>
        )
      )}

      <div className={card}>
        <div className="font-bold mb-2">Changes in equity · profit and loss reserve</div>
        <table className="w-full text-[11px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.strong ? 'font-bold border-t border-[#D3DCEE]' : 'border-t border-[#EEF1F6]'}>
                <td className="py-1.5">{row.label}</td>
                <td className="py-1.5 text-[10px] text-[#4A5878]">{row.source}</td>
                <td className="py-1.5 text-right font-mono">
                  {row.opening && !locked ? (
                    <span className="inline-flex items-center gap-2">
                      {r.entered !== null && (
                        <button type="button" className="text-[10px] font-sans text-[#1D4E89] underline" onClick={() => save({ opening_p: '' })}>
                          Use the TB
                        </button>
                      )}
                      <span className="inline-block w-32">
                        <MoneyInput label="Opening reserves" disabled={locked} value={(data.opening_p ?? '') as string} placeholder={formatPence(r.opening, { symbol: '' })} onCommit={(p) => save({ opening_p: p })} />
                      </span>
                    </span>
                  ) : (
                    money(row.amount)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[10px] text-[#4A5878]">Built from the other papers; change a figure there and it updates here. Type the opening figure from last year's accounts to override the trial balance.</div>
      </div>

      <JournalPanel engagementId={result.engagementId} date={ctx.periodEnd} lines={r.lines} sent={data.journal} narrative="Reserves: difference to last year's accounts taken into this year" source="E-20" locked={locked} save={save} empty="No journal needed." />
    </div>
  );
}

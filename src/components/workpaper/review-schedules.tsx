'use client';

import { Fragment } from 'react';
import { asPence, formatPence } from '@/lib/money';
import { analyticalReview, showsAccounts } from '@/lib/workpapers/analytical';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput } from '@/components/workpaper/parts';
import type { ScheduleProps } from '@/components/workpaper/schedules';
import { Tiles } from '@/components/workpaper/kit';

const th = 'p-2 text-[10px] font-bold uppercase tracking-wider text-[#4A5878] whitespace-nowrap';

/* ---------- P&L and balance sheet analytical review ---------- */
const DIVISOR = { pence: 1n, ones: 100n, thousands: 100000n } as const;
type Rounding = keyof typeof DIVISOR;

function shown(p: bigint | null, rounding: Rounding) {
  if (p === null) return '—';
  if (p === 0n) return '-';
  if (rounding === 'pence') return formatPence(p, { accountingFormat: true });
  const size = p < 0n ? -p : p;
  const text = ((size + DIVISOR[rounding] / 2n) / DIVISOR[rounding]).toLocaleString('en-GB');
  return p < 0n ? `(${text})` : text;
}

export function AnalyticalSchedule({ data, result, locked, save, live }: ScheduleProps) {
  const view = result.template.analyticalView ?? 'pl';
  const review = analyticalReview(result.engagementId, view, data);
  const comments: Record<string, string> = data.comments ?? {};
  const rounding: Rounding = data.rounding in DIVISOR ? data.rounding : 'ones';
  const money = (p: bigint | null) => shown(p, rounding);
  const unit = rounding === 'thousands' ? '£000' : '£';
  const figures = 'p-2 text-right font-mono whitespace-nowrap';
  const settingField = 'px-2 py-1.5 border border-[#D3DCEE] rounded-[8px] bg-white';
  const totalCurrent = review.sections.reduce((acc, s) => acc + s.current, 0n);
  const totalPrior = review.hasPrior ? review.sections.reduce((acc, s) => acc + (s.prior ?? 0n), 0n) : null;
  const totalVariance = totalPrior === null ? null : totalCurrent - totalPrior;
  const allRows = review.sections.flatMap((s) => s.blocks.flatMap((b) => b.rows));
  const flaggedCount = allRows.filter((r) => r.significant).length;

  return (
    <div className="flex flex-col gap-3">
      <Tiles
        items={[
          { label: `${view === 'pl' ? 'P&L Total' : 'Net Assets'} (${ukDate(review.periodEnd)})`, value: shown(totalCurrent, rounding) },
          { label: `Prior Year (${review.priorEnd ? ukDate(review.priorEnd) : 'Prior'})`, value: shown(totalPrior, rounding) },
          { label: 'Overall variance', value: shown(totalVariance, rounding), tone: (totalVariance ?? 0n) >= 0n ? 'plain' : 'warn' },
          { label: 'Flagged variances', value: `${flaggedCount} item${flaggedCount === 1 ? '' : 's'}`, tone: flaggedCount === 0 ? 'good' : 'warn', sub: `Threshold: ${data.threshold_pct ?? 10}% / £${data.threshold_p ? formatPence(asPence(data.threshold_p)) : '1,000'}` },
        ]}
      />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 p-3 rounded-[12px] bg-[#F5F8FD] border border-[#E3E7EF] text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Rounding of accounts</span>
          <select aria-label="Rounding of accounts" disabled={locked} value={rounding} onChange={(e) => save({ rounding: e.target.value })} className={settingField}>
            <option value="ones">in ones</option>
            <option value="thousands">in thousands</option>
            <option value="pence">with pence</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 font-semibold">
          <input type="checkbox" disabled={locked} checked={showsAccounts(view, data)} onChange={(e) => save({ show_accounts: e.target.checked })} />
          Show original accounts
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Flag items with a variance ≥ %</span>
          <input
            type="number"
            min={0}
            step="1"
            aria-label="Flag items with a variance of at least this percentage"
            disabled={locked}
            defaultValue={data.threshold_pct ?? 10}
            onBlur={(e) => e.target.value !== String(data.threshold_pct ?? 10) && save({ threshold_pct: e.target.value })}
            className={`w-24 font-mono text-right ${settingField}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Only flag variances ≥ £</span>
          <MoneyInput label="Only flag variances of at least this amount" value={data.threshold_p ?? '100000'} disabled={locked} allowNegative={false} onCommit={(p) => save({ threshold_p: p })} />
        </label>
      </div>

      {review.sections.length === 0 && <p className="text-xs text-[#4A5878]">There are no confirmed figures to review yet. Import the trial balance and confirm the mappings first.</p>}
      {review.sections.length > 0 && !review.hasPrior && <p className="text-xs text-[#4A5878]">There are no prior year figures for this client, so nothing can be compared yet.</p>}

      {review.sections.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-[#122654]">
            <thead>
              <tr className="border-b-2 border-[#A6B4D0]">
                <th className={`${th} text-left`}><span className="sr-only">Account</span></th>
                <th className={`${th} text-right bg-[#F5F8FD]`}>{ukDate(review.periodEnd)}<div className="font-normal normal-case">{unit}</div></th>
                <th className={`${th} text-right`}>{review.priorEnd ? ukDate(review.priorEnd) : 'Prior year'}<div className="font-normal normal-case">{unit}</div></th>
                <th className={`${th} text-right`}>Variance<div className="font-normal normal-case">{unit}</div></th>
                <th className={`${th} text-right`}>%</th>
                <th className={`${th} text-center`}>Flagged</th>
                <th className={`${th} text-left min-w-[220px]`}>Comments</th>
              </tr>
            </thead>
            {review.sections.map((section) => (
              <tbody key={section.heading} className="divide-y divide-[#E3E7EF] border-b-2 border-[#A6B4D0]">
                <tr className="font-bold">
                  <th scope="rowgroup" className="p-2 pt-4 text-left uppercase tracking-wide">{section.heading}</th>
                  <td className={`${figures} pt-4 bg-[#F5F8FD]`}>{money(section.current)}</td>
                  <td className={`${figures} pt-4`}>{money(section.prior)}</td>
                  <td className={`${figures} pt-4`}>{money(section.prior === null ? null : section.current - section.prior)}</td>
                  <td colSpan={3} />
                </tr>
                {section.blocks.map((block, i) => (
                  <Fragment key={block.heading ?? i}>
                    {block.heading && (
                      <tr className="font-semibold">
                        <th scope="row" className="p-2 pl-4 text-left font-semibold">{block.heading}</th>
                        <td className={`${figures} bg-[#F5F8FD]`}>{money(block.current)}</td>
                        <td className={figures}>{money(block.prior)}</td>
                        <td className={figures}>{money(block.prior === null ? null : block.current - block.prior)}</td>
                        <td colSpan={3} />
                      </tr>
                    )}
                    {block.rows.map((r) => {
                      const unexplained = r.significant && !comments[r.key]?.trim();
                      return (
                        <tr key={r.key} className={unexplained ? 'bg-[#FFF8F6]' : ''}>
                          <td className={`p-2 ${block.heading ? 'pl-8' : 'pl-4'}`}>{r.code && <span className="font-mono text-[#4A5878] mr-2">{r.code}</span>}{r.name}</td>
                          <td className={`${figures} bg-[#F5F8FD]`}>{money(r.current)}</td>
                          <td className={figures}>{money(r.prior)}</td>
                          <td className={figures}>{money(r.variance)}</td>
                          <td className={figures}>{r.percent === null ? '—' : `${r.percent > 0 ? '+' : ''}${r.percent.toFixed(2)}%`}</td>
                          <td className="p-2 text-center font-bold text-[#B8432F]">{r.significant ? <span title="Reaches the flag settings">⚑<span className="sr-only">Flagged</span></span> : <span className="font-normal text-[#7E8DA6]">-</span>}</td>
                          <td className="p-2">
                            <TextInput
                              label={`Comment on ${r.name}`}
                              value={comments[r.key] ?? ''}
                              disabled={locked}
                              placeholder={r.significant ? 'Explain this variance' : 'Description'}
                              onCommit={(v) => save({ comments: { ...(live().comments ?? {}), [r.key]: v } })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

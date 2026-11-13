'use client';

import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, CodePicker, contextOf, JournalPanel, money, Pill, SuggestBanner, SuggestionRow, th, Tiles } from '../kit';
import { addDays, chartName } from '@/lib/workpapers/common';
import { cutoffWindow, MICRO_TURNOVER, revenueReview, salesByMonth, VAT_THRESHOLD, type CutoffItem } from '@/lib/workpapers/revenue';
import { db } from '@/lib/server/db';

const pctText = (p: number | null) => (p === null ? 'New' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);

export function RevenueSchedule({ data, result, locked, save, live }: ScheduleProps) {
  const [showAll, setShowAll] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = revenueReview(ctx);
  const sales = salesByMonth(ctx);
  const comments: Record<string, string> = data.comments ?? {};
  const toCodes = db.blynt_accounts.filter((a) => ['1400', '4930', '7980', '7700', '8800'].includes(a.code)).map((a) => ({ code: a.code, name: a.name }));
  const setDecision = (id: string, patch: Record<string, any> | undefined) => save({ nontrading: { ...(live().nontrading ?? {}), [id]: patch ? { ...(live().nontrading?.[id] ?? {}), ...patch } : undefined } });
  const setCut = (id: string, decision: CutoffItem['decision']) => save({ cutoff: { ...(live().cutoff ?? {}), items: (live().cutoff?.items ?? []).map((i: CutoffItem) => (i.id === id ? { ...i, decision } : i)) } });
  const scanCutoff = () => save({ cutoff: { ...(live().cutoff ?? {}), items: cutoffWindow(ctx, live().cutoff?.items ?? []), scanned_at: new Date().toISOString() } });
  const explainNeeded = r.streams.filter((s) => s.material && !s.explained);
  const oddOpen = r.odd.filter((n) => !n.decided);
  const wrongYear = r.cutoff.filter((i) => i.decision === 'accrue' || i.decision === 'defer');
  const max = sales.months.reduce((m, x) => (x.current > m ? x.current : x.prior > m ? x.prior : m), 0n) || 1n;
  const vatOk = r.vat !== null && r.vat === r.after;
  const shownCut = showAll ? r.cutoff : r.cutoff.filter((i) => i.decision !== 'correct');

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Turnover per TB', value: formatPence(r.turnover), sub: r.streams.map((s) => s.code).join(', ') || 'no revenue mapped' },
          { label: 'Change on last year', value: r.prior ? pctText((Number(r.after - r.prior) / Number(r.prior)) * 100) : '–', sub: r.prior !== null ? `after adjustments · last year ${formatPence(r.prior)}` : 'no prior year' },
          { label: 'Turnover vs VAT returns', value: r.vat === null ? 'Not entered' : vatOk ? 'Agrees' : 'Differs', tone: r.vat === null ? 'warn' : vatOk ? 'good' : 'bad', sub: r.vat === null ? 'enter Box 6 below' : `difference ${formatPence(r.after - r.vat)}` },
          { label: 'Cut-off and non-trading items', value: `${oddOpen.length + r.cutoff.filter((i) => !i.decision).length} to decide`, tone: oddOpen.length ? 'warn' : 'plain', sub: `${wrongYear.length} in the wrong year` },
          { label: 'Accounts size', value: r.after <= MICRO_TURNOVER ? 'Micro-entity' : 'Over micro', sub: `turnover ${r.after <= MICRO_TURNOVER ? 'within' : 'over'} £1m` },
        ]}
      />
      <SuggestBanner
        count={explainNeeded.length + oddOpen.length}
        locked={locked}
        onAccept={oddOpen.length ? () => save({ nontrading: { ...(live().nontrading ?? {}), ...Object.fromEntries(oddOpen.map((n) => [n.id, { decision: 'remove', to: n.to }])) } }) : undefined}
        text={[explainNeeded.length && `${explainNeeded.length} movement${explainNeeded.length === 1 ? '' : 's'} to explain`, ...oddOpen.map((n) => `${formatPence(n.amount)} from ${n.contact || n.desc} looks like it is not turnover`)].filter(Boolean).join(' · ') + '.'}
      />

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="font-bold">Turnover by revenue account</span>
          <label className="flex items-center gap-1 text-[11px]">
            Explain movements over
            <input
              type="number"
              min={0}
              aria-label="Explain movements over this percentage"
              disabled={locked}
              defaultValue={r.pct}
              onBlur={(e) => Number(e.target.value) !== r.pct && save({ threshold_pct: Number(e.target.value) })}
              className="w-12 px-1 border border-[#D3DCEE] rounded text-right"
            />
            % and £
            <span className="w-24">
              <MoneyInput label="Explain movements over this amount" value={r.minimum.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ threshold_p: p })} />
            </span>
          </label>
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Stream</th>
              <th className={`${th} text-right`}>This year</th>
              <th className={`${th} text-right`}>Last year</th>
              <th className={`${th} text-right`}>Change</th>
              <th className={`${th} text-right`}>%</th>
              <th className={`${th} text-left`}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1F6]">
            {r.streams.map((s) => (
              <React.Fragment key={s.code}>
                <tr>
                  <td className="p-2">
                    <div className="font-bold">{s.name}</div>
                    <div className="text-[10px] text-[#4A5878]">{s.code}</div>
                  </td>
                  <td className="p-2 text-right font-mono font-bold">{money(s.current)}</td>
                  <td className="p-2 text-right font-mono">{s.prior === null ? '–' : money(s.prior)}</td>
                  <td className={`p-2 text-right font-mono ${s.material ? 'text-[#B8432F] font-bold' : ''}`}>{s.change === null ? '–' : money(s.change)}</td>
                  <td className="p-2 text-right font-mono">{s.change === null ? '–' : pctText(s.percent)}</td>
                  <td className="p-2">{s.material ? s.explained ? <Pill tone="good">Explained</Pill> : <Pill tone="warn">To explain</Pill> : <Pill tone="plain">Within threshold</Pill>}</td>
                </tr>
                {(s.material || comments[s.code]) && (
                  <tr>
                    <td colSpan={6} className="px-2 pb-2">
                      <TextInput label={`Explain the movement on ${s.name}`} value={comments[s.code]} disabled={locked} placeholder="Why it moved, e.g. two larger contracts in July and September" onCommit={(v) => save({ comments: { ...(live().comments ?? {}), [s.code]: v } })} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {r.odd.map((n) => (
              <tr key={n.id}>
                <td colSpan={6} className="p-2">
                  {n.decided ? (
                    <div className="flex items-center gap-2 text-[11px] text-[#4A5878]">
                      {ukDate(n.date)} · {n.contact || n.desc} {formatPence(n.amount)}: {n.decided === 'remove' ? `moved out of turnover to ${n.to} ${chartName(n.to)}` : 'kept as turnover'}
                      {!locked && (
                        <button type="button" className="text-[#1D4E89] underline" onClick={() => setDecision(n.id, undefined)}>
                          Undo
                        </button>
                      )}
                    </div>
                  ) : (
                    <SuggestionRow
                      actions={
                        !locked && (
                          <>
                            <CodePicker label={`Where ${n.contact || n.desc} belongs`} value={n.to} codes={toCodes} disabled={locked} onChange={(c) => setDecision(n.id, { to: c })} />
                            <button type="button" className={btnPrimary} onClick={() => setDecision(n.id, { decision: 'remove', to: n.to })}>
                              Remove from turnover
                            </button>
                            <button type="button" className={btnSecondary} onClick={() => setDecision(n.id, { decision: 'turnover' })}>
                              It is turnover
                            </button>
                          </>
                        )
                      }
                    >
                      {formatPence(n.amount)} on {ukDate(n.date)} from {n.contact || 'an unnamed payer'} ({n.desc}) is in {chartName(n.code)}, but reads like {n.to === '4930' ? 'the sale of an asset, which belongs on the Fixed assets paper' : n.to === '7980' ? 'money from a director, not a sale' : 'other income, not turnover'}.
                    </SuggestionRow>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-bold border-t-2 border-[#122654]/20">
            <tr>
              <td className="p-2">Total · per TB</td>
              <td className="p-2 text-right font-mono">{money(r.turnover)}</td>
              <td className="p-2 text-right font-mono">{r.prior === null ? '–' : money(r.prior)}</td>
              <td className="p-2 text-right font-mono">{r.prior === null ? '–' : money(r.turnover - r.prior)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold">Sales by month</span>
            {sales.hasLedger && (
              <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => setAsTable((v) => !v)}>
                {asTable ? 'Show as chart' : 'Show as table'}
              </button>
            )}
          </div>
          {!sales.hasLedger ? (
            <div className="text-[11px] text-[#7E8DA6]">Needs the sales ledger. Import transactions from the accounting system to see sales month by month.</div>
          ) : asTable ? (
            <table className="w-full text-[11px]">
              <tbody>
                {sales.months.map((m) => (
                  <tr key={m.key} className="border-t border-[#EEF1F6]">
                    <td className="py-0.5">{m.label}</td>
                    <td className="py-0.5 text-right font-mono">{money(m.current)}</td>
                    <td className="py-0.5 text-right font-mono text-[#4A5878]">{money(m.prior)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <div className="flex items-end gap-1 h-32" role="img" aria-label="Sales by month, this year against last year">
                {sales.months.map((m) => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-0.5" title={`${m.label}: ${formatPence(m.current)} this year, ${formatPence(m.prior)} last year`}>
                    <div className="w-full flex items-end gap-px h-28">
                      <div className="flex-1 bg-[#1D4E89] rounded-t" style={{ height: `${Number((m.current * 100n) / max)}%` }} />
                      <div className="flex-1 bg-[#E8913A] rounded-t" style={{ height: `${Number((m.prior * 100n) / max)}%` }} />
                    </div>
                    <span className="text-[9px] text-[#4A5878]">{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-[#4A5878]">
                <span>
                  <span className="inline-block w-2 h-2 bg-[#1D4E89] mr-1" />
                  This year
                </span>
                <span>
                  <span className="inline-block w-2 h-2 bg-[#E8913A] mr-1" />
                  Last year
                </span>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <div className={card}>
            <div className="font-bold mb-2">Turnover vs VAT returns</div>
            <table className="w-full text-[11px]">
              <tbody>
                <tr>
                  <td className="py-1">Turnover after adjustments</td>
                  <td className="py-1 text-right font-mono">{money(r.after)}</td>
                </tr>
                <tr>
                  <td className="py-1">Sales on VAT returns (Box 6, the year&apos;s quarters)</td>
                  <td className="py-1 w-32">
                    <MoneyInput label="Sales on the VAT returns, Box 6" value={data.vat_box6_p} placeholder="Enter Box 6" disabled={locked} allowNegative={false} onCommit={(p) => save({ vat_box6_p: p })} />
                  </td>
                </tr>
                <tr className="font-bold border-t border-[#D3DCEE]">
                  <td className="py-1">Difference</td>
                  <td className="py-1 text-right font-mono">{r.vat === null ? '–' : money(r.after - r.vat)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-1 text-[10px] text-[#4A5878]">Explain a difference (exempt sales, timing of quarters) in the check below; differences are reconciled on the VAT paper.</div>
          </div>
          <div className={card}>
            <div className="font-bold mb-2">Size and thresholds</div>
            <div className="flex justify-between text-[11px] py-0.5">
              <span>Micro-entity: turnover up to £1m</span>
              <Pill tone={r.after <= MICRO_TURNOVER ? 'good' : 'warn'}>{r.after <= MICRO_TURNOVER ? 'Within' : 'Over'}</Pill>
            </div>
            <div className="flex justify-between text-[11px] py-0.5">
              <span>VAT registration: £90,000</span>
              <Pill tone={r.after <= VAT_THRESHOLD ? 'plain' : 'info'}>{r.after <= VAT_THRESHOLD ? 'Under' : 'Over: must be registered'}</Pill>
            </div>
            <div className="mt-1 text-[10px] text-[#4A5878]">Balance sheet total and employee numbers are the other two size tests.</div>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div>
            <div className="font-bold">Cut-off</div>
            <div className="text-[10px] text-[#4A5878]">
              {data.cutoff?.scanned_at
                ? `${r.cutoff.length} sales from ${ukDate(addDays(ctx.periodEnd, -30))} to ${ukDate(addDays(ctx.periodEnd, 60))}. Check each against the job date and mark any in the wrong year.`
                : 'Sales from 30 days before to 60 days after the year end, from the ledger.'}
            </div>
          </div>
          {!locked && (
            <div className="flex items-center gap-2">
              <button type="button" className={btnAdd} onClick={scanCutoff}>
                <RefreshCw className="w-3.5 h-3.5" /> {data.cutoff?.scanned_at ? 'Refresh' : 'List sales either side of the year end'}
              </button>
              {data.cutoff?.scanned_at && (
                <button type="button" className={data.cutoff?.reviewed_at ? btnSecondary : btnPrimary} onClick={() => save({ cutoff: { ...(live().cutoff ?? {}), reviewed_at: live().cutoff?.reviewed_at ? undefined : new Date().toISOString() } })}>
                  {data.cutoff?.reviewed_at ? 'Reopen review' : 'Mark cut-off reviewed'}
                </button>
              )}
            </div>
          )}
        </div>
        {r.cutoff.length > 0 && (
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Date</th>
                <th className={`${th} text-left`}>Item</th>
                <th className={`${th} text-right`}>Net</th>
                <th className={`${th} text-left`}>Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {shownCut.map((i) => {
                const before = i.date <= ctx.periodEnd;
                return (
                  <tr key={i.id} className={i.decision === 'accrue' || i.decision === 'defer' ? 'bg-[#FFF8E6]' : ''}>
                    <td className="p-2 whitespace-nowrap">
                      {ukDate(i.date)} <span className="text-[10px] text-[#4A5878]">{before ? 'before' : 'after'}</span>
                    </td>
                    <td className="p-2">
                      <div className="font-semibold">{i.contact || i.desc}</div>
                      {i.contact && <div className="text-[10px] text-[#4A5878]">{i.desc}</div>}
                    </td>
                    <td className="p-2 text-right font-mono">{formatPence(asPence(i.amount_p), { symbol: '' })}</td>
                    <td className="p-2">
                      {i.decision ? (
                        <span className="flex items-center gap-2">
                          <Pill tone={i.decision === 'correct' ? 'good' : 'info'}>{{ accrue: 'Accrued: work done before the year end', defer: 'Deferred: work after the year end', correct: 'Correct year' }[i.decision]}</Pill>
                          {!locked && (
                            <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => setCut(i.id, undefined)}>
                              Undo
                            </button>
                          )}
                        </span>
                      ) : (
                        !locked && (
                          <span className="flex gap-1">
                            <button type="button" className={btnSecondary} onClick={() => setCut(i.id, 'correct')}>
                              Correct year
                            </button>
                            {before ? (
                              <button type="button" className={btnSecondary} onClick={() => setCut(i.id, 'defer')}>
                                Defer income
                              </button>
                            ) : (
                              <button type="button" className={btnSecondary} onClick={() => setCut(i.id, 'accrue')}>
                                Accrue income
                              </button>
                            )}
                          </span>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {r.cutoff.some((i) => i.decision === 'correct') && (
          <button type="button" className="mt-1 text-[10px] text-[#1D4E89] underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide the ones in the correct year' : `Show all ${r.cutoff.length}`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel engagementId={result.engagementId} date={ctx.periodEnd} lines={r.lines} sent={data.journal} narrative="Revenue: non-trading income and cut-off" source="I-10" locked={locked} save={save} title="Year-end journals" note="Accrued income shows on the Prepayments paper; deferred income on Accruals." />
        <AccountsPreview
          rows={[
            { label: 'Sales per TB', amount: r.turnover },
            { label: 'Not turnover (moved out)', amount: -r.odd.filter((n) => n.decided === 'remove').reduce((a, n) => a + n.amount, 0n) },
            { label: 'Work done, invoiced after the year end', amount: r.cutoff.filter((i) => i.decision === 'accrue').reduce((a, i) => a + asPence(i.amount_p), 0n) },
            { label: 'Invoiced for work not yet done', amount: -r.cutoff.filter((i) => i.decision === 'defer').reduce((a, i) => a + asPence(i.amount_p), 0n) },
            { label: 'Turnover', amount: r.after, strong: true, prior: r.prior },
          ]}
        />
      </div>
    </div>
  );
}

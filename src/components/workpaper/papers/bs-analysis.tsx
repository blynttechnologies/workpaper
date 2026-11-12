'use client';

import React from 'react';
import Link from 'next/link';
import { formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnPrimary, btnSecondary, card, contextOf, money, Pill, th, Tiles } from '../kit';
import { bsAnalysis, MICRO, type BsRow } from '@/lib/workpapers/bs-analysis';

const pctText = (p: number | null) => (p === null ? 'New' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);
const num = (n: number | null, dp = 1) => (n === null ? '–' : n.toFixed(dp));
const met = (v: boolean | null) => (v === null ? <span className="text-[#7E8DA6]">–</span> : v ? <span className="font-bold text-[#0B6B52]">Met</span> : <span className="font-bold text-[#B42318]">Not met</span>);

export function BsAnalysisSchedule({ data, result, locked, save, live }: ScheduleProps) {
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = bsAnalysis(ctx);
  const { a } = r;
  const href = (wpId: string) => `/engagements/${result.engagementId}/workpapers/${wpId}`;
  const done = r.papers.filter((p) => p.done).length;
  const pctOf = (cur: bigint, prior: bigint | null) => (prior ? (Number(cur - prior) / Number(prior < 0n ? -prior : prior)) * 100 : null);
  const total = (label: string, x: { amount: bigint; prior: bigint | null }, strong = true) => (
    <tr className={`${strong ? 'font-bold' : ''} bg-[#F5F8FD]`}>
      <td className="p-2" colSpan={2}>
        {label}
      </td>
      <td className="p-2 text-right font-mono">{money(x.amount)}</td>
      <td className="p-2 text-right font-mono">{x.prior === null ? '–' : money(x.prior)}</td>
      <td className="p-2 text-right font-mono">{x.prior === null ? '–' : money(x.amount - x.prior)}</td>
      <td className="p-2 text-right font-mono">{x.prior === null ? '–' : pctText(pctOf(x.amount, x.prior))}</td>
      <td />
    </tr>
  );
  const sumRows = (rows: BsRow[]) => ({ amount: rows.reduce((s, x) => s + x.amount, 0n), prior: a.hasPrior ? rows.reduce((s, x) => s + (x.prior ?? 0n), 0n) : null });
  const dla = r.dla;
  const s = dla?.s455;
  const gcIndicators = r.indicators;

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Net assets', value: formatPence(a.netAssets.amount), tone: a.netAssets.amount < 0n ? 'bad' : 'plain', sub: a.netAssets.prior !== null ? `${pctText(pctOf(a.netAssets.amount, a.netAssets.prior))} on last year (${formatPence(a.netAssets.prior)})` : 'no prior year' },
          { label: 'Balance sheet', value: r.balances ? 'Balances' : "Doesn't balance", tone: r.balances ? 'good' : 'bad', sub: a.unmappedPence ? `${formatPence(a.unmappedPence)} not mapped yet` : 'net assets = capital and reserves' },
          { label: 'Schedules done', value: `${done} of ${r.papers.length}`, tone: done === r.papers.length && r.papers.length > 0 ? 'good' : 'plain', sub: 'prepared or signed off' },
          {
            label: "Director's loan at year end",
            value: !dla || dla.closing === 0n ? 'Nil' : `${formatPence(dla.closing < 0n ? -dla.closing : dla.closing)} ${dla.closing > 0n ? 'owed' : 'due'}`,
            tone: dla && dla.closing > 0n ? 'warn' : 'plain',
            sub: !dla ? 'no director’s loan paper' : dla.closing > 0n ? (s!.unrepaid ? `s455 ${formatPence(s!.s455)}` : 'by the director · repaid in time') : dla.closing < 0n ? 'to the director' : 'nothing owed either way',
          },
          { label: 'Company size', value: r.microNow === null ? 'To assess' : r.microNow ? 'Micro-entity' : 'Not micro', tone: r.microNow === null ? 'warn' : 'plain', sub: r.microNow === null ? 'enter the employee numbers' : r.microLast === null ? 'this year' : r.microLast === r.microNow ? 'both years' : 'differs from last year' },
        ]}
      />

      <div className={card}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-bold">Balance sheet</span>
          <span className="text-[10px] text-[#4A5878]">Click a schedule to open it. Figures update as the schedules change.</span>
          <label className="ml-auto flex items-center gap-1 text-[11px]">
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
        {!r.rows.length ? (
          <div className="text-[11px] text-[#4A5878]">There are no confirmed figures yet. Import the trial balance and confirm the mappings first.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-[#122654]">
              <thead>
                <tr className="bg-[#F5F8FD]">
                  <th className={`${th} text-left`}>Line</th>
                  <th className={`${th} text-left`}>Schedule</th>
                  <th className={`${th} text-right`}>This year</th>
                  <th className={`${th} text-right`}>Last year</th>
                  <th className={`${th} text-right`}>Change</th>
                  <th className={`${th} text-right`}>%</th>
                  <th className={`${th} text-left min-w-[200px]`}>Explanation</th>
                </tr>
              </thead>
              {r.sections.map((sec) => (
                <tbody key={sec.key} className="divide-y divide-[#EEF1F6]">
                  <tr>
                    <td colSpan={7} className="p-2 pt-3 text-[10px] font-bold uppercase tracking-wider text-[#4A5878]">
                      {sec.label}
                    </td>
                  </tr>
                  {sec.rows.map((x) => {
                    const open = x.material && !r.comments[x.key]?.trim();
                    return (
                      <tr key={x.key} className={open ? 'bg-[#FFFBEF]' : ''}>
                        <td className="p-2">{x.label}</td>
                        <td className="p-2">
                          {x.schedules.length === 0 && <span className="text-[#7E8DA6]">–</span>}
                          {x.schedules.map((p) => (
                            <div key={p.ref} className="flex items-center gap-1.5">
                              {p.wpId ? (
                                <Link href={href(p.wpId)} className="underline text-[#1D4E89]">
                                  {p.title}
                                </Link>
                              ) : (
                                <span className="text-[#4A5878]">{p.title}</span>
                              )}
                              <Pill tone={p.done ? 'good' : p.wpId ? 'warn' : 'plain'}>{p.status}</Pill>
                            </div>
                          ))}
                        </td>
                        <td className="p-2 text-right font-mono font-bold">{money(x.amount)}</td>
                        <td className="p-2 text-right font-mono">{x.prior === null ? '–' : money(x.prior)}</td>
                        <td className={`p-2 text-right font-mono ${x.material ? 'text-[#B8432F] font-bold' : ''}`}>{x.change === null ? '–' : money(x.change)}</td>
                        <td className="p-2 text-right font-mono">{x.change === null ? '–' : pctText(x.percent)}</td>
                        <td className="p-2">
                          {(x.material || r.comments[x.key]) && (
                            <TextInput label={`Explain the movement on ${x.label}`} value={r.comments[x.key]} disabled={locked} placeholder={x.material ? 'Why it moved (required)' : 'Note'} onCommit={(v) => save({ comments: { ...(live().comments ?? {}), [x.key]: v } })} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {sec.key === 'current' && total('Total current assets', sumRows(sec.rows))}
                  {sec.key === 'creditorsShort' && (
                    <>
                      {total('Total creditors due within one year', sumRows(sec.rows))}
                      {total('Net current assets', a.netCurrentAssets)}
                    </>
                  )}
                  {sec.key === 'equity' && (
                    <>
                      {total('Profit for the year, not yet in reserves', a.profit, false)}
                      {total('Total capital and reserves', a.capitalAndReserves)}
                    </>
                  )}
                </tbody>
              ))}
              <tfoot>{total('Net assets', a.netAssets)}</tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Director&apos;s loan account
            {r.dlaWpId && (
              <Link href={href(r.dlaWpId)} className="text-[11px] font-normal underline text-[#1D4E89]">
                Open schedule
              </Link>
            )}
          </div>
          {!dla ? (
            <div className="text-[11px] text-[#4A5878]">No director&apos;s loan paper in this file.</div>
          ) : (
            <>
              <table className="w-full text-[11px]">
                <tbody>
                  <tr>
                    <td className="py-0.5">At {ukDate(ctx.periodStart)}</td>
                    <td className="py-0.5 text-right font-mono">{money(dla.opening)}</td>
                  </tr>
                  {dla.groups
                    .filter((g) => g.total !== 0n)
                    .map((g) => (
                      <tr key={g.key}>
                        <td className="py-0.5">{g.label}</td>
                        <td className="py-0.5 text-right font-mono">{money(g.total)}</td>
                      </tr>
                    ))}
                  <tr className="font-bold border-t border-[#D3DCEE]">
                    <td className="py-0.5">At {ukDate(ctx.periodEnd)}</td>
                    <td className="py-0.5 text-right font-mono">{money(dla.closing)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2 p-2 rounded-[8px] bg-[#F5F8FD] text-[11px] flex flex-col gap-1">
                {s!.overdrawn === 0n ? (
                  <span>Not overdrawn at the year end, so there is no s455.</span>
                ) : (
                  <>
                    <span>
                      {formatPence(s!.repaidAfter)} repaid by {ukDate(s!.nineMonths)}
                      {s!.repaymentsAfter[0] ? ` (first on ${ukDate(s!.repaymentsAfter[0].date)})` : ''}.{s!.bed.length ? ' Some of it was drawn again within 30 days, so it does not count.' : ' Nothing re-drawn within 30 days.'}
                    </span>
                    <span>
                      {s!.unrepaid ? (
                        <>
                          s455 of <strong>{formatPence(s!.s455)}</strong> on {formatPence(s!.unrepaid)}.
                        </>
                      ) : (
                        'Repaid in time, so no s455 tax.'
                      )}
                    </span>
                  </>
                )}
                <span>
                  Highest balance owed in the tax year {formatPence(dla.loan.peak)}: {dla.loan.over ? 'over £10,000, so there is a benefit in kind.' : 'under £10,000, so no benefit in kind.'}
                </span>
              </div>
              {/* shortcut: the s455 decision is made on the director's loan paper; this card only shows it. Move the buttons here if reviewers ask for it. */}
              {s!.overdrawn > 0n && s!.windowOpen && <Pill tone={s!.notRepaid ? 'bad' : s!.unrepaid ? 'warn' : 'good'}>{s!.notRepaid ? 'Marked not repaid' : s!.unrepaid ? 'Decide on the director’s loan paper' : 'Repaid: no s455 tax'}</Pill>}
            </>
          )}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Reserves and dividends <Pill tone={r.unlawful.length ? 'bad' : 'good'}>{r.unlawful.length ? 'Dividends not covered' : 'Reconciles'}</Pill>
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="py-0.5">Profit and loss reserve at {ukDate(ctx.periodStart)}</td>
                <td className="py-0.5 text-right font-mono">{money(r.reserves.opening)}</td>
              </tr>
              {r.reserves.pya !== 0n && (
                <tr>
                  <td className="py-0.5">Prior-year adjustment</td>
                  <td className="py-0.5 text-right font-mono">{money(r.reserves.pya)}</td>
                </tr>
              )}
              <tr>
                <td className="py-0.5">Profit after tax</td>
                <td className="py-0.5 text-right font-mono">{money(r.reserves.eq.pat)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Dividends declared</td>
                <td className="py-0.5 text-right font-mono">{money(-r.reserves.eq.total)}</td>
              </tr>
              <tr className="font-bold border-t border-[#D3DCEE]">
                <td className="py-0.5">At {ukDate(ctx.periodEnd)}</td>
                <td className="py-0.5 text-right font-mono">{money(r.reserves.closing)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-2 p-2 rounded-[8px] bg-[#F5F8FD] text-[11px]">
            Profit after tax is profit before tax of {formatPence(r.reserves.eq.pbt)} less {r.reserves.eq.taxPosted ? 'the tax charge' : `a ${r.reserves.eq.rate}% tax estimate`} of {formatPence(r.reserves.eq.tax)}.{' '}
            {r.unlawful.length ? `${r.unlawful.length} dividend(s) were more than the reserves available when paid.` : r.reserves.eq.tested.length ? 'Each dividend was covered by reserves on the date it was paid.' : 'No dividends in the year.'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="font-bold mb-2">Size test</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#4A5878]">
                <th className="text-left font-semibold">Micro limit</th>
                <th className="text-right font-semibold">This year</th>
                <th className="text-right font-semibold">Last year</th>
                <th className="text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {r.size.map((x) => (
                <tr key={x.key} className="border-t border-[#EEF1F6]">
                  <td className="py-1">{x.label}</td>
                  <td className="py-1 text-right font-mono">{money(x.now ?? 0n)}</td>
                  <td className="py-1 text-right font-mono">{x.last === null ? '–' : money(x.last)}</td>
                  <td className="py-1 text-right">{met(x.metNow)}</td>
                </tr>
              ))}
              <tr className="border-t border-[#EEF1F6]">
                <td className="py-1">Employees up to {MICRO.employees}</td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    aria-label="Average employees this year"
                    disabled={locked}
                    defaultValue={r.staff.now ?? ''}
                    onBlur={(e) => e.target.value !== String(r.staff.now ?? '') && save({ employees: e.target.value })}
                    className="w-14 px-1 border border-[#D3DCEE] rounded text-right font-mono"
                  />
                </td>
                <td className="py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    aria-label="Average employees last year"
                    disabled={locked}
                    defaultValue={r.staff.last ?? ''}
                    onBlur={(e) => e.target.value !== String(r.staff.last ?? '') && save({ employees_prior: e.target.value })}
                    className="w-14 px-1 border border-[#D3DCEE] rounded text-right font-mono"
                  />
                </td>
                <td className="py-1 text-right">{met(r.staffMet.now)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-[#4A5878]">
            {r.microNow === null
              ? 'Enter the average number of employees to finish the test. A company is micro when it meets two of the three limits.'
              : r.microNow
                ? `Micro-entity this year${r.microLast === null ? '' : r.microLast ? ' and last year' : ', but not last year'}${r.microLast ? ', so FRS 105 accounts can be filed.' : '.'}`
                : 'Over the micro-entity limits this year.'}
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Going concern and key ratios {gcIndicators.length ? <Pill tone="warn">{gcIndicators.length} indicator(s)</Pill> : <Pill tone="good">No indicators</Pill>}
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#4A5878]">
                <th className="text-left font-semibold">Measure</th>
                <th className="text-right font-semibold">This year</th>
                <th className="text-right font-semibold">Last year</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Current ratio', (q: typeof r.ratios.now) => num(q.currentRatio, 2)],
                  ['Debtor days', (q: typeof r.ratios.now) => num(q.debtorDays)],
                  ['Creditor days', (q: typeof r.ratios.now) => num(q.creditorDays)],
                  ['Months of overheads in cash', (q: typeof r.ratios.now) => num(q.cashMonths)],
                  ['Net assets', (q: typeof r.ratios.now) => (q.netAssets === null ? '–' : money(q.netAssets))],
                ] as const
              ).map(([label, f]) => (
                <tr key={label} className="border-t border-[#EEF1F6]">
                  <td className="py-1">{label}</td>
                  <td className="py-1 text-right font-mono font-bold">{f(r.ratios.now)}</td>
                  <td className="py-1 text-right font-mono">{r.ratios.last ? f(r.ratios.last) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 p-2 rounded-[8px] bg-[#F5F8FD] text-[11px]">{gcIndicators.length ? `Look at: ${gcIndicators.join('; ')}.` : 'Net assets are positive, current assets cover current liabilities and cash covers at least a month of overheads. No going concern indicators found.'}</div>
          {!locked && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button type="button" className={r.goingConcern === 'none' ? btnPrimary : btnSecondary} aria-pressed={r.goingConcern === 'none'} onClick={() => save({ going_concern: 'none' })}>
                Agree: no indicators
              </button>
              <button type="button" className={r.goingConcern === 'concern' ? btnPrimary : btnSecondary} aria-pressed={r.goingConcern === 'concern'} onClick={() => save({ going_concern: 'concern' })}>
                I have a concern
              </button>
            </div>
          )}
          {r.goingConcern === 'concern' && (
            <div className="mt-2">
              <TextInput label="Going concern: what concerns you" value={data.going_concern_reason} disabled={locked} placeholder="What concerns you, and what the directors plan (required)" onCommit={(v) => save({ going_concern_reason: v })} />
            </div>
          )}
        </div>
      </div>

      <AccountsPreview
        title="How it shows in the accounts · micro-entity format"
        rows={[
          { label: 'Fixed assets', ...sumRows(r.rows.filter((x) => x.section === 'fixed')) },
          { label: 'Current assets', ...sumRows(r.rows.filter((x) => x.section === 'current' || x.section === 'suspense')) },
          { label: 'Creditors: due within one year', ...neg(sumRows(r.rows.filter((x) => x.section === 'creditorsShort'))) },
          { label: 'Net current assets', ...a.netCurrentAssets, strong: true },
          { label: 'Total assets less current liabilities', ...a.totalLessCurrent },
          { label: 'Creditors: due after more than one year', ...neg(sumRows(r.rows.filter((x) => x.section === 'creditorsLong'))) },
          { label: 'Provisions for liabilities', ...neg(sumRows(r.rows.filter((x) => x.section === 'provisions'))) },
          { label: 'Net assets', ...a.netAssets, strong: true },
          { label: 'Capital and reserves', ...a.capitalAndReserves, strong: true },
        ].filter((x) => ('strong' in x && x.strong) || x.amount !== 0n || (x.prior ?? 0n) !== 0n)}
        note={dla && dla.closing > 0n ? "The director's loan is disclosed as an advance to a director, as micro-entity accounts require." : undefined}
      />
    </div>
  );
}

const neg = (x: { amount: bigint; prior: bigint | null }) => ({ amount: -x.amount, prior: x.prior === null ? null : -x.prior });

'use client';

import React, { useState } from 'react';
import { formatPence } from '@/lib/money';
import { TextInput, MoneyInput } from '../parts';
import type { ScheduleProps } from '../schedules';
import { btnPrimary, btnSecondary, card, contextOf, FilterChips, JournalPanel, money, newId, Pill, SuggestBanner, SuggestionRow, th, Tiles } from '../kit';
import { PL_GROUPS, plAnalysis, type PlRow } from '@/lib/workpapers/pl-analysis';

const pctText = (p: number | null) => (p === null ? 'New' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);
const pts = (a: number, b: number) => `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(1)} pts`;

export function PlAnalysisSchedule({ data, result, locked, save, live }: ScheduleProps) {
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const ctx = contextOf(result);
  if (!ctx) return null;
  const a = plAnalysis(ctx);
  const comments: Record<string, string> = data.comments ?? {};
  const misBy = new Map(a.misposts.flatMap((m) => [[m.to.code, m] as const, [m.from.code, m] as const]));
  const explained = (r: PlRow) => !!comments[r.code]?.trim() || (r.tb === 0n && r.adjustments !== 0n && r.sources.length > 0);
  const attention = (r: PlRow) => (r.material && !explained(r) && !misBy.has(r.code)) || (misBy.has(r.code) && !misBy.get(r.code)!.decision);
  const shown = a.rows.filter((r) => filter === 'all' || attention(r));
  const setMis = (id: string, patch: Record<string, any> | undefined) => save({ misposts: { ...(live().misposts ?? {}), [id]: patch ? { ...(live().misposts?.[id] ?? {}), ...patch } : undefined } });
  const ask = (r: PlRow) => save({ questions: [...(live().questions ?? []), { id: newId('q'), code: r.code, text: `Please explain the movement on ${r.name}: ${money(r.prior ?? 0n)} last year, ${money(r.current)} this year.` }] });
  const openMis = a.misposts.filter((m) => !m.decision);
  const adjustments = a.now.pbt - a.before.pbt;
  const journalsFrom = new Set(a.rows.flatMap((r) => r.sources));
  const status = (r: PlRow) => {
    const m = misBy.get(r.code);
    if (m) return m.decision === 'move' ? <Pill tone="info">Moved</Pill> : m.decision === 'leave' ? <Pill tone="plain">Left</Pill> : m.to.code === r.code ? <Pill tone="warn">Possible misposting</Pill> : <Pill tone="plain">See {m.to.name}</Pill>;
    if (!r.material) return <Pill tone="plain">Within threshold</Pill>;
    if (r.tb === 0n && r.adjustments !== 0n) return <Pill tone="good">Explained by schedule</Pill>;
    return comments[r.code]?.trim() ? <Pill tone="good">Explained</Pill> : <Pill tone="warn">To explain</Pill>;
  };
  const sub = (label: string, cur: bigint, tb: bigint, prior: bigint | null, strong = true) => (
    <tr className={`${strong ? 'font-bold' : ''} bg-[#F5F8FD]`}>
      <td className="p-2">{label}</td>
      <td className="p-2 text-right font-mono">{money(tb)}</td>
      <td className="p-2 text-right font-mono">{money(cur - tb)}</td>
      <td className="p-2 text-right font-mono">{money(cur)}</td>
      <td className="p-2 text-right font-mono">{prior === null ? '–' : money(prior)}</td>
      <td className="p-2 text-right font-mono">{prior === null ? '–' : money(cur - prior)}</td>
      <td className="p-2 text-right font-mono">{prior ? pctText((Number(cur - prior) / Number(prior < 0n ? -prior : prior)) * 100) : '–'}</td>
      <td className="p-2 text-right font-mono">{a.now.turnover ? `${((Number(cur) / Number(a.now.turnover)) * 100).toFixed(1)}%` : '–'}</td>
      <td />
    </tr>
  );
  const micro = (t: typeof a.now | null) => {
    if (!t) return null;
    const by = (f: (r: PlRow) => boolean, v: (r: PlRow) => bigint | null) => a.rows.filter(f).reduce((s, r) => s + (v(r) ?? 0n), 0n);
    return { by };
  };
  const m = micro(a.now)!;
  const microRows = [
    { label: 'Turnover', f: (r: PlRow) => r.group === 'turnover', neg: false },
    { label: 'Other income', f: (r: PlRow) => r.group === 'other', neg: false },
    { label: 'Cost of raw materials and consumables', f: (r: PlRow) => r.group === 'cos', neg: true },
    { label: 'Staff costs', f: (r: PlRow) => /^3/.test(r.code), neg: true },
    { label: 'Depreciation', f: (r: PlRow) => r.code === '492', neg: true },
    { label: 'Other charges', f: (r: PlRow) => (r.group === 'overheads' && !/^3/.test(r.code) && r.code !== '492') || r.group === 'finance', neg: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Profit before tax', value: formatPence(a.now.pbt), sub: a.last ? `${pctText(a.last.pbt ? (Number(a.now.pbt - a.last.pbt) / Number(a.last.pbt < 0n ? -a.last.pbt : a.last.pbt)) * 100 : null)} on last year (${formatPence(a.last.pbt)})` : 'no prior year' },
          { label: 'Gross margin', value: a.ratios.now ? `${a.ratios.now.gm.toFixed(1)}%` : '–', tone: a.ratios.now && a.ratios.last && a.ratios.now.gm < a.ratios.last.gm ? 'warn' : 'plain', sub: a.ratios.now && a.ratios.last ? `${pts(a.ratios.now.gm, a.ratios.last.gm)} on last year` : '' },
          { label: 'Adjustments from schedules', value: `${adjustments >= 0n ? '+' : ''}${formatPence(adjustments)}`, sub: `effect on profit, from ${journalsFrom.size} source${journalsFrom.size === 1 ? '' : 's'}` },
          { label: 'Lines needing attention', value: `${a.rows.filter(attention).length} to deal with`, tone: a.rows.some(attention) ? 'warn' : 'good', sub: `of ${a.rows.length} lines · threshold ${a.pct}% and ${formatPence(a.minimum)}` },
          { label: 'Questions for the client', value: a.questions.length ? String(a.questions.length) : 'None', sub: a.questions.length ? 'in one list below' : 'nothing to ask yet' },
        ]}
      />
      <SuggestBanner
        count={openMis.length}
        locked={locked}
        onAccept={() => save({ misposts: { ...(live().misposts ?? {}), ...Object.fromEntries(openMis.map((x) => [x.id, { decision: 'move' }])) } })}
        text={`${a.rows.length - a.rows.filter(attention).length} of ${a.rows.length} lines need nothing from you. ${openMis.map((x) => `${x.to.name} looks like it was posted to ${x.from.name}`).join('; ')}.`}
      />

      <div className={card}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-bold">Profit and loss</span>
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { key: 'all', label: 'All lines', count: a.rows.length },
              { key: 'attention', label: 'Needs attention', count: a.rows.filter(attention).length },
            ]}
          />
          <label className="ml-auto flex items-center gap-1 text-[11px]">
            Explain movements over
            <input
              type="number"
              min={0}
              aria-label="Explain movements over this percentage"
              disabled={locked}
              defaultValue={a.pct}
              onBlur={(e) => Number(e.target.value) !== a.pct && save({ threshold_pct: Number(e.target.value) })}
              className="w-12 px-1 border border-[#D3DCEE] rounded text-right"
            />
            % and £
            <span className="w-24">
              <MoneyInput label="Explain movements over this amount" value={a.minimum.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ threshold_p: p })} />
            </span>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-[#122654]">
            <thead>
              <tr className="bg-[#F5F8FD]">
                <th className={`${th} text-left`}>Line</th>
                <th className={`${th} text-right`}>Per TB</th>
                <th className={`${th} text-right`}>Adjustments</th>
                <th className={`${th} text-right`}>This year</th>
                <th className={`${th} text-right`}>Last year</th>
                <th className={`${th} text-right`}>Change</th>
                <th className={`${th} text-right`}>%</th>
                <th className={`${th} text-right`}>% of sales</th>
                <th className={`${th} text-left`}>Status</th>
              </tr>
            </thead>
            {PL_GROUPS.map((g) => {
              const rows = shown.filter((r) => r.group === g.key);
              const all = a.rows.filter((r) => r.group === g.key);
              if (!all.length) return null;
              return (
                <tbody key={g.key} className="divide-y divide-[#EEF1F6]">
                  <tr>
                    <td colSpan={9} className="p-2 pt-3 text-[10px] font-bold uppercase tracking-wider text-[#4A5878]">
                      {g.label}
                    </td>
                  </tr>
                  {rows.map((r) => {
                    const mp = misBy.get(r.code);
                    return (
                      <React.Fragment key={r.code}>
                        <tr className={attention(r) ? 'bg-[#FFFBEF]' : ''}>
                          <td className="p-2">
                            <div>
                              {r.name} <span className="text-[#7E8DA6] font-mono">{r.code}</span>
                            </div>
                            {r.sources.length > 0 && <div className="text-[10px] text-[#6B3FA0]">{r.sources.join(' · ')}{r.proposed ? ' (proposed)' : ''}</div>}
                          </td>
                          <td className="p-2 text-right font-mono">{money(r.tb)}</td>
                          <td className={`p-2 text-right font-mono ${r.adjustments ? 'text-[#6B3FA0]' : ''}`}>{r.adjustments ? `${r.adjustments > 0n ? '+' : ''}${formatPence(r.adjustments, { symbol: '' })}` : '–'}</td>
                          <td className="p-2 text-right font-mono font-bold">{money(r.current)}</td>
                          <td className="p-2 text-right font-mono">{r.prior === null ? '–' : money(r.prior)}</td>
                          <td className={`p-2 text-right font-mono ${r.material ? 'text-[#B8432F] font-bold' : ''}`}>{r.change === null ? '–' : money(r.change)}</td>
                          <td className="p-2 text-right font-mono">{r.change === null ? '–' : pctText(r.percent)}</td>
                          <td className="p-2 text-right font-mono">{r.ofSales === null ? '–' : `${r.ofSales.toFixed(1)}%`}</td>
                          <td className="p-2">{status(r)}</td>
                        </tr>
                        {mp && mp.to.code === r.code && (
                          <tr>
                            <td colSpan={9} className="px-2 pb-2">
                              {!mp.decision ? (
                                <SuggestionRow
                                  actions={
                                    !locked && (
                                      <>
                                        <button type="button" className={btnPrimary} onClick={() => setMis(mp.id, { decision: 'move' })}>
                                          Move {formatPence(mp.amount)} to {r.name}
                                        </button>
                                        <button type="button" className={btnSecondary} onClick={() => setMis(mp.id, { decision: 'leave' })}>
                                          Leave as it is
                                        </button>
                                      </>
                                    )
                                  }
                                >
                                  {r.name} fell by {formatPence(-(r.change ?? 0n))} while {mp.from.name} rose by {formatPence(mp.from.change ?? 0n)}. It looks like this year&apos;s {r.name.toLowerCase()} was posted to {mp.from.name}.
                                </SuggestionRow>
                              ) : (
                                <div className="flex items-center gap-2 text-[11px] text-[#4A5878]">
                                  {mp.decision === 'move' ? `${formatPence(mp.amount)} moved from ${mp.from.name} to ${r.name}.` : 'Left as it is.'}
                                  {mp.decision === 'leave' && (
                                    <span className="w-72">
                                      <TextInput label={`Why ${r.name} stays as it is`} value={mp.reason} disabled={locked} placeholder="Reason (required)" onCommit={(v) => setMis(mp.id, { reason: v })} />
                                    </span>
                                  )}
                                  {!locked && (
                                    <button type="button" className="text-[#1D4E89] underline" onClick={() => setMis(mp.id, undefined)}>
                                      Undo
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        {((r.material && !misBy.has(r.code) && !(r.tb === 0n && r.adjustments !== 0n)) || comments[r.code]) && (
                          <tr>
                            <td colSpan={9} className="px-2 pb-2">
                              <div className="flex items-center gap-2">
                                <span className="flex-1">
                                  <TextInput label={`Explain the movement on ${r.name}`} value={comments[r.code]} disabled={locked} placeholder="Why it moved" onCommit={(v) => save({ comments: { ...(live().comments ?? {}), [r.code]: v } })} />
                                </span>
                                {!locked && !a.questions.some((q) => q.code === r.code) && (
                                  <button type="button" className={btnSecondary} onClick={() => ask(r)}>
                                    Ask the client
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {g.key === 'cos' && sub('Gross profit', a.now.gross, a.before.gross, a.last?.gross ?? null)}
                  {g.key === 'overheads' && sub('Total overheads', a.now.overheads, a.before.overheads, a.last?.overheads ?? null)}
                </tbody>
              );
            })}
            <tfoot>{sub('Profit before tax', a.now.pbt, a.before.pbt, a.last?.pbt ?? null)}</tfoot>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="font-bold mb-2">Key ratios</div>
          {a.ratios.now ? (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[#4A5878]">
                  <th className="text-left font-semibold">Ratio</th>
                  <th className="text-right font-semibold">This year</th>
                  <th className="text-right font-semibold">Last year</th>
                  <th className="text-right font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Gross margin', 'gm'],
                    ['Overheads as % of sales', 'overheads'],
                    ['Profit before tax margin', 'pbt'],
                  ] as const
                ).map(([label, k]) => (
                  <tr key={k} className="border-t border-[#EEF1F6]">
                    <td className="py-1">{label}</td>
                    <td className="py-1 text-right font-mono font-bold">{a.ratios.now![k].toFixed(1)}%</td>
                    <td className="py-1 text-right font-mono">{a.ratios.last ? `${a.ratios.last[k].toFixed(1)}%` : '–'}</td>
                    <td className="py-1 text-right font-mono">{a.ratios.last ? pts(a.ratios.now![k], a.ratios.last[k]) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[11px] text-[#7E8DA6]">Needs turnover in the trial balance.</div>
          )}
        </div>
        <div className={card}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-bold">Questions for the client</span>
            <span className="text-[10px] text-[#4A5878]">One list, sent once</span>
          </div>
          {a.questions.length === 0 && <div className="text-[11px] text-[#7E8DA6]">No questions yet. Use &quot;Ask the client&quot; on any line and it is added here, so the client gets one list instead of several emails.</div>}
          {a.questions.map((q, i) => (
            <div key={q.id} className="flex items-start gap-2 py-1 border-t border-[#EEF1F6]">
              <span className="text-[#4A5878]">{i + 1}.</span>
              <span className="flex-1">
                <TextInput label={`Question ${i + 1}`} value={q.text} disabled={locked} onCommit={(v) => save({ questions: (live().questions ?? []).map((x: any) => (x.id === q.id ? { ...x, text: v } : x)) })} />
              </span>
              {!locked && (
                <button type="button" className="text-[10px] text-[#B42318] underline" onClick={() => save({ questions: (live().questions ?? []).filter((x: any) => x.id !== q.id) })}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {a.questions.length > 0 && (
            <button type="button" className={`${btnSecondary} mt-2`} onClick={() => navigator.clipboard?.writeText(a.questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n'))}>
              Copy the list
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel
          engagementId={result.engagementId}
          date={ctx.periodEnd}
          lines={a.lines}
          sent={data.journal}
          narrative="P&L analysis: costs posted to the wrong line"
          source="Z-30"
          locked={locked}
          save={save}
          title="Year-end journals"
          empty="Nothing from this paper yet. The adjustments from the other papers are already in the Adjustments column and are posted from those papers."
        />
        <div className={card}>
          <div className="font-bold mb-2">How it shows in the accounts · micro-entity format</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#4A5878]">
                <th />
                <th className="text-right font-semibold">This year</th>
                <th className="text-right font-semibold">Last year</th>
              </tr>
            </thead>
            <tbody>
              {microRows.map((x) => {
                const cur = m.by(x.f, (r) => r.current);
                const pri = a.last ? m.by(x.f, (r) => r.prior) : null;
                return (
                  <tr key={x.label}>
                    <td className="py-1">{x.label}</td>
                    <td className="py-1 text-right font-mono">{money(x.neg ? -cur : cur)}</td>
                    <td className="py-1 text-right font-mono">{pri === null ? '–' : money(x.neg ? -pri : pri)}</td>
                  </tr>
                );
              })}
              <tr className="font-bold border-t border-[#D3DCEE]">
                <td className="py-1">Profit before tax</td>
                <td className="py-1 text-right font-mono">{money(a.now.pbt)}</td>
                <td className="py-1 text-right font-mono">{a.last ? money(a.last.pbt) : '–'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

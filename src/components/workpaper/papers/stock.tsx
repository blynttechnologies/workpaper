'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { formatPence, formatPenceInput } from '@/lib/money';
import { db } from '@/lib/server/db';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, FilterChips, JournalPanel, money, newId, Pill, SuggestBanner, SuggestionRow, th, Tiles } from '../kit';
import { CATEGORIES, stockJournal, stockView, type StockLine } from '@/lib/workpapers/stock';

const pct = (bp: bigint | undefined) => (bp === undefined ? '–' : `${(Number(bp) / 100).toFixed(1)}%`);

export function StockSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const [filter, setFilter] = useState<'all' | 'action' | 'flagged'>('all');
  const eng = db.engagements.find((e) => e.id === result.engagementId);
  const pe = eng?.period_end ?? '';
  const tot = (k: string) => result.totals[k] ?? 0n;
  const views = ((data.lines ?? []) as StockLine[]).map(stockView);
  const lines = stockJournal(tot('closing'), tot('ledger'));
  const setLine = (id: string, patch: Partial<StockLine>) => save({ lines: (live().lines ?? []).map((l: StockLine) => (l.id === id ? { ...l, ...patch } : l)) });
  const add = (category: StockLine['category']) => save({ lines: [...(live().lines ?? []), { id: newId('stk'), desc: '', category, qty: '0', unit_cost_p: '0' }] });
  const pending = views.flatMap((v) => v.suggestions.map((s) => ({ v, s })));
  const acceptAll = () =>
    save({
      lines: (live().lines ?? []).map((l: StockLine) => {
        const v = stockView(l);
        return { ...l, ...(v.costHigh && !l.decision_cost ? { decision_cost: 'revalue' } : {}), ...(v.nrvLow && !l.decision_nrv ? { decision_nrv: 'write_down' } : {}) };
      }),
    });
  const needsAction = (v: (typeof views)[number]) => v.suggestions.length > 0 || v.status === 'support' || !!v.l.unclear;
  const shown = views.filter((v) => (filter === 'action' ? needsAction(v) : filter === 'flagged' ? v.costHigh || v.nrvLow : true));
  const sheet = filesFor('count_sheet');
  const diff = tot('closing') - tot('ledger');
  const vouchedPct = tot('counted') > 0n ? Number((tot('vouched') * 100n) / tot('counted')) : 0;
  const moveBp = result.totals.margin_after_bp !== undefined && result.totals.margin_prior_bp !== undefined ? result.totals.margin_after_bp - result.totals.margin_prior_bp : undefined;

  const check = (v: (typeof views)[number]) =>
    v.nrvLow ? (
      <Pill tone={v.l.decision_nrv === 'write_down' ? 'info' : 'warn'}>{v.l.decision_nrv === 'write_down' ? 'Written down' : 'NRV below cost'}</Pill>
    ) : v.costHigh ? (
      <Pill tone={v.l.decision_cost === 'revalue' ? 'info' : 'warn'}>{v.l.decision_cost === 'revalue' ? 'Revalued' : 'Cost too high'}</Pill>
    ) : v.invoice !== null ? (
      <Pill tone="good">Cost agreed</Pill>
    ) : filesFor(v.l.id).length ? (
      <Pill tone="good">Costing on file</Pill>
    ) : (
      <Pill tone="info">Cost to support</Pill>
    );

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Count vs ledger', value: diff === 0n ? 'Agrees' : `${formatPence(diff < 0n ? -diff : diff)} ${diff > 0n ? 'higher' : 'lower'}`, tone: diff === 0n ? 'good' : 'bad', sub: `count vs ledger ${formatPence(tot('ledger'))}` },
          { label: 'Unit costs vouched', value: `${vouchedPct}%`, sub: 'of value, to invoices or costings' },
          { label: 'Slow-moving or over cost', value: formatPence(tot('flagged')), tone: tot('flagged') ? 'warn' : 'plain', sub: `${views.filter((v) => v.suggestions.length).length} lines to decide` },
          { label: 'Gross margin', value: pct(result.totals.margin_after_bp), sub: result.totals.margin_prior_bp !== undefined ? `Prior year ${pct(result.totals.margin_prior_bp)} · ${moveBp! >= 0n ? '+' : ''}${(Number(moveBp) / 100).toFixed(1)} pts` : 'no prior year' },
          { label: 'Closing stock', value: formatPence(tot('closing')), sub: tot('write_downs') ? `after ${formatPence(tot('write_downs'))} of write-downs` : 'at cost, no write-downs yet' },
        ]}
      />
      <SuggestBanner
        count={pending.length}
        locked={locked}
        onAccept={acceptAll}
        text={pending.map(({ v, s }) => `${s.kind === 'revalue' ? 'revalue' : 'write down'} ${v.l.desc} (−${formatPence(s.amount)})`).join(' · ') + '. Then one closing stock journal brings the ledger into line.'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div
          className={`${card} flex items-center gap-2`}
          onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = Array.from(e.dataTransfer.files ?? []);
            if (f.length && !locked && dropFiles) dropFiles(f, 'count_sheet');
          }}
        >
          {sheet.length ? (
            <RowFiles files={sheet} onPreview={preview} onAttach={() => attachTo('count_sheet')} disabled={locked} label="the count sheet" />
          ) : (
            !locked && (
              <button type="button" onClick={() => attachTo('count_sheet')} className="inline-flex items-center gap-1 text-[11px] font-bold">
                <Upload className="w-3.5 h-3.5" /> Attach the count sheet ({ukDate(pe)})
              </button>
            )
          )}
          <span className="text-[10px] text-[#4A5878]">{views.length} lines entered</span>
        </div>
        <div className="ml-auto">
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { key: 'all', label: 'All lines', count: views.length },
              { key: 'action', label: 'Needs action', count: views.filter(needsAction).length },
              { key: 'flagged', label: 'Cost or NRV flagged', count: views.filter((v) => v.costHigh || v.nrvLow).length },
            ]}
          />
        </div>
      </div>

      <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className={`${th} text-left`}>Item</th>
              <th className={`${th} text-right w-[90px]`}>Quantity</th>
              <th className={`${th} text-right w-[100px]`}>Unit cost £</th>
              <th className={`${th} text-right`}>Value</th>
              <th className={`${th} text-right w-[100px]`}>Latest invoice £</th>
              <th className={`${th} text-right w-[100px]`}>NRV a unit £</th>
              <th className={`${th} text-left`}>Cost and NRV check</th>
              <th className={`${th} text-left`}>Evidence</th>
            </tr>
          </thead>
          {CATEGORIES.map(([cat, label]) => {
            const rows = shown.filter((v) => (v.l.category ?? 'raw') === cat);
            return (
              <tbody key={cat} className="divide-y divide-[#E3E7EF]">
                <tr className="bg-[#F5F8FD]/70 font-bold">
                  <td colSpan={3} className="p-2">
                    {label} <span className="font-normal text-[#4A5878]">· {views.filter((v) => (v.l.category ?? 'raw') === cat).length} lines</span>
                  </td>
                  <td className="p-2 text-right font-mono">{money(tot(`cat_${cat}`))}</td>
                  <td colSpan={4} />
                </tr>
                {rows.map((v) => {
                  const l = v.l;
                  const name = l.desc || 'New line';
                  return (
                    <React.Fragment key={l.id}>
                      <tr
                        onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const f = Array.from(e.dataTransfer.files ?? []);
                          if (f.length && !locked && dropFiles) dropFiles(f, l.id);
                        }}
                      >
                        <td className="p-1.5 align-top min-w-[180px]">
                          <TextInput label="Item" value={l.desc} disabled={locked} placeholder="e.g. Timber battens 25×50 mm" onCommit={(d) => setLine(l.id, { desc: d })} />
                          <div className="mt-1">
                            <TextInput label={`Location and unit for ${name}`} value={l.location} disabled={locked} placeholder="Location · per unit" onCommit={(d) => setLine(l.id, { location: d })} />
                          </div>
                          {l.unclear && (
                            <div className="mt-1 text-[10px] text-[#B8432F]">
                              Quantity unclear on the sheet.{' '}
                              {!locked && (
                                <button type="button" className="underline font-bold" onClick={() => setLine(l.id, { unclear: false })}>
                                  Confirm
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-1.5 align-top">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Quantity of ${name}`}
                            disabled={locked}
                            defaultValue={l.qty}
                            onBlur={(e) => e.target.value !== l.qty && setLine(l.id, { qty: e.target.value.replace(/[^\d.]/g, '') || '0' })}
                            className={`w-full px-2 py-1.5 text-right font-mono text-xs border rounded-[8px] ${l.unclear ? 'border-[#F0B44C] bg-[#FFF8E6]' : 'border-[#D3DCEE]'}`}
                          />
                        </td>
                        <td className="p-1.5 align-top">
                          <MoneyInput label={`Unit cost of ${name}`} value={l.unit_cost_p ?? v.unit.toString()} disabled={locked} allowNegative={false} onCommit={(p) => setLine(l.id, { unit_cost_p: p })} />
                        </td>
                        <td className="p-2 align-top text-right font-mono font-bold">{money(v.counted)}</td>
                        <td className="p-1.5 align-top">
                          <MoneyInput label={`Latest invoice unit cost for ${name}`} value={l.invoice_cost_p} placeholder="–" disabled={locked} allowNegative={false} onCommit={(p) => setLine(l.id, { invoice_cost_p: p, decision_cost: undefined })} />
                        </td>
                        <td className="p-1.5 align-top">
                          <MoneyInput label={`Net realisable value a unit for ${name}`} value={l.nrv_p} placeholder="–" disabled={locked} allowNegative={false} onCommit={(p) => setLine(l.id, { nrv_p: p, decision_nrv: undefined })} />
                        </td>
                        <td className="p-2 align-top">{check(v)}</td>
                        <td className="p-2 align-top">
                          <div className="flex items-center gap-2 flex-wrap">
                            {tickFor(l.id, name)}
                            <RowFiles files={filesFor(l.id)} onPreview={preview} onAttach={() => attachTo(l.id)} disabled={locked} label={`the invoice or costing for ${name}`} />
                            {!locked && (
                              <button type="button" aria-label={`Remove ${name}`} onClick={() => save({ lines: (live().lines ?? []).filter((x: StockLine) => x.id !== l.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {(v.suggestions.length > 0 || l.decision_cost || l.decision_nrv) && (
                        <tr>
                          <td colSpan={8} className="px-3 pb-2 flex flex-col gap-1.5">
                            {v.suggestions.map((s) => (
                              <SuggestionRow
                                key={s.kind}
                                actions={
                                  !locked && (
                                    <>
                                      <button type="button" className={btnPrimary} onClick={() => setLine(l.id, s.kind === 'revalue' ? { decision_cost: 'revalue' } : { decision_nrv: 'write_down' })}>
                                        {s.kind === 'revalue' ? `Revalue to ${formatPenceInput(v.invoice!)}` : `Write down to ${formatPenceInput(v.nrv!)}`}
                                      </button>
                                      <button type="button" className={btnSecondary} onClick={() => setLine(l.id, s.kind === 'revalue' ? { decision_cost: 'keep' } : { decision_nrv: 'keep' })}>
                                        Keep at cost
                                      </button>
                                    </>
                                  )
                                }
                              >
                                {s.why}
                              </SuggestionRow>
                            ))}
                            {(l.decision_cost || l.decision_nrv) && (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#4A5878]">
                                {l.decision_cost === 'revalue' && <span>Revalued to the latest invoice price ({formatPence(v.revaluation)} lower).</span>}
                                {l.decision_nrv === 'write_down' && <span>Written down to net realisable value ({formatPence(v.writeDown)} lower).</span>}
                                {(l.decision_cost === 'keep' || l.decision_nrv === 'keep') && (
                                  <span className="w-72">
                                    <TextInput label={`Why ${name} stays at cost`} value={l.reason} disabled={locked} placeholder="Why it stays at cost (required)" onCommit={(r) => setLine(l.id, { reason: r })} />
                                  </span>
                                )}
                                {!locked && (
                                  <button type="button" className="text-[#1D4E89] underline" onClick={() => setLine(l.id, { decision_cost: undefined, decision_nrv: undefined })}>
                                    Undo
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!locked && (
                  <tr>
                    <td colSpan={8} className="p-1.5">
                      <button type="button" className={btnAdd} onClick={() => add(cat)}>
                        <Plus className="w-3.5 h-3.5" /> Add line
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          <tfoot className="border-t-2 border-[#122654]/20 font-bold">
            <tr>
              <td className="p-2" colSpan={8}>
                Total stock · count at cost <span className="font-mono">{money(tot('counted'))}</span> · write-downs <span className="font-mono">{money(tot('write_downs'))}</span> · closing stock{' '}
                <span className="font-mono">{money(tot('closing'))}</span> · <span className="font-normal">ledger 700</span> <span className="font-mono">{money(tot('ledger'))}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <JournalPanel
          engagementId={result.engagementId}
          date={pe}
          lines={lines}
          sent={data.journal}
          narrative="Closing stock at the year end"
          source="D-10"
          locked={locked}
          save={save}
          title="Closing stock journal"
          empty="The count, less write-downs, already agrees to the ledger."
          note={`Count at cost ${formatPence(tot('counted'))} − write-downs ${formatPence(tot('write_downs'))} = ${formatPence(tot('closing'))} · ledger ${formatPence(tot('ledger'))}`}
        />
        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Gross margin test {moveBp !== undefined && <Pill tone={moveBp <= 500n && moveBp >= -500n ? 'good' : 'warn'}>{moveBp <= 500n && moveBp >= -500n ? 'Consistent' : 'Moved more than 5 points'}</Pill>}
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="py-1">Turnover (trial balance)</td>
                <td className="py-1 text-right font-mono">{money(tot('revenue'))}</td>
              </tr>
              <tr>
                <td className="py-1">Gross margin before stock adjustments</td>
                <td className="py-1 text-right font-mono">{pct(result.totals.margin_before_bp)}</td>
              </tr>
              <tr className="font-bold">
                <td className="py-1">Gross margin after stock adjustments</td>
                <td className="py-1 text-right font-mono">{pct(result.totals.margin_after_bp)}</td>
              </tr>
              <tr>
                <td className="py-1">Prior year</td>
                <td className="py-1 text-right font-mono">{pct(result.totals.margin_prior_bp)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-[#4A5878]">Recalculates as you change quantities, costs or write-downs.</div>
        </div>
        <AccountsPreview rows={[...CATEGORIES.map(([k, label]) => ({ label, amount: tot(`cat_${k}`) })), { label: 'Stocks in the balance sheet', amount: tot('closing'), strong: true }]} note='The stock policy note uses "lower of cost and net realisable value".' />
      </div>
    </div>
  );
}

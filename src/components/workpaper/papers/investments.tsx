'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatPence } from '@/lib/money';
import { CENTRAL_TAX_RATES } from '@/lib/tax-rates';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, contextOf, ExpandButton, JournalPanel, money, newId, Pill, SuggestionRow, th, Tiles, useOpen } from '../kit';
import { investmentsReview, type Investment, type Property } from '@/lib/workpapers/investments';

const ACTIONS: Record<string, [string, string, string, string]> = {
  fees: ['capitalise', 'Add to cost', 'expense', 'Leave as a cost'],
  valuation: ['confirmed', 'Basis confirmed', 'confirmed', ''],
  rent: ['debtor', 'Add a rent debtor', 'no', 'Not owed'],
};

export function InvestmentsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const { isOpen, toggle } = useOpen();
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = investmentsReview(ctx);
  const tot = (k: string) => result.totals[k] ?? 0n;
  const setProp = (id: string, patch: Partial<Property>) => save({ properties: (live().properties ?? []).map((p: Property) => (p.id === id ? { ...p, ...patch } : p)) });
  const setInv = (id: string, patch: Partial<Investment>) => save({ investments: (live().investments ?? []).map((i: Investment) => (i.id === id ? { ...i, ...patch } : i)) });
  const decide = (id: string, kind: string, value: string | undefined) => save({ decisions: { ...(live().decisions ?? {}), [id]: { ...(live().decisions?.[id] ?? {}), [kind]: value } } });
  const date = (v: string | undefined, label: string, onChange: (d: string) => void) => (
    <input type="date" aria-label={label} value={v ?? ''} disabled={locked} onChange={(e) => onChange(e.target.value)} className="w-[125px] px-1.5 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px]" />
  );
  const field = (label: string, node: React.ReactNode) => (
    <label className="flex flex-col gap-0.5 text-[10px] font-semibold text-[#4A5878]">
      {label}
      {node}
    </label>
  );
  const nothing = !r.props.length && !r.invs.length;

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Framework', value: r.frs105 ? 'FRS 105' : 'FRS 102', sub: r.frs105 ? 'property at cost less depreciation' : 'property at fair value' },
          { label: 'Investment property', value: formatPence(tot('property')), sub: `${r.props.length} propert${r.props.length === 1 ? 'y' : 'ies'}` },
          { label: r.frs105 ? 'Depreciation this year' : 'Fair value movement', value: formatPence(r.frs105 ? r.props.reduce((a, x) => a + x.charge, 0n) : tot('gains')), sub: r.frs105 ? 'on buildings at 2%' : `deferred tax ${formatPence(tot('deferred_tax'))}` },
          { label: 'Investments', value: formatPence(tot('investments')), sub: `${r.invs.length} held` },
          { label: 'Rent short of tenancies', value: formatPence(tot('rent_shortfall')), tone: tot('rent_shortfall') ? 'warn' : 'plain', sub: 'from the rents entered' },
        ]}
      />

      {nothing && (
        <div className={card}>
          <div className="font-bold mb-1">Nothing held?</div>
          <div className="text-[11px] text-[#4A5878] mb-2">If the company holds no investments or investment property, say how you know (no accounts in the trial balance, no purchases in the bank, no rent or dividends received).</div>
          <TextInput label="How you know nothing is held" value={data.none_held} disabled={locked} placeholder="e.g. No investment accounts in the TB; no rent or dividend income in the ledger" onCommit={(v) => save({ none_held: v })} />
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold">Investment property register</span>
          {!locked && (
            <button type="button" className={btnAdd} onClick={() => save({ properties: [...(live().properties ?? []), { id: newId('prop'), address: '', acquired: ctx.periodEnd, cost_p: '0', code: '6500' }] })}>
              <Plus className="w-3.5 h-3.5" /> Add property
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-[#F5F8FD]">
              <tr>
                <th className="w-8" />
                {['Property', 'Acquired', 'Cost', r.frs105 ? 'Depreciation' : 'Last year', r.frs105 ? 'Carrying' : 'Fair value', r.frs105 ? 'Charge' : 'Movement', 'Rent a year', 'Evidence'].map((h, i) => (
                  <th key={h} className={`${th} ${i >= 2 && i <= 6 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {r.props.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-3 text-[#7E8DA6]">
                    No investment property.
                  </td>
                </tr>
              )}
              {r.props.map((x) => {
                const p = x.p;
                const name = p.address || 'New property';
                return (
                  <React.Fragment key={p.id}>
                    <tr
                      onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = Array.from(e.dataTransfer.files ?? []);
                        if (f.length && !locked && dropFiles) dropFiles(f, p.id);
                      }}
                    >
                      <td className="p-1.5 align-top">
                        <ExpandButton open={isOpen(p.id)} label={`details for ${name}`} onClick={() => toggle(p.id)} />
                      </td>
                      <td className="p-1.5 min-w-[200px]">
                        <TextInput label="Address" value={p.address} disabled={locked} placeholder="Address" onCommit={(v) => setProp(p.id, { address: v })} />
                        <div className="text-[10px] text-[#4A5878] mt-0.5">{[p.type, x.addedThisYear ? 'bought this year' : ''].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="p-1.5">{date(p.acquired, `Date ${name} was acquired`, (d) => setProp(p.id, { acquired: d }))}</td>
                      <td className="p-1.5 w-28">
                        <MoneyInput label={`Cost of ${name}`} value={p.cost_p} disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { cost_p: v })} />
                        {x.capitalised > 0n && <div className="text-[10px] text-right text-[#4A5878]">+ {formatPence(x.capitalised)} fees</div>}
                      </td>
                      <td className="p-1.5 w-28">
                        {r.frs105 ? (
                          x.addedThisYear ? <span className="block text-right font-mono">–</span> : <MoneyInput label={`Depreciation brought forward on ${name}`} value={p.dep_bf_p} disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { dep_bf_p: v })} />
                        ) : x.addedThisYear ? (
                          <span className="block text-right font-mono">–</span>
                        ) : (
                          <MoneyInput label={`Fair value last year for ${name}`} value={p.prior_value_p} disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { prior_value_p: v })} />
                        )}
                      </td>
                      <td className="p-1.5 w-28">
                        {r.frs105 ? <span className="block text-right font-mono font-bold">{money(x.carrying)}</span> : <MoneyInput label={`Fair value at the year end for ${name}`} value={p.valuation_p} placeholder="Enter value" disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { valuation_p: v })} />}
                      </td>
                      <td className={`p-1.5 text-right font-mono ${x.gain < 0n ? 'text-[#B42318]' : ''}`}>{money(r.frs105 ? x.charge : x.gain)}</td>
                      <td className="p-1.5 w-28">
                        <MoneyInput label={`Rent a year for ${name}`} value={p.rent_pa_p} disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { rent_pa_p: v })} />
                      </td>
                      <td className="p-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tickFor(p.id, name)}
                          <RowFiles files={filesFor(p.id)} onPreview={preview} onAttach={() => attachTo(p.id)} disabled={locked} label={`title, valuation or tenancy for ${name}`} />
                        </div>
                      </td>
                    </tr>
                    {x.flags.map((f) => (
                      <tr key={f.kind}>
                        <td />
                        <td colSpan={8} className="px-1.5 pb-1.5">
                          <SuggestionRow
                            actions={
                              !locked && (
                                <>
                                  <button type="button" className={btnPrimary} onClick={() => decide(p.id, f.kind, ACTIONS[f.kind][0])}>
                                    {ACTIONS[f.kind][1]}
                                  </button>
                                  {ACTIONS[f.kind][3] && (
                                    <button type="button" className={btnSecondary} onClick={() => decide(p.id, f.kind, ACTIONS[f.kind][2])}>
                                      {ACTIONS[f.kind][3]}
                                    </button>
                                  )}
                                </>
                              )
                            }
                          >
                            {f.why}
                          </SuggestionRow>
                        </td>
                      </tr>
                    ))}
                    {isOpen(p.id) && (
                      <tr className="bg-[#FAFBFD]">
                        <td />
                        <td colSpan={8} className="p-2">
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="flex flex-col gap-1.5">
                              <div className="font-bold text-[11px]">Ownership</div>
                              {field('Land Registry title', <TextInput label={`Title number for ${name}`} value={p.title} disabled={locked} onCommit={(v) => setProp(p.id, { title: v })} />)}
                              {field('Type', <TextInput label={`Type of ${name}`} value={p.type} disabled={locked} placeholder="e.g. Residential flat" onCommit={(v) => setProp(p.id, { type: v })} />)}
                              {field('In the TB under', <TextInput label={`Chart account for ${name}`} value={p.code ?? '6500'} disabled={locked} onCommit={(v) => setProp(p.id, { code: v.replace(/\D/g, '') || '6500' })} />)}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="font-bold text-[11px]">Valuation</div>
                              {r.frs105 ? (
                                <>
                                  {field('Land (not depreciated)', <MoneyInput label={`Land value in ${name}`} value={p.land_p} disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { land_p: v })} />)}
                                  <div className="text-[10px] text-[#4A5878]">Under FRS 105 the market value is kept only to check for impairment.</div>
                                </>
                              ) : (
                                <>
                                  {field('Valued on', date(p.valuation_date, `Valuation date for ${name}`, (d) => setProp(p.id, { valuation_date: d })))}
                                  {field(
                                    'By',
                                    <select aria-label={`Who valued ${name}`} value={p.valuer ?? ''} disabled={locked} onChange={(e) => setProp(p.id, { valuer: e.target.value as Property['valuer'] })} className="px-1.5 py-1 border border-[#D3DCEE] rounded-[6px]">
                                      <option value="">Choose…</option>
                                      <option value="independent">Independent valuer</option>
                                      <option value="directors">The directors</option>
                                    </select>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="font-bold text-[11px]">Tenancy</div>
                              {field('Rent received in the year', <MoneyInput label={`Rent received for ${name}`} value={p.rent_received_p} placeholder="Enter" disabled={locked} allowNegative={false} onCommit={(v) => setProp(p.id, { rent_received_p: v })} />)}
                              <div className="text-[10px] text-[#4A5878]">Due under the tenancy: {formatPence(x.expected)}</div>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <div className="font-bold text-[11px]">Mortgage</div>
                              {field('Lender and loan', <TextInput label={`Mortgage on ${name}`} value={p.mortgage} disabled={locked} placeholder="On the Loans paper" onCommit={(v) => setProp(p.id, { mortgage: v })} />)}
                              {!locked && (
                                <button type="button" className="mt-2 text-left text-[10px] text-[#B42318] underline" onClick={() => save({ properties: (live().properties ?? []).filter((y: Property) => y.id !== p.id) })}>
                                  Remove property
                                </button>
                              )}
                            </div>
                          </div>
                          {Object.entries(x.d).filter(([, v]) => v).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#4A5878]">
                              {Object.entries(x.d)
                                .filter(([, v]) => v)
                                .map(([k, v]) => (
                                  <span key={k}>
                                    <Pill tone="info">{`${k}: ${v}`}</Pill>{' '}
                                    {!locked && (
                                      <button type="button" className="text-[#1D4E89] underline" onClick={() => decide(p.id, k, undefined)}>
                                        Undo
                                      </button>
                                    )}
                                  </span>
                                ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold">Investments register</span>
          {!locked && (
            <button type="button" className={btnAdd} onClick={() => save({ investments: [...(live().investments ?? []), { id: newId('inv'), name: '', kind: 'listed', cost_p: '0' }] })}>
              <Plus className="w-3.5 h-3.5" /> Add investment
            </button>
          )}
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              {['Investment', 'Type', 'Holding %', 'Cost', 'Market value', 'Impairment', 'Carrying', 'Evidence', ''].map((h, i) => (
                <th key={i} className={`${th} ${i >= 3 && i <= 6 ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1F6]">
            {r.invs.length === 0 && (
              <tr>
                <td colSpan={9} className="p-3 text-[#7E8DA6]">
                  No investments.
                </td>
              </tr>
            )}
            {r.invs.map((x) => (
              <tr key={x.i.id}>
                <td className="p-1.5 min-w-[160px]">
                  <TextInput label="Investment" value={x.i.name} disabled={locked} placeholder="e.g. 1,000 shares in X plc" onCommit={(v) => setInv(x.i.id, { name: v })} />
                </td>
                <td className="p-1.5">
                  <select aria-label={`Type of ${x.i.name}`} value={x.i.kind} disabled={locked} onChange={(e) => setInv(x.i.id, { kind: e.target.value as Investment['kind'] })} className="px-1.5 py-1 border border-[#D3DCEE] rounded-[6px]">
                    <option value="listed">Listed</option>
                    <option value="unlisted">Unlisted</option>
                  </select>
                </td>
                <td className="p-1.5 w-16">
                  <TextInput label={`Holding in ${x.i.name}`} value={x.i.holding_pct} disabled={locked} className="text-right" onCommit={(v) => setInv(x.i.id, { holding_pct: v })} />
                </td>
                <td className="p-1.5 w-24">
                  <MoneyInput label={`Cost of ${x.i.name}`} value={x.i.cost_p} disabled={locked} allowNegative={false} onCommit={(v) => setInv(x.i.id, { cost_p: v })} />
                </td>
                <td className="p-1.5 w-24">
                  <MoneyInput label={`Market value of ${x.i.name}`} value={x.i.market_p} placeholder="–" disabled={locked} allowNegative={false} onCommit={(v) => setInv(x.i.id, { market_p: v })} />
                </td>
                <td className="p-1.5 w-24">
                  <MoneyInput label={`Impairment of ${x.i.name}`} value={x.i.impairment_p} placeholder="–" disabled={locked} allowNegative={false} onCommit={(v) => setInv(x.i.id, { impairment_p: v })} />
                </td>
                <td className="p-1.5 text-right font-mono font-bold">{money(x.carrying)}</td>
                <td className="p-1.5">
                  <RowFiles files={filesFor(x.i.id)} onPreview={preview} onAttach={() => attachTo(x.i.id)} disabled={locked} label={`broker statement or accounts for ${x.i.name}`} />
                </td>
                <td className="p-1.5">
                  {!locked && (
                    <button type="button" aria-label={`Remove ${x.i.name}`} onClick={() => save({ investments: (live().investments ?? []).filter((y: Investment) => y.id !== x.i.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[10px] text-[#4A5878]">{r.frs105 ? 'FRS 105: investments at cost less impairment.' : 'FRS 102: listed shares at market value; unlisted at cost less impairment, checked against the company’s latest accounts.'}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel engagementId={result.engagementId} date={ctx.periodEnd} lines={r.lines} sent={data.journal} narrative="Investments: fees capitalised, rent due, and the year's valuation or depreciation" source="G-10" locked={locked} save={save} title="Year-end journals" />
        <AccountsPreview
          rows={[
            { label: 'Investment property', amount: tot('property') },
            { label: 'Investments', amount: tot('investments') },
            ...(r.frs105 ? [] : [{ label: 'Of which unrealised gains (not distributable)', amount: tot('gains') - tot('deferred_tax') }]),
          ]}
          note={r.frs105 ? 'Micro-entities on FRS 105 cannot use fair value.' : `Valued at ${ukDate(ctx.periodEnd)}; fair value movements go through the P&L with deferred tax at ${CENTRAL_TAX_RATES.corporation_tax.main_rate_pct}%.`}
        />
      </div>
    </div>
  );
}

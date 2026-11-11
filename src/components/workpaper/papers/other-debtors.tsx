'use client';

import React, { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { db } from '@/lib/server/db';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, CodePicker, ExpandButton, FilterChips, JournalPanel, money, newId, Pill, SuggestBanner, SuggestionRow, th, Tiles, useOpen } from '../kit';
import { chartName, expenseCodes } from '@/lib/workpapers/common';
import { ITEM_TYPES, OTHER_ACCOUNTS, otherDebtorsJournal, otherItemsFromLedger, otherItemView, type OtherItem } from '@/lib/workpapers/other-debtors';

export function OtherDebtorsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const { isOpen, toggle, show } = useOpen();
  const [filter, setFilter] = useState<'all' | 'action' | 'after' | 'old'>('all');
  const [note, setNote] = useState<string | null>(null);
  const eng = db.engagements.find((e) => e.id === result.engagementId);
  const pe = eng?.period_end ?? '';
  const tot = (k: string) => result.totals[k] ?? 0n;
  const views = ((data.items ?? []) as OtherItem[]).map((i) => otherItemView(i, pe, filesFor(i.id).length));
  const codes = expenseCodes();
  const lines = otherDebtorsJournal(data, pe);

  const setItem = (id: string, patch: Partial<OtherItem>) => save({ items: (live().items ?? []).map((i: OtherItem) => (i.id === id ? { ...i, ...patch } : i)) });
  const refresh = () => {
    if (!eng) return;
    const tbOf = (prefix: string) => {
      const lead = result.leads.find((l) => l.code === prefix);
      return { draft: lead?.draft ?? 0n, adjustments: lead?.adjustments ?? 0n, final: lead?.final ?? 0n, mapped: !!lead?.mapped };
    };
    const items = otherItemsFromLedger({ engagementId: eng.id, periodStart: eng.period_start, periodEnd: pe, tb: tbOf }, live().items ?? []);
    save({ items, refreshed_at: new Date().toISOString() });
    setNote(`${items.length} open item${items.length === 1 ? '' : 's'} on 720 and 749 at ${ukDate(pe)}.`);
  };
  const addItem = (account: string) => {
    const id = newId('oth');
    save({ items: [...(live().items ?? []), { id, account, desc: '', date: pe, amount_p: '0', due: 'within' }] });
    show(id);
  };
  const pending = views.filter((v) => v.suggestion && !v.i.decision);
  const acceptAll = () =>
    save({
      items: (live().items ?? []).map((i: OtherItem) => {
        const v = otherItemView(i, pe, filesFor(i.id).length);
        return i.decision || !v.suggestion ? i : { ...i, decision: v.suggestion.kind };
      }),
    });
  const needsAction = (v: (typeof views)[number]) => !v.supported || !v.decided || v.needsDue;
  const shown = views.filter((v) => (filter === 'action' ? needsAction(v) : filter === 'after' ? v.i.due === 'after' : filter === 'old' ? v.age > 365 : true));

  const status = (v: (typeof views)[number]) => {
    if (v.i.decision === 'write_off') return <Pill tone="plain">Written off</Pill>;
    if (v.i.decision === 'prepayment') return <Pill tone="info">Moved to prepayments</Pill>;
    if (v.suggestion && !v.i.decision) return <Pill tone="warn">Decision needed</Pill>;
    if (v.supported) return <Pill tone="good">Supported</Pill>;
    return <Pill tone="warn">Evidence needed</Pill>;
  };

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Listing vs ledger', value: tot('difference') === 0n ? 'Agrees' : 'Differs', tone: tot('difference') === 0n ? 'good' : 'bad', sub: tot('difference') === 0n ? `${formatPence(tot('ledger'))} both` : `Difference ${formatPence(tot('difference'))}` },
          { label: 'Items supported', value: `${String(tot('supported'))} of ${views.length}`, sub: 'by evidence or receipt after the period end' },
          { label: 'Recovered after period end', value: formatPence(tot('recovered')), tone: tot('recovered') ? 'good' : 'plain', sub: 'from the ledger' },
          { label: 'Due after more than one year', value: formatPence(tot('after_one_year')), sub: 'shown separately in the notes' },
          { label: 'Adjustments', value: formatPence(tot('moved') + tot('written')), sub: tot('suggested') ? `suggestions cover ${formatPence(tot('suggested'))}` : 'nothing suggested' },
        ]}
      />
      <SuggestBanner
        count={pending.length}
        locked={locked}
        onAccept={acceptAll}
        text={pending.map((v) => (v.suggestion!.kind === 'prepayment' ? `move "${v.i.desc}" to prepayments` : `write off "${v.i.desc}" (${formatPence(v.amount)})`)).join(' · ') + '.'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'All items', count: views.length },
            { key: 'action', label: 'Needs action', count: views.filter(needsAction).length },
            { key: 'after', label: 'Due after one year', count: views.filter((v) => v.i.due === 'after').length },
            { key: 'old', label: 'Over 12 months old', count: views.filter((v) => v.age > 365).length },
          ]}
        />
        {!locked && (
          <button type="button" onClick={refresh} className={`${btnAdd} ml-auto`}>
            <RefreshCw className="w-3.5 h-3.5" /> Build listing from ledger
          </button>
        )}
      </div>
      {note && <div className="-mt-2 text-[11px] text-[#0B6B52]">{note}</div>}

      <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className="w-8" />
              <th className={`${th} text-left`}>Item</th>
              <th className={`${th} text-left`}>Date</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-left`}>Falls due</th>
              <th className={`${th} text-left`}>Recovery and status</th>
              <th className={`${th} text-left`}>Evidence</th>
            </tr>
          </thead>
          {OTHER_ACCOUNTS.map((account) => {
            const rows = shown.filter((v) => v.i.account === account);
            const listing = tot(`${account}_listing`);
            const ledger = tot(`${account}_ledger`);
            return (
              <tbody key={account} className="divide-y divide-[#E3E7EF]">
                <tr className="bg-[#F5F8FD]/70">
                  <td />
                  <td colSpan={2} className="p-2 font-bold">
                    {account} {chartName(account)} <span className="font-normal text-[#4A5878]">{views.filter((v) => v.i.account === account).length} items</span>
                  </td>
                  <td colSpan={4} className="p-2 text-right text-[11px]">
                    Ledger <strong className="font-mono">{money(ledger)}</strong> · Listing <strong className="font-mono">{money(listing)}</strong>{' '}
                    <Pill tone={listing === ledger ? 'good' : 'bad'}>{listing === ledger ? 'Agrees' : 'Differs'}</Pill>
                  </td>
                </tr>
                {rows.map((v) => {
                  const i = v.i;
                  const name = i.desc || 'New item';
                  const showSuggestion = v.suggestion && !i.decision;
                  return (
                    <React.Fragment key={i.id}>
                      <tr
                        onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const f = Array.from(e.dataTransfer.files ?? []);
                          if (f.length && !locked && dropFiles) dropFiles(f, i.id);
                        }}
                      >
                        <td className="p-1.5 align-top">
                          <ExpandButton open={isOpen(i.id)} label={`details for ${name}`} onClick={() => toggle(i.id)} />
                        </td>
                        <td className="p-2 align-top">
                          <div className="font-bold">{name}</div>
                          <div className="text-[10px] text-[#4A5878]">{[i.contact, i.type].filter(Boolean).join(' · ') || (i.no_detail ? 'No ledger detail' : '')}</div>
                        </td>
                        <td className="p-2 align-top whitespace-nowrap">{i.date ? ukDate(i.date) : '–'}</td>
                        <td className="p-2 align-top text-right font-mono font-bold">{money(v.amount)}</td>
                        <td className="p-2 align-top">
                          <div className="inline-flex rounded-[6px] border border-[#D3DCEE] overflow-hidden" role="group" aria-label={`When ${name} falls due`}>
                            {(['within', 'after'] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                disabled={locked}
                                aria-pressed={i.due === d}
                                onClick={() => setItem(i.id, { due: d })}
                                className={`px-2 py-1 text-[10px] font-bold ${i.due === d ? 'bg-[#122654] text-white' : 'bg-white text-[#122654]'}`}
                              >
                                {d === 'within' ? 'Within 1 yr' : 'After 1 yr'}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="p-2 align-top">
                          <div className={`text-[11px] ${v.recovered ? 'text-[#0B6B52]' : 'text-[#4A5878]'}`}>
                            {v.recovered ? `Received ${formatPence(v.recovered)} after ${ukDate(pe)}` : v.age > 365 ? `No movement for ${Math.floor(v.age / 365)} yr` : 'Nothing received yet'}
                          </div>
                          {status(v)}
                        </td>
                        <td className="p-2 align-top">
                          <div className="flex items-center gap-2 flex-wrap">
                            {tickFor(i.id, name)}
                            <RowFiles files={filesFor(i.id)} onPreview={preview} onAttach={() => attachTo(i.id)} disabled={locked} label={name} />
                          </div>
                        </td>
                      </tr>
                      {(showSuggestion || isOpen(i.id) || i.decision) && (
                        <tr className="bg-[#FAFBFD]">
                          <td />
                          <td colSpan={6} className="p-3 flex flex-col gap-2">
                            {showSuggestion && (
                              <SuggestionRow
                                actions={
                                  !locked && (
                                    <>
                                      <button type="button" className={btnPrimary} onClick={() => setItem(i.id, { decision: v.suggestion!.kind })}>
                                        {v.suggestion!.kind === 'prepayment' ? 'Move to prepayments' : `Write off ${formatPence(v.amount)}`}
                                      </button>
                                      <button type="button" className={btnSecondary} onClick={() => setItem(i.id, { decision: 'keep' })}>
                                        Keep here
                                      </button>
                                    </>
                                  )
                                }
                              >
                                {v.suggestion!.why}
                              </SuggestionRow>
                            )}
                            {i.decision && (
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                {i.decision === 'prepayment' && (
                                  <>
                                    Unexpired part to prepayments
                                    <span className="w-28">
                                      <MoneyInput label={`Unexpired part of ${name}`} value={i.move_p ?? i.amount_p} disabled={locked} allowNegative={false} onCommit={(p) => setItem(i.id, { move_p: p })} />
                                    </span>
                                    {v.amount - v.moved > 0n && (
                                      <>
                                        rest ({formatPence(v.amount - v.moved)}) charged to
                                        <CodePicker label={`Charge the expired part of ${name} to`} value={i.expense_code ?? '499'} codes={codes} disabled={locked} onChange={(c) => setItem(i.id, { expense_code: c })} />
                                      </>
                                    )}
                                  </>
                                )}
                                {i.decision === 'keep' && (
                                  <span className="w-72">
                                    <TextInput label={`Why ${name} stays`} value={i.reason} disabled={locked} placeholder="Why it stays (required)" onCommit={(r) => setItem(i.id, { reason: r })} />
                                  </span>
                                )}
                                {i.decision === 'write_off' && <span>Written off to 499 Other administrative expenses.</span>}
                                {!locked && (
                                  <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => setItem(i.id, { decision: undefined, move_p: undefined })}>
                                    Undo
                                  </button>
                                )}
                              </div>
                            )}
                            {isOpen(i.id) && (
                              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                <div className={card}>
                                  <div className="font-bold mb-1">Ledger transactions behind this item</div>
                                  {i.ledger?.map((l, k) => (
                                    <div key={k} className="flex justify-between gap-2 text-[11px] border-t border-[#EEF1F6] py-1">
                                      <span>{ukDate(l.date)}</span>
                                      <span className="flex-1">{l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="underline">{l.desc}</a> : l.desc}</span>
                                      <span className="font-mono">{formatPence(asPence(l.amount_p), { symbol: '' })}</span>
                                    </div>
                                  ))}
                                  {!i.ledger && (
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <TextInput label="Description" value={i.desc} disabled={locked} placeholder="Description" onCommit={(d) => setItem(i.id, { desc: d })} />
                                      <TextInput label="Who owes it" value={i.contact} disabled={locked} placeholder="Who owes it" onCommit={(c) => setItem(i.id, { contact: c })} />
                                      <input type="date" aria-label="Date" value={i.date} disabled={locked} onChange={(e) => setItem(i.id, { date: e.target.value })} className="px-2 py-1 border border-[#D3DCEE] rounded-[8px]" />
                                      <MoneyInput label={`Amount of ${name}`} value={i.amount_p} disabled={locked} onCommit={(p) => setItem(i.id, { amount_p: p })} />
                                      <MoneyInput label={`Received after the period end for ${name}`} value={i.recovered_p} disabled={locked} allowNegative={false} onCommit={(p) => setItem(i.id, { recovered_p: p })} />
                                    </div>
                                  )}
                                  <label className="mt-2 flex items-center gap-2 text-[11px]">
                                    Type
                                    <select aria-label={`Type of ${name}`} value={i.type ?? ''} disabled={locked} onChange={(e) => setItem(i.id, { type: e.target.value || undefined })} className="px-1.5 py-1 border border-[#D3DCEE] rounded-[6px]">
                                      <option value="">Choose…</option>
                                      {ITEM_TYPES.map((t) => (
                                        <option key={t}>{t}</option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                                <div className={card}>
                                  <div className="font-bold mb-1">Received after {ukDate(pe)}</div>
                                  {i.recoveries?.length ? (
                                    i.recoveries.map((r, k) => (
                                      <div key={k} className="flex justify-between gap-2 text-[11px] border-t border-[#EEF1F6] py-1">
                                        <span>{ukDate(r.date)}</span>
                                        <span className="flex-1">{r.desc}</span>
                                        <span className="font-mono">{formatPence(asPence(r.amount_p), { symbol: '' })}</span>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-[11px] text-[#7E8DA6]">Nothing in the ledger after the period end.</div>
                                  )}
                                  {!locked && !i.ledger && (
                                    <button type="button" className="mt-2 text-[10px] text-[#B42318] underline" onClick={() => save({ items: (live().items ?? []).filter((x: OtherItem) => x.id !== i.id) })}>
                                      Remove item
                                    </button>
                                  )}
                                </div>
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
                    <td />
                    <td colSpan={6} className="p-1.5">
                      <button type="button" className={btnAdd} onClick={() => addItem(account)}>
                        <Plus className="w-3.5 h-3.5" /> Add item to {account}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          <tfoot className="border-t-2 border-[#122654]/20 font-bold">
            <tr>
              <td />
              <td className="p-2" colSpan={2}>
                Total other debtors
              </td>
              <td colSpan={4} className="p-2 text-right text-[11px]">
                Ledger <span className="font-mono">{money(tot('ledger'))}</span> · Listing <span className="font-mono">{money(tot('listing'))}</span> ·{' '}
                <span className={tot('difference') === 0n ? 'text-[#0B6B52]' : 'text-[#B42318]'}>{tot('difference') === 0n ? 'Difference nil' : `Difference ${formatPence(tot('difference'))}`}</span> · After adjustments{' '}
                <span className="font-mono">{money(tot('adjusted'))}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel engagementId={result.engagementId} date={pe} lines={lines} sent={data.journal} narrative="Other debtors: items moved to prepayments and balances written off" source="C-30" locked={locked} save={save} />
        <AccountsPreview
          rows={[
            { label: 'Other debtors – due within one year', amount: tot('within_one_year') },
            { label: 'Other debtors – due after more than one year', amount: tot('after_one_year') },
            { label: 'Moved to prepayments', amount: tot('moved') },
            { label: 'Written off', amount: tot('written') },
            { label: 'Other debtors in the balance sheet', amount: tot('adjusted'), strong: true },
          ]}
          note="Updates as you change when items fall due or decide on suggestions."
        />
      </div>
    </div>
  );
}

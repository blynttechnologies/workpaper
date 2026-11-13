'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { CENTRAL_TAX_RATES } from '@/lib/tax-rates';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { btnPrimary, btnSecondary, card, contextOf, ExpandButton, JournalPanel, money, newId, Pill, SuggestionRow, th, Tiles, useOpen } from '../kit';
import { advancesNote, dlaAccounts, dlaReview } from '@/lib/workpapers/dla';

const owed = (p: bigint) => (p > 0n ? `${formatPence(p)} owed by the director` : p < 0n ? `${formatPence(-p)} owed to the director` : 'nil');

export function DlaSchedule({ data, result, locked, save, filesFor, attachTo, preview, live }: ScheduleProps) {
  const { isOpen, toggle } = useOpen();
  const [tab, setTab] = useState('');
  const ctx = contextOf(result);
  if (!ctx) return null;
  const multi = (data.directors ?? []).length > 1;
  // Each director is their own loan; 'All' adds them together
  const r = dlaReview(ctx, multi && (data.directors ?? []).some((d: any) => d.id === tab) ? tab : undefined);
  const accounts = dlaAccounts(ctx.engagementId);
  const setDirector = (id: string, patch: Record<string, unknown>) => save({ directors: (live().directors ?? []).map((x: any) => (x.id === id ? { ...x, ...patch } : x)) });
  const decide = (id: string, d: 'personal' | 'business' | undefined) => save({ tx_decisions: { ...(live().tx_decisions ?? {}), [id]: d } });
  const overdrawnMonths = r.months.filter((m) => m.balance > 0n).length;
  const peakMonth = r.months.reduce<(typeof r.months)[number] | null>((p, m) => (!p || m.balance > p.balance ? m : p), null);
  const max = r.months.reduce((m, x) => (x.balance > m ? x.balance : -x.balance > m ? -x.balance : m), 1n);
  const note = r.director || !multi ? advancesNote(r, ctx.periodEnd, r.director?.name || r.directors[0]?.name || '') : r.directors.map((d) => advancesNote(dlaReview(ctx, d.id), ctx.periodEnd, d.name)).filter(Boolean).join(' ');
  const name = r.director?.name || r.directors.map((d) => d.name).filter(Boolean).join(', ') || 'the director';

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'At the year end', value: formatPence(r.closing < 0n ? -r.closing : r.closing), tone: r.closing > 0n ? 'warn' : 'plain', sub: r.closing > 0n ? 'owed by the director (overdrawn)' : r.closing < 0n ? 'owed to the director' : 'nil' },
          { label: 'Overdrawn months', value: `${overdrawnMonths} of ${r.months.length}`, sub: peakMonth && peakMonth.balance > 0n ? `peak ${formatPence(peakMonth.balance)} in ${peakMonth.label}` : 'never overdrawn' },
          { label: 's455 tax', value: formatPence(r.s455.s455), tone: r.s455.s455 ? 'bad' : 'good', sub: r.s455.overdrawn ? (r.s455.unrepaid ? 'to the tax computation' : 'repaid within 9 months') : 'not overdrawn' },
          { label: `Beneficial loan ${r.loan.ty.label}`, value: r.loan.over ? formatPence(r.loan.benefit) : 'Nil', tone: r.loan.over ? 'warn' : 'plain', sub: `highest ${formatPence(r.loan.peak)} · limit £10,000` },
          { label: 'Brought forward', value: formatPence(r.opening < 0n ? -r.opening : r.opening), sub: r.opening > 0n ? 'owed by the director' : r.opening < 0n ? 'owed to the director' : 'nil' },
        ]}
      />

      <div className={card}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-bold">Directors</span>
          {(data.directors ?? []).map((d: any) => (
            <span key={d.id} className="inline-flex items-center gap-1">
              <span className="w-44">
                <TextInput label="Director's name" value={d.name} disabled={locked} placeholder="Director's name" onCommit={(v) => save({ directors: (live().directors ?? []).map((x: any) => (x.id === d.id ? { ...x, name: v } : x)) })} />
              </span>
              {!locked && (data.directors ?? []).length > 1 && (
                <button type="button" aria-label={`Remove ${d.name || 'director'}`} onClick={() => save({ directors: (live().directors ?? []).filter((x: any) => x.id !== d.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          ))}
          {!locked && (
            <button type="button" className={btnSecondary} onClick={() => save({ directors: [...(live().directors ?? []), { id: newId('dir'), name: '', opening_p: '0', closing_p: '0' }] })}>
              <Plus className="inline w-3 h-3" /> Add director
            </button>
          )}
        </div>
        {!r.hasLedger && (
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="text-[#4A5878]">No ledger transactions on the director&apos;s loan account. Enter the balances (positive when the director owes the company):</span>
            <label className="flex items-center gap-1">
              Opening
              <span className="w-28">
                <MoneyInput label="Opening balance" value={r.director ? (data.directors ?? []).find((d: any) => d.id === r.director!.id)?.opening_p : data.opening_p} disabled={locked} onCommit={(p) => (r.director ? setDirector(r.director.id, { opening_p: p }) : save({ opening_p: p }))} />
              </span>
            </label>
            <label className="flex items-center gap-1">
              Closing
              <span className="w-28">
                <MoneyInput label="Closing balance" value={r.director ? (data.directors ?? []).find((d: any) => d.id === r.director!.id)?.closing_p : data.closing_p} disabled={locked} onCommit={(p) => (r.director ? setDirector(r.director.id, { closing_p: p }) : save({ closing_p: p }))} />
              </span>
            </label>
          </div>
        )}
      </div>

      {multi && (
        <div className="flex flex-col gap-2">
          <div className="inline-flex self-start rounded-[8px] border border-[#D3DCEE] overflow-hidden" role="tablist" aria-label="Director">
            {[{ id: '', name: 'All directors' }, ...r.directors].map((d) => (
              <button key={d.id || 'all'} type="button" role="tab" aria-selected={(r.director?.id ?? '') === d.id} onClick={() => setTab(d.id)} className={`px-3 py-1.5 text-xs font-bold ${(r.director?.id ?? '') === d.id ? 'bg-[#122654] text-white' : 'bg-white text-[#122654]'}`}>
                {d.name || 'Unnamed director'}
              </button>
            ))}
          </div>
          {r.director && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#4A5878]">
              {accounts.length > 1 && (
                <label className="flex items-center gap-1">
                  Loan account in the ledger
                  <select
                    aria-label={`Loan account for ${r.director.name}`}
                    disabled={locked}
                    value={Object.keys(r.owners).find((c) => r.owners[c] === r.director!.id) ?? ''}
                    onChange={(e) => setDirector(r.director!.id, { account: e.target.value })}
                    className="px-2 py-1 border border-[#D3DCEE] rounded-[6px] bg-white text-[#122654]"
                  >
                    <option value="">Shared, split by contact name</option>
                    {accounts.map((m) => (
                      <option key={m.source_code} value={m.source_code}>
                        {m.source_code} {m.source_name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!Object.values(r.owners).includes(r.director.id) && r.hasLedger && (
                <label className="flex items-center gap-1">
                  Brought forward for {r.director.name || 'this director'}
                  <span className="w-28">
                    <MoneyInput label={`Brought forward for ${r.director.name}`} value={(data.directors ?? []).find((d: any) => d.id === r.director!.id)?.bf_p ?? r.opening.toString()} disabled={locked} onCommit={(p) => setDirector(r.director!.id, { bf_p: p })} />
                  </span>
                </label>
              )}
              <span>
                {Object.values(r.owners).includes(r.director.id)
                  ? 'Balances from their own loan account in the ledger.'
                  : 'Shares a loan account: transactions go to the director named in the contact, and the brought forward is split by what you enter.'}
              </span>
            </div>
          )}
        </div>
      )}

      {r.hasLedger && (
        <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
          <table className="w-full text-xs text-[#122654]">
            <thead className="bg-[#F5F8FD]">
              <tr>
                <th className="w-8" />
                <th className={`${th} text-left`}>Movement</th>
                <th className={`${th} text-right`}>Items</th>
                <th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              <tr>
                <td />
                <td className="p-2 font-bold">Balance at {ukDate(ctx.periodStart)}</td>
                <td />
                <td className="p-2 text-right font-mono">{money(r.opening)}</td>
              </tr>
              {r.groups.map((g) => {
                const unsure = g.items.filter((x) => x.unsure && !x.decision);
                return (
                  <React.Fragment key={g.key}>
                    <tr>
                      <td className="p-1.5">{g.items.length > 0 && <ExpandButton open={isOpen(g.key)} label={g.label} onClick={() => toggle(g.key)} />}</td>
                      <td className="p-2">
                        {g.label} {unsure.length > 0 && <Pill tone="warn">{unsure.length} to decide</Pill>}
                      </td>
                      <td className="p-2 text-right">{g.items.length}</td>
                      <td className="p-2 text-right font-mono">{money(g.total)}</td>
                    </tr>
                    {(isOpen(g.key) || unsure.length > 0) &&
                      g.items
                        .filter((x) => isOpen(g.key) || (x.unsure && !x.decision))
                        .map((x) => (
                          <tr key={x.t.id} className="bg-[#FAFBFD]">
                            <td />
                            <td className="p-1.5 pl-6" colSpan={2}>
                              {x.unsure && !x.decision ? (
                                <SuggestionRow
                                  actions={
                                    !locked && (
                                      <>
                                        <button type="button" className={btnPrimary} onClick={() => decide(x.t.id, 'personal')}>
                                          Personal
                                        </button>
                                        <button type="button" className={btnSecondary} onClick={() => decide(x.t.id, 'business')}>
                                          Business
                                        </button>
                                      </>
                                    )
                                  }
                                >
                                  {ukDate(x.t.date)} · {x.t.description}: this could be a personal purchase on the company&apos;s account. Business moves it to other administrative expenses and reduces the loan.
                                </SuggestionRow>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                  <span className="w-20 text-[#4A5878]">{ukDate(x.t.date)}</span>
                                  <span className="flex-1">{x.t.external_url ? <a href={x.t.external_url} target="_blank" rel="noreferrer" className="underline">{x.t.description}</a> : x.t.description}</span>
                                  {x.decision && <Pill tone="info">{x.decision === 'business' ? 'Business cost' : 'Personal'}</Pill>}
                                  {g.key === 'personal' && !locked && (
                                    <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => decide(x.t.id, x.decision === 'business' ? undefined : 'business')}>
                                      {x.decision === 'business' ? 'Undo' : 'It was a business cost'}
                                    </button>
                                  )}
                                  <RowFiles files={filesFor(x.t.id)} onPreview={preview} onAttach={() => attachTo(x.t.id)} disabled={locked} label={x.t.description} />
                                </div>
                              )}
                            </td>
                            <td className="p-1.5 text-right font-mono text-[11px]">{money(x.amount)}</td>
                          </tr>
                        ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot className="font-bold border-t-2 border-[#122654]/20">
              <tr>
                <td />
                <td className="p-2">Balance at {ukDate(ctx.periodEnd)}</td>
                <td />
                <td className="p-2 text-right font-mono">{money(r.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {r.hasLedger && <p className="-mt-2 text-[10px] text-[#4A5878]">Positive means the director owes the company; brackets mean the company owes the director.</p>}

      {r.hasLedger && (
        <div className={card}>
          <div className="font-bold mb-2">Balance at each month end</div>
          <div className="flex items-center gap-1 h-36" role="img" aria-label="Director's loan balance at each month end">
            {r.months.map((m) => (
              <div key={m.key} className="flex-1 h-full flex flex-col items-center" title={`${m.label}: ${owed(m.balance)}`}>
                <div className="flex-1 w-full flex items-end">{m.balance > 0n && <div className="w-full bg-[#B8432F] rounded-t" style={{ height: `${Number((m.balance * 100n) / max)}%` }} />}</div>
                <div className="flex-1 w-full flex items-start border-t border-[#A6B4D0]">{m.balance < 0n && <div className="w-full bg-[#1D4E89] rounded-b" style={{ height: `${Number((-m.balance * 100n) / max)}%` }} />}</div>
                <span className="text-[9px] text-[#4A5878]">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-[10px] text-[#4A5878]">
            <span>
              <span className="inline-block w-2 h-2 bg-[#B8432F] mr-1" />
              Director owes the company
            </span>
            <span>
              <span className="inline-block w-2 h-2 bg-[#1D4E89] mr-1" />
              Company owes the director
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            s455 tax <Pill tone={r.s455.s455 ? 'bad' : 'good'}>{r.s455.overdrawn === 0n ? 'Not overdrawn' : r.s455.unrepaid ? `${formatPence(r.s455.s455)} due` : 'None due'}</Pill>
          </div>
          {r.s455.overdrawn === 0n ? (
            <div className="text-[11px] text-[#4A5878]">The director did not owe the company at the year end, so there is no s455.</div>
          ) : (
            <div className="text-[11px] flex flex-col gap-1">
              <div>
                Overdrawn at {ukDate(ctx.periodEnd)}: <strong className="font-mono">{formatPence(r.s455.overdrawn)}</strong>
              </div>
              <div>
                Repaid by {ukDate(r.s455.nineMonths)} (nine months): <strong className="font-mono">{formatPence(r.s455.repaidAfter)}</strong>
                {r.s455.repaymentsAfter.map((t) => (
                  <div key={t.id} className="text-[10px] text-[#4A5878]">
                    {ukDate(t.date)} · {t.description} · {formatPence(-asPence(t.amount_p))}
                  </div>
                ))}
              </div>
              {r.s455.bed.length > 0 && <div className="text-[#B42318]">{formatPence(r.s455.repaidAfter - r.s455.countable)} doesn&apos;t count: £5,000 or more was drawn again within 30 days of a repayment of £5,000 or more.</div>}
              <div>
                s455 at {CENTRAL_TAX_RATES.s455.rate_pct}% on {formatPence(r.s455.unrepaid)}: <strong className="font-mono">{formatPence(r.s455.s455)}</strong>
                {r.s455.unrepaid === 0n ? ' · claim relief on the CT600A' : ' · to the tax computation'}
              </div>
              {r.s455.windowOpen && r.s455.overdrawn > r.s455.countable && !locked && (
                <label className="flex items-center gap-1.5 mt-1">
                  <input type="checkbox" checked={!!data.s455_not_repaid} onChange={(e) => save({ s455_not_repaid: e.target.checked })} />
                  Not being repaid before {ukDate(r.s455.nineMonths)}
                </label>
              )}
            </div>
          )}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Interest on the overdrawn loan · {r.loan.ty.label} <Pill tone={r.loan.over ? 'warn' : 'good'}>{r.loan.over ? 'Benefit in kind' : 'No benefit'}</Pill>
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="py-0.5">Tax year</td>
                <td className="py-0.5 text-right">
                  {ukDate(r.loan.ty.start)} to {ukDate(r.loan.ty.end)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5">Highest balance owed</td>
                <td className="py-0.5 text-right font-mono">{formatPence(r.loan.peak)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Official rate</td>
                <td className="py-0.5 text-right font-mono">{r.loan.rate}%</td>
              </tr>
              <tr>
                <td className="py-0.5">Average method</td>
                <td className="py-0.5 text-right font-mono">{formatPence(r.loan.average)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Precise method</td>
                <td className="py-0.5 text-right font-mono">{formatPence(r.loan.precise)}</td>
              </tr>
              <tr className="font-bold border-t border-[#D3DCEE]">
                <td className="py-0.5">Benefit · Class 1A NIC ({CENTRAL_TAX_RATES.beneficial_loans.class_1a_pct}%)</td>
                <td className="py-0.5 text-right font-mono">
                  {formatPence(r.loan.benefit)} · {formatPence(r.loan.class1a)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-[#4A5878]">
            {r.loan.over ? 'The loan went over £10,000, so the benefit goes on the P11D and Class 1A to payroll, unless the director pays interest at the official rate.' : 'No benefit while the balance stays at or under £10,000 throughout the tax year.'}{' '}
            {!r.loan.ledgerKnownToEnd && `The ledger doesn't reach ${ukDate(r.loan.ty.end)} yet.`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel engagementId={result.engagementId} date={ctx.periodEnd} lines={r.lines} sent={data.journal} narrative="Director's loan: business costs charged to the loan" source="D-20" locked={locked} save={save} empty="Nothing to move. Mark a purchase as a business cost and its journal appears here." />
        <div className={card}>
          <div className="font-bold mb-2">Advances to directors · note</div>
          <div className="text-[11px] text-[#122654]">{note || `No advances to ${name} in the year.`}</div>
          <div className="mt-1 text-[10px] text-[#4A5878]">Required even in micro-entity accounts.</div>
        </div>
      </div>
    </div>
  );
}

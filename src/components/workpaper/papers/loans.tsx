'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, contextOf, ExpandButton, FlowsTo, JournalPanel, money, newId, Pill, th, Tiles, useOpen } from '../kit';
import { facilitiesOf, loansReview, rowSig, type Facility, type MonthEdit } from '@/lib/workpapers/loans';

const REVIEWERS = ['reviewer', 'manager', 'partner', 'admin'];
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const field = 'px-2 py-1.5 border border-[#D3DCEE] rounded-[8px] bg-white text-xs';

export function LoansSchedule({ data, result, locked, save, filesFor, attachTo, preview, live }: ScheduleProps) {
  const { isOpen, toggle } = useOpen();
  const [tab, setTab] = useState('');
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = loansReview(ctx);
  const actor = getActor();
  const canVouch = REVIEWERS.includes(actor.role) && !locked;
  const tot = (k: string) => result.totals[k] ?? 0n;
  const current = () => facilitiesOf(live(), ctx.periodStart);
  const setFacility = (id: string, patch: Partial<Facility>) => save({ facilities: current().map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const setMonth = (f: Facility, key: string, patch: MonthEdit) => setFacility(f.id, { months: { ...(f.months ?? {}), [key]: { ...(f.months?.[key] ?? {}), ...patch } } });
  const decide = (key: string, patch: { decision?: 'accept' | 'reject'; reason?: string }) => save({ findings: { ...(live().findings ?? {}), [key]: { ...(live().findings?.[key] ?? {}), ...patch } } });
  const addFacility = () => {
    const id = newId('loan');
    save({ facilities: [...current(), { id, name: 'New loan', rate: '', payment_p: '0', start: ctx.periodStart, amount_p: '0', opening_p: '0' }] });
    setTab(id);
    toggle(id);
  };
  // The client's ledger accounts that feed this paper, to tie each facility to its own
  const leadCodes = result.leads.map((l) => l.code);
  const accounts = db.account_mappings.filter((m) => m.engagement_id === ctx.engagementId && leadCodes.some((c) => m.blynt_code?.startsWith(c)));
  const active = r.ws.find((w) => w.f.id === tab) ?? r.ws[0];
  const vouchMatched = () => {
    const f = active.f;
    const months = { ...(f.months ?? {}) };
    for (const row of active.rows.filter((x) => x.source === 'ledger' && !x.vouched)) months[row.key] = { ...(months[row.key] ?? {}), vouched_by: actor.name, vouched_at: new Date().toISOString(), vouched_sig: rowSig(row.paid, row.interest) };
    setFacility(f.id, { months });
  };
  const agreeing = r.ws.filter((w) => w.lender !== null && w.lender === w.closing).length;

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Total borrowings', value: formatPence(r.closing), sub: `${r.ws.length} facilit${r.ws.length === 1 ? 'y' : 'ies'}${r.ws.length && r.ws.every((w) => w.f.security) ? ', all secured' : ''}` },
          { label: 'Due within one year', value: formatPence(r.split.within1), sub: 'capital repayable in the next 12 months' },
          { label: 'Interest for the year', value: formatPence(r.interest), sub: 'from the monthly workings' },
          { label: 'Agrees to lender statements', value: `${agreeing} of ${r.ws.length}`, tone: r.ws.length && agreeing === r.ws.length ? 'good' : 'warn', sub: 'workings against each statement' },
          { label: 'Payments vouched', value: `${r.vouched} of ${r.rowCount}`, tone: r.rowCount && r.vouched === r.rowCount ? 'good' : 'plain', sub: 'by the reviewer, row by row' },
        ]}
      />

      {/* Facilities */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-bold">Facilities</div>
            <div className="text-[10px] text-[#4A5878]">Each balance agreed to the lender&apos;s statement.</div>
          </div>
          {!locked && (
            <button type="button" className={btnAdd} onClick={addFacility}>
              <Plus className="w-3.5 h-3.5" /> Add facility
            </button>
          )}
        </div>
        {!r.ws.length && <p className="text-[11px] text-[#4A5878]">No facilities yet. Add each loan, mortgage or hire purchase agreement with its terms, and the year is worked month by month.</p>}
        {r.ws.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#F5F8FD]">
                <tr>
                  <th className="w-8" />
                  <th className={`${th} text-left`}>Facility</th>
                  <th className={`${th} text-left`}>Security</th>
                  <th className={`${th} text-left`}>Rate and repayment</th>
                  <th className={`${th} text-right`}>Ledger</th>
                  <th className={`${th} text-right`}>Lender</th>
                  <th className={`${th} text-right`}>Difference</th>
                  <th className={`${th} text-left`}>Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E7EF]">
                {r.ws.map((w) => {
                  const f = w.f;
                  const diff = w.lender === null ? null : w.lender - (w.ledger ?? w.closing);
                  return (
                    <React.Fragment key={f.id}>
                      <tr className="align-top">
                        <td className="p-1.5">
                          <ExpandButton open={isOpen(f.id)} label={f.name} onClick={() => toggle(f.id)} />
                        </td>
                        <td className="p-2">
                          <div className="font-bold">{f.name}</div>
                          <div className="text-[10px] text-[#4A5878]">{f.lender}</div>
                        </td>
                        <td className="p-2">{f.security || '–'}</td>
                        <td className="p-2">
                          {f.rate ? `${f.rate}%` : 'Rate to enter'}
                          <div className="text-[10px] text-[#4A5878]">
                            {formatPence(asPence(f.payment_p))} a month{f.ends ? ` · ends ${ukDate(f.ends)}` : ''}
                          </div>
                        </td>
                        <td className="p-2 text-right font-mono">{w.ledger === null ? <span className="text-[#7E8DA6]">no account</span> : money(w.ledger)}</td>
                        <td className="p-1.5 w-32">
                          <MoneyInput label={`Lender statement for ${f.name}`} value={f.lender_p} placeholder="Statement" disabled={locked} onCommit={(p) => setFacility(f.id, { lender_p: p })} />
                        </td>
                        <td className="p-2 text-right">
                          {diff === null ? '–' : diff === 0n ? <Pill tone="good">Agrees</Pill> : <Pill tone="warn">{formatPence(diff < 0n ? -diff : diff)}</Pill>}
                        </td>
                        <td className="p-2">
                          <RowFiles files={filesFor(f.id)} onPreview={preview} onAttach={() => attachTo(f.id)} disabled={locked} label={f.name} />
                        </td>
                      </tr>
                      {isOpen(f.id) && (
                        <tr className="bg-[#FAFBFD]">
                          <td />
                          <td colSpan={7} className="p-2">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-[#4A5878]">
                              <label className="flex flex-col gap-0.5">Name<TextInput label="Facility name" value={f.name} disabled={locked} onCommit={(v) => setFacility(f.id, { name: v })} /></label>
                              <label className="flex flex-col gap-0.5">Lender<TextInput label="Lender" value={f.lender} disabled={locked} onCommit={(v) => setFacility(f.id, { lender: v })} /></label>
                              <label className="flex flex-col gap-0.5">Security<TextInput label="Security" value={f.security} disabled={locked} onCommit={(v) => setFacility(f.id, { security: v })} /></label>
                              <label className="flex flex-col gap-0.5">
                                Ledger account
                                <select aria-label="Ledger account" disabled={locked} value={f.account ?? ''} onChange={(e) => setFacility(f.id, { account: e.target.value || undefined })} className={field}>
                                  <option value="">Not linked: payments per the agreement</option>
                                  {accounts.map((m) => (
                                    <option key={m.source_code} value={m.source_code}>
                                      {m.source_code} {m.source_name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-col gap-0.5">Interest rate %<TextInput label="Interest rate" value={f.rate} disabled={locked} onCommit={(v) => setFacility(f.id, { rate: v.replace(/[^0-9.]/g, '') })} /></label>
                              <label className="flex flex-col gap-0.5">Monthly payment<MoneyInput label="Monthly payment" value={f.payment_p} disabled={locked} onCommit={(p) => setFacility(f.id, { payment_p: p })} /></label>
                              <label className="flex flex-col gap-0.5">Drawn on<input type="date" aria-label="Drawn on" disabled={locked} value={f.start} onChange={(e) => setFacility(f.id, { start: e.target.value })} className={field} /></label>
                              <label className="flex flex-col gap-0.5">Last payment<input type="date" aria-label="Last payment" disabled={locked} value={f.ends ?? ''} onChange={(e) => setFacility(f.id, { ends: e.target.value || undefined })} className={field} /></label>
                              <label className="flex flex-col gap-0.5">Amount drawn<MoneyInput label="Amount drawn" value={f.amount_p} disabled={locked} onCommit={(p) => setFacility(f.id, { amount_p: p })} /></label>
                              <label className="flex flex-col gap-0.5">Owed at {ukDate(ctx.periodStart)}<MoneyInput label="Owed at the start of the year" value={f.opening_p} disabled={locked} onCommit={(p) => setFacility(f.id, { opening_p: p })} /></label>
                              <label className="flex flex-col gap-0.5">Arrangement fee expensed<MoneyInput label="Arrangement fee" value={f.fee_p} disabled={locked} onCommit={(p) => setFacility(f.id, { fee_p: p })} /></label>
                              <span />
                              <label className="flex flex-col gap-0.5">Covenant: loan no more than % of value<TextInput label="Loan to value limit" value={f.ltv_max} disabled={locked} onCommit={(v) => setFacility(f.id, { ltv_max: v.replace(/[^0-9.]/g, '') })} /></label>
                              <label className="flex flex-col gap-0.5">Value of the security<MoneyInput label="Value of the security" value={f.security_value_p} disabled={locked} onCommit={(p) => setFacility(f.id, { security_value_p: p })} /></label>
                              <label className="flex flex-col gap-0.5">Covenant: rent at least × interest<TextInput label="Interest cover" value={f.icr_min} disabled={locked} onCommit={(v) => setFacility(f.id, { icr_min: v.replace(/[^0-9.]/g, '') })} /></label>
                              <label className="flex flex-col gap-0.5">Rent a year<MoneyInput label="Rent a year" value={f.rent_p} disabled={locked} onCommit={(p) => setFacility(f.id, { rent_p: p })} /></label>
                            </div>
                            <div className="mt-2 flex justify-between text-[10px] text-[#4A5878]">
                              <span>{f.start >= ctx.periodStart ? 'Drawn in the year: the workings start the month after.' : 'Drawn before the year: the workings start from the amount owed at the start of the year.'}</span>
                              {!locked && (
                                <button type="button" onClick={() => save({ facilities: current().filter((x) => x.id !== f.id) })} className="inline-flex items-center gap-1 text-[#B42318] hover:underline">
                                  <Trash2 className="w-3 h-3" /> Remove facility
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                <tr className="font-bold border-t-2 border-[#122654]/20">
                  <td />
                  <td className="p-2" colSpan={3}>
                    Total borrowings
                  </td>
                  <td className="p-2 text-right font-mono">{money(r.ws.reduce((a, w) => a + (w.ledger ?? w.closing), 0n))}</td>
                  <td className="p-2 text-right font-mono">{money(r.ws.reduce((a, w) => a + (w.lender ?? 0n), 0n))}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly workings */}
      {active && (
        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
            <div>
              <div className="font-bold">Monthly workings</div>
              <div className="text-[10px] text-[#4A5878]">What the agreement says against what was paid, with the interest each month. Change a figure and everything recalculates; the reviewer vouches each row.</div>
            </div>
            {r.ws.length > 1 && (
              <div className="inline-flex rounded-[8px] border border-[#D3DCEE] overflow-hidden" role="tablist" aria-label="Facility">
                {r.ws.map((w) => (
                  <button key={w.f.id} type="button" role="tab" aria-selected={active.f.id === w.f.id} onClick={() => setTab(w.f.id)} className={`px-3 py-1.5 text-xs font-bold ${active.f.id === w.f.id ? 'bg-[#122654] text-white' : 'bg-white text-[#122654]'}`}>
                    {w.f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px]">
            {active.lender !== null && <Pill tone={active.lender === active.closing ? 'good' : 'warn'}>{active.lender === active.closing ? 'Agrees to the lender' : `${formatPence(active.lender - active.closing)} from the lender`}</Pill>}
            <Pill tone="info">
              {active.rows.filter((x) => x.vouched).length} of {active.rows.length} vouched
            </Pill>
            <span className="text-[#4A5878]">Interest: balance owed × {active.f.rate || '0'}% ÷ 12</span>
            {canVouch && active.rows.some((x) => x.source === 'ledger' && !x.vouched) && (
              <button type="button" className={btnSecondary} onClick={vouchMatched}>
                Vouch rows matched to the ledger
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#F5F8FD]">
                <tr>
                  <th className={`${th} text-left`}>Month</th>
                  <th className={`${th} text-right`}>Per agreement</th>
                  <th className={`${th} text-right`}>Paid</th>
                  <th className={`${th} text-left`}>How it was matched</th>
                  <th className={`${th} text-right`}>Interest</th>
                  <th className={`${th} text-right`}>Capital</th>
                  <th className={`${th} text-right`}>Owed after</th>
                  <th className={`${th} text-left`}>Reviewer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E7EF]">
                {active.rows.map((row) => (
                  <React.Fragment key={row.key}>
                    <tr>
                      <td className="p-2 font-bold whitespace-nowrap">{monthLabel(row.key)}</td>
                      <td className="p-2 text-right font-mono">{money(row.due)}</td>
                      <td className="p-1.5 w-28">
                        <MoneyInput label={`Paid in ${monthLabel(row.key)}`} value={row.paid.toString()} disabled={locked} onCommit={(p) => setMonth(active.f, row.key, { paid_p: p })} />
                      </td>
                      <td className="p-2">
                        {row.source === 'ledger' ? (
                          <Pill tone="good">{row.paidOn ? `Ledger · ${ukDate(row.paidOn)}` : 'Ledger'}</Pill>
                        ) : row.source === 'none' ? (
                          <Pill tone="warn">Not paid in the ledger</Pill>
                        ) : row.source === 'entered' ? (
                          <Pill tone="info">Entered</Pill>
                        ) : (
                          <span className="text-[#7E8DA6]">Per the agreement</span>
                        )}
                      </td>
                      <td className="p-1.5 w-28">
                        <MoneyInput label={`Interest in ${monthLabel(row.key)}`} value={row.interest.toString()} disabled={locked} onCommit={(p) => setMonth(active.f, row.key, { interest_p: p })} />
                      </td>
                      <td className="p-2 text-right font-mono">{money(row.capital)}</td>
                      <td className="p-2 text-right font-mono font-bold">{money(row.owed)}</td>
                      <td className="p-2">
                        {row.vouched ? (
                          <button type="button" disabled={!canVouch} onClick={() => setMonth(active.f, row.key, { vouched_by: undefined, vouched_sig: undefined })} className="text-[10px] font-bold text-[#0B6B52]" title={canVouch ? 'Remove the tick' : undefined}>
                            ✓ {row.vouchedBy}
                          </button>
                        ) : canVouch ? (
                          <button type="button" className="text-[10px] font-bold text-[#1D4E89] underline" onClick={() => setMonth(active.f, row.key, { vouched_by: actor.name, vouched_at: new Date().toISOString(), vouched_sig: rowSig(row.paid, row.interest) })}>
                            Vouch
                          </button>
                        ) : (
                          <span className="text-[10px] text-[#7E8DA6]">Not vouched</span>
                        )}
                      </td>
                    </tr>
                    {(row.note || !locked) && (
                      <tr className="bg-[#FAFBFD]">
                        <td />
                        <td colSpan={7} className="px-2 pb-1.5">
                          <TextInput label={`Note for ${monthLabel(row.key)}`} value={row.note} disabled={locked} placeholder="Note, e.g. payment holiday agreed by letter" onCommit={(v) => setMonth(active.f, row.key, { note: v })} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot className="font-bold border-t-2 border-[#122654]/20">
                <tr>
                  <td className="p-2">Year total</td>
                  <td className="p-2 text-right font-mono">{money(active.due)}</td>
                  <td className="p-2 text-right font-mono">{money(active.paid)}</td>
                  <td className="p-2 text-[10px] font-normal text-[#4A5878]">{active.paid !== active.due ? `Paid ${formatPence(active.due - active.paid < 0n ? active.paid - active.due : active.due - active.paid)} ${active.paid < active.due ? 'less' : 'more'} than the agreement` : ''}</td>
                  <td className="p-2 text-right font-mono">{money(active.interest)}</td>
                  <td className="p-2 text-right font-mono">{money(active.capital)}</td>
                  <td className="p-2 text-right font-mono">{money(active.closing)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-1 text-[10px] text-[#4A5878]">A row changed after it was vouched loses its tick until the reviewer vouches it again. Every change is in the paper&apos;s history.</div>
        </div>
      )}

      {/* Findings */}
      {r.findings.length > 0 && (
        <div className={card}>
          <div className="font-bold">What was found</div>
          <div className="text-[10px] text-[#4A5878] mb-2">Built from the monthly workings. Accept to build the journal, or say why not.</div>
          <div className="flex flex-col gap-2">
            {r.findings.map((x) => (
              <div key={x.key} className={`p-3 rounded-[10px] border ${x.decision ? 'bg-white border-[#E3E7EF]' : 'bg-[#FFF9EC] border-[#C58B00]/30'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-[11px]">{x.title}</span>
                  <span className="font-mono font-bold text-[11px]">{formatPence(x.amount)}</span>
                </div>
                <p className="mt-1 text-[11px] text-[#4A5878]">{x.why}</p>
                {x.decision ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <Pill tone={x.decision === 'accept' ? 'good' : 'info'}>{x.decision === 'accept' ? 'Accepted: in the journal' : 'Declined'}</Pill>
                    {x.decision === 'reject' && (
                      <span className="w-72">
                        <TextInput label="Why not" value={x.reason} disabled={locked} placeholder="Why not (required)" onCommit={(v) => decide(x.key, { reason: v })} />
                      </span>
                    )}
                    {!locked && (
                      <button type="button" className="text-[#1D4E89] underline" onClick={() => decide(x.key, { decision: undefined })}>
                        Undo
                      </button>
                    )}
                  </div>
                ) : (
                  !locked && (
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={btnPrimary} onClick={() => decide(x.key, { decision: 'accept' })}>
                        {x.kind === 'fee' ? 'Spread the fee' : x.kind === 'accrue' ? `Accrue ${formatPence(x.amount)}` : `Post ${formatPence(x.amount)} to interest`}
                      </button>
                      <button type="button" className={btnSecondary} onClick={() => decide(x.key, { decision: 'reject' })}>
                        {x.kind === 'fee' ? 'Keep it expensed' : x.kind === 'accrue' ? "Don't accrue" : 'Leave as posted'}
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Movements and when it is due */}
      {r.ws.length > 0 && (
        <div className={card}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="font-bold">Movements and when it is due</span>
            <span className="text-[10px] text-[#4A5878]">From the monthly workings; the split runs the repayments forward</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#F5F8FD]">
                <tr>
                  <th className={`${th} text-left`} />
                  {r.ws.map((w) => (
                    <th key={w.f.id} className={`${th} text-right`}>
                      {w.f.name}
                    </th>
                  ))}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Movements', null],
                    [`At ${ukDate(ctx.periodStart)}`, (w: (typeof r.ws)[number]) => w.opening],
                    ['Drawn in the year', (w: (typeof r.ws)[number]) => w.drawn],
                    ['Interest charged', (w: (typeof r.ws)[number]) => w.interest],
                    ['Payments made', (w: (typeof r.ws)[number]) => -w.paid],
                    [`Owed at ${ukDate(ctx.periodEnd)}`, (w: (typeof r.ws)[number]) => w.closing, true],
                    ['When the capital is due', null],
                    ['Within one year', (w: (typeof r.ws)[number]) => w.split.within1],
                    ['Between one and five years', (w: (typeof r.ws)[number]) => w.split.oneToFive],
                    ['After more than five years', (w: (typeof r.ws)[number]) => w.split.over5],
                  ] as [string, ((w: (typeof r.ws)[number]) => bigint) | null, boolean?][]
                ).map(([label, fn, strong]) =>
                  fn ? (
                    <tr key={label} className={strong ? 'font-bold bg-[#F5F8FD]' : 'border-t border-[#EEF1F6]'}>
                      <td className="py-1.5 px-2">{label}</td>
                      {r.ws.map((w) => (
                        <td key={w.f.id} className="py-1.5 px-2 text-right font-mono">
                          {money(fn(w))}
                        </td>
                      ))}
                      <td className="py-1.5 px-2 text-right font-mono">{money(r.ws.reduce((a, w) => a + fn(w), 0n))}</td>
                    </tr>
                  ) : (
                    <tr key={label}>
                      <td colSpan={r.ws.length + 2} className="pt-3 pb-1 px-2 font-bold text-[#1D4E89]">
                        {label}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Covenants */}
      {r.ws.some((w) => w.ltv || w.icr) && (
        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Covenants at {ukDate(ctx.periodEnd)}
            <Pill tone={result.checks.find((c) => c.id === 'covenants')?.passed ? 'good' : 'bad'}>{result.checks.find((c) => c.id === 'covenants')?.passed ? 'All met' : 'Broken'}</Pill>
          </div>
          <div className="flex flex-col divide-y divide-[#EEF1F6] text-[11px]">
            {r.ws.flatMap((w) => [
              ...(w.ltv
                ? [
                    <div key={`${w.f.id}-ltv`} className="py-1.5 flex items-center gap-2">
                      <span className="flex-1">
                        {w.f.name} · loan to value · no more than {w.ltv.max}%
                        <span className="block text-[10px] text-[#4A5878]">The security can fall to {formatPence(w.ltv.headroom)} before this breaks</span>
                      </span>
                      <span className={`font-mono font-bold ${w.ltv.pct > w.ltv.max ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>{w.ltv.pct.toFixed(1)}%</span>
                    </div>,
                  ]
                : []),
              ...(w.icr
                ? [
                    <div key={`${w.f.id}-icr`} className="py-1.5 flex items-center gap-2">
                      <span className="flex-1">
                        {w.f.name} · interest cover · at least {w.icr.min}×
                        <span className="block text-[10px] text-[#4A5878]">
                          Rent {formatPence(asPence(w.f.rent_p))} a year against interest of {formatPence(w.split.interestNext12)} over the next 12 months
                        </span>
                      </span>
                      <span className={`font-mono font-bold ${w.icr.times < w.icr.min ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>{w.icr.times.toFixed(2)}×</span>
                    </div>,
                  ]
                : []),
            ])}
          </div>
          {!result.checks.find((c) => c.id === 'covenants')?.passed && !locked && (
            <label className="mt-2 flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={!!data.covenant_waived} onChange={(e) => save({ covenant_waived: e.target.checked })} />
              The lender waived the breach before the year end
            </label>
          )}
          <div className="mt-2 p-2 rounded-[8px] bg-[#FFF9EC] text-[10px] text-[#8A5A00]">A covenant broken at the year end and not waived by then moves the whole loan to due within one year.</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel engagementId={result.engagementId} date={ctx.periodEnd} lines={r.lines} sent={data.journal} narrative="Loans: interest charged, accrued and the arrangement fee spread" source={result.template.ref} locked={locked} save={save} title="Year-end journals" empty="No journal yet. Accept a finding above to build one." />
        <AccountsPreview
          rows={[
            { label: 'Creditors due within one year · bank loans', amount: r.split.within1 },
            { label: 'Creditors due after more than one year · bank loans', amount: r.split.oneToFive + r.split.over5 },
            { label: 'Interest payable and similar charges', amount: tot('interest') },
            { label: 'Note · debts due after more than five years', amount: r.split.over5 },
            { label: 'Note · secured debts', amount: r.ws.filter((w) => w.f.security).reduce((a, w) => a + w.closing, 0n) },
          ]}
          note="The split between within and after one year is made on the balance sheet from the repayments, so no reclass journal is needed."
        />
      </div>
      <FlowsTo
        engagementId={result.engagementId}
        rows={[
          { ref: 'Z-40', label: 'Balance sheet analysis', detail: 'Bank loans, split by when due', amount: r.closing },
          { ref: 'Z-30', label: 'P&L analysis · Interest payable', detail: 'Interest for the year', amount: r.interest },
          { ref: 'K-20', label: 'Accruals', detail: 'Interest to the year end, if accrued', amount: r.findings.filter((x) => x.kind === 'accrue' && x.decision === 'accept').reduce((a, x) => a + x.amount, 0n) },
          { ref: 'B-10', label: 'Bank and cash', detail: 'Every payment traced to the bank', amount: r.paid },
          { ref: 'G-10', label: 'Investments and investment property', detail: 'The security; its value drives the covenants', amount: null },
          { ref: 'T-10', label: 'Tax computation', detail: 'Interest deductible; the fee follows the accounts', amount: null },
          { ref: 'R-20', label: 'Statutory information', detail: 'Charges registered at Companies House', amount: null },
        ]}
      />
    </div>
  );
}

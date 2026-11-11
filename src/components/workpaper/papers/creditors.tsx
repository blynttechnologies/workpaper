'use client';

import React, { useState } from 'react';
import { Landmark, RefreshCw, Search } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { db } from '@/lib/server/db';
import { services } from '@/lib/server/services';
import { getActor } from '@/lib/session';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, CodePicker, ExpandButton, FilterChips, JournalPanel, money, Pill, SuggestBanner, SuggestionRow, th, Tiles, useOpen } from '../kit';
import { expenseCodes } from '@/lib/workpapers/common';
import { bankMatches, creditorsJournal, searchAfterDate, supplierView, suppliersFromLedger, type SearchItem, type Supplier, type SupplierDecision } from '@/lib/workpapers/creditors';

const STATUS: Record<ReturnType<typeof supplierView>['status'], [string, 'good' | 'bad' | 'warn' | 'plain' | 'info']> = {
  none: ['No statement', 'plain'],
  difference: ['Difference', 'warn'],
  debit: ['Debit balance', 'bad'],
  dispute: ['Check for dispute', 'warn'],
  done: ['Done', 'good'],
};

export function CreditorsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const { isOpen, toggle, show } = useOpen();
  const [filter, setFilter] = useState<'all' | 'attention' | 'done'>('all');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const eng = db.engagements.find((e) => e.id === result.engagementId);
  const pe = eng?.period_end ?? '';
  const peLabel = pe ? ukDate(pe) : 'the period end';
  const windowDays = Number(data.search?.window_days ?? 60);
  const minimum = asPence(data.search?.min_p ?? '10000');
  const tot = (k: string) => result.totals[k] ?? 0n;
  const views = ((data.suppliers ?? []) as Supplier[]).map(supplierView);
  const items: SearchItem[] = data.search?.items ?? [];
  const codes = expenseCodes();

  const setSupplier = (id: string, patch: Partial<Supplier>) => save({ suppliers: (live().suppliers ?? []).map((s: Supplier) => (s.id === id ? { ...s, ...patch } : s)) });
  const decide = (id: string, decision: SupplierDecision | undefined) => setSupplier(id, { decision });
  const setItem = (id: string, patch: Partial<SearchItem>) => save({ search: { ...(live().search ?? {}), items: (live().search?.items ?? []).map((i: SearchItem) => (i.id === id ? { ...i, ...patch } : i)) } });
  const askClient = (s: Supplier) => {
    const wp = db.workpapers.find((w) => w.engagement_id === result.engagementId && w.ref === result.template.ref);
    if (wp && eng) {
      services.addComment(eng.firm_id, getActor(), wp.id, {
        type: 'client_query',
        anchor_json: { kind: 'row', table: 'schedule', row: s.id },
        body: `${s.name}: ${formatPence(asPence(s.ledger_p))} was owed at ${peLabel} and nothing has been paid since. Is any of it disputed, or not owed?`,
      });
    }
    setSupplier(s.id, { dispute: 'ask' });
  };
  const refresh = () => {
    const s = suppliersFromLedger(result.engagementId, pe, windowDays, live().suppliers ?? []);
    if (!s) return setNote({ ok: false, text: 'The creditors control account has no ledger transactions yet. Import them from the accounting system, or add suppliers by hand.' });
    save({ suppliers: s, refreshed_at: new Date().toISOString() });
    setNote({ ok: true, text: `${s.length} supplier${s.length === 1 ? '' : 's'} from the ledger at ${peLabel}.` });
  };
  const [checking, setChecking] = useState(false);
  const checkBank = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/v1/integrations/xero/bank-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engagementId: result.engagementId, days: windowDays }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setNote({ ok: false, text: body.error || 'Could not read the Xero bank account.' });
      const suppliers = (live().suppliers ?? []).map((s: Supplier) => ({ ...s, bank_check: { to: body.to, matches: bankMatches(s, body.payments ?? []) } }));
      save({ suppliers });
      const found = suppliers.filter((s: Supplier) => s.bank_check!.matches.length).length;
      setNote({ ok: true, text: `${body.payments?.length ?? 0} payment${body.payments?.length === 1 ? '' : 's'} out of the Xero bank from ${ukDate(body.from)} to ${ukDate(body.to)}; ${found} of ${suppliers.length} suppliers have a matching payment.` });
    } catch {
      setNote({ ok: false, text: 'Could not reach Xero. Try again.' });
    } finally {
      setChecking(false);
    }
  };
  const runSearch = () => {
    const found = searchAfterDate(result.engagementId, pe, windowDays, minimum, live().search?.items ?? []);
    save({ search: { ...(live().search ?? {}), window_days: windowDays, min_p: minimum.toString(), items: found, searched_at: new Date().toISOString() } });
  };
  const addSupplier = () => {
    const id = `sup_${Date.now()}`;
    save({ suppliers: [...(live().suppliers ?? []), { id, name: '', ledger_p: '0', statement_p: '', paid_after_p: '0' }] });
    show(id);
  };
  const pending = views.filter((v) => v.suggestion && !v.s.decision && (v.suggestion.kind !== 'missing_invoice' || v.s.expense_code));
  const acceptAll = () =>
    save({
      suppliers: (live().suppliers ?? []).map((s: Supplier) => {
        const v = supplierView(s);
        return s.decision || !v.suggestion || (v.suggestion.kind === 'missing_invoice' && !s.expense_code) ? s : { ...s, decision: v.suggestion.kind };
      }),
    });

  const attention = (v: ReturnType<typeof supplierView>) => v.status !== 'done';
  const shown = views.filter((v) => (filter === 'attention' ? attention(v) : filter === 'done' ? !attention(v) : true));
  const withStatement = views.filter((v) => v.ledger > 0n && v.entered && filesFor(v.s.id).length);
  const owedCount = views.filter((v) => v.ledger > 0n).length;
  const control = result.checks.find((c) => c.id === 'control_tb');
  const lines = creditorsJournal(data);

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Aged creditors vs TB 750', value: control?.passed ? 'Agrees' : 'Differs', tone: control?.passed ? 'good' : 'bad', sub: `${formatPence(tot('aged'))} · ${views.length} suppliers` },
          { label: 'Statements on file', value: `${withStatement.length} of ${owedCount}`, sub: 'suppliers owed money' },
          { label: 'Unrecorded liabilities found', value: formatPence(tot('found')), tone: tot('found') ? 'warn' : 'plain', sub: `${items.filter((i) => !i.decision).length} to decide · ${items.length} items` },
          { label: 'Paid after period end', value: tot('owed') ? `${Number((tot('paid_after') * 100n) / tot('owed'))}%` : '–', sub: `${formatPence(tot('paid_after'))} of ${formatPence(tot('owed'))} within ${windowDays} days` },
          { label: 'Trade creditors after adjustments', value: formatPence(tot('after_adjustments')), sub: tot('debit_balances') ? `${formatPence(tot('debit_balances'))} of debit balances` : 'no debit balances' },
        ]}
      />
      <SuggestBanner
        count={pending.length}
        locked={locked}
        onAccept={acceptAll}
        text={pending.map((v) => `${v.s.name}: ${v.suggestion!.kind === 'debtors' ? 'move the debit balance to debtors' : v.suggestion!.kind === 'timing' ? 'payment in transit' : `add the missing ${formatPence(v.diff!)}`}`).join(' · ') + '.'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'All', count: views.length },
            { key: 'attention', label: 'Needs attention', count: views.filter(attention).length },
            { key: 'done', label: 'Done', count: views.filter((v) => !attention(v)).length },
          ]}
        />
        {!locked && (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={refresh} className={btnAdd}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh from ledger
            </button>
            <button type="button" onClick={checkBank} disabled={checking || !views.length} className={btnAdd}>
              <Landmark className="w-3.5 h-3.5" /> {checking ? 'Checking Xero bank…' : 'Check Xero bank'}
            </button>
            <button type="button" onClick={addSupplier} className={btnAdd}>
              + Add supplier
            </button>
          </div>
        )}
      </div>
      {note && <div className={`-mt-2 text-[11px] ${note.ok ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>{note.text}</div>}

      <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className="w-8" />
              <th className={`${th} text-left`}>Supplier</th>
              <th className={`${th} text-right`}>Ledger</th>
              <th className={`${th} text-right w-[130px]`}>Statement</th>
              <th className={`${th} text-right`}>Difference</th>
              <th className={`${th} text-right`}>Paid after</th>
              <th className={`${th} text-right`}>Oldest</th>
              <th className={`${th} text-left`}>Status</th>
              <th className={`${th} text-left`}>Statement on file</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {views.length === 0 && (
              <tr>
                <td colSpan={9} className="p-3 text-[11px] text-[#7E8DA6]">
                  No suppliers yet. Refresh from the ledger, or add suppliers by hand.
                </td>
              </tr>
            )}
            {shown.map((v) => {
              const s = v.s;
              const name = s.name || 'New supplier';
              const [label, tone] = STATUS[v.status];
              return (
                <React.Fragment key={s.id}>
                  <tr
                    onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = Array.from(e.dataTransfer.files ?? []);
                      if (f.length && !locked && dropFiles) dropFiles(f, s.id);
                    }}
                  >
                    <td className="p-1.5 align-top">
                      <ExpandButton open={isOpen(s.id)} label={`details for ${name}`} onClick={() => toggle(s.id)} />
                    </td>
                    <td className="p-2 align-top">
                      <div className="font-bold">{name}</div>
                      <div className="text-[10px] text-[#4A5878]">{s.invoices?.length ? `${s.invoices.length} open invoice${s.invoices.length === 1 ? '' : 's'}` : v.debit ? 'debit balance' : ''}</div>
                    </td>
                    <td className="p-2 align-top text-right font-mono font-bold">{money(v.ledger)}</td>
                    <td className="p-1.5 align-top">
                      {v.debit ? (
                        <div className="text-right text-[10px] text-[#7E8DA6] pt-1.5">Not needed</div>
                      ) : (
                        <MoneyInput label={`Statement balance for ${name}`} value={s.statement_p} placeholder="Enter or attach" disabled={locked} onCommit={(p) => setSupplier(s.id, { statement_p: p })} />
                      )}
                    </td>
                    <td className={`p-2 align-top text-right font-mono ${v.diff ? 'text-[#B8432F] font-bold' : ''}`}>{v.diff === null ? '–' : money(v.diff)}</td>
                    <td className="p-2 align-top text-right">
                      <div className={`font-mono ${v.ledger > 0n && v.paid === 0n ? 'text-[#B42318]' : v.paid >= v.ledger && v.ledger > 0n ? 'text-[#0B6B52]' : ''}`}>{v.ledger > 0n && v.paid === 0n ? 'Nil' : money(v.paid)}</div>
                      {s.payments_after?.length ? <div className="text-[10px] text-[#4A5878]">{ukDate(s.payments_after[0].date)}</div> : null}
                      {s.bank_check &&
                        (s.bank_check.matches.length ? (
                          <div className="text-[10px] text-[#0B6B52]">
                            In Xero bank: {formatPence(asPence(s.bank_check.matches[0].amount_p))} on {ukDate(s.bank_check.matches[0].date)}
                            {s.bank_check.matches[0].reconciled ? '' : ' (not reconciled)'}
                            {s.bank_check.matches.length > 1 ? ` +${s.bank_check.matches.length - 1} more` : ''}
                          </div>
                        ) : (
                          <div className="text-[10px] text-[#B42318]">Not in Xero bank to {ukDate(s.bank_check.to)}</div>
                        ))}
                    </td>
                    <td className="p-2 align-top text-right">{s.oldest_days ? <Pill tone={s.oldest_days > 90 ? 'warn' : 'plain'}>{s.oldest_days} days</Pill> : '–'}</td>
                    <td className="p-2 align-top">
                      <Pill tone={tone}>{label}</Pill>
                    </td>
                    <td className="p-2 align-top">
                      <div className="flex items-center gap-2 flex-wrap">
                        {tickFor(s.id, name)}
                        <RowFiles files={filesFor(s.id)} onPreview={preview} onAttach={() => attachTo(s.id)} disabled={locked} label={`the statement for ${name}`} />
                      </div>
                    </td>
                  </tr>
                  {(isOpen(s.id) || (v.suggestion && !s.decision) || (v.needsDispute && !s.dispute)) && (
                    <tr className="bg-[#FAFBFD]">
                      <td />
                      <td colSpan={8} className="p-3 flex flex-col gap-2">
                        {v.suggestion && !s.decision && (
                          <SuggestionRow
                            actions={
                              !locked &&
                              (v.suggestion.kind === 'debtors' ? (
                                <>
                                  <button type="button" className={btnPrimary} onClick={() => decide(s.id, 'debtors')}>
                                    Move to debtors
                                  </button>
                                  <button type="button" className={btnSecondary} onClick={() => decide(s.id, 'leave')}>
                                    Leave
                                  </button>
                                </>
                              ) : v.suggestion.kind === 'missing_invoice' ? (
                                <>
                                  <CodePicker label={`Expense account for ${name}`} value={s.expense_code} codes={codes} disabled={locked} onChange={(c) => setSupplier(s.id, { expense_code: c })} />
                                  <button type="button" className={btnPrimary} disabled={!s.expense_code} onClick={() => decide(s.id, 'missing_invoice')}>
                                    Add to creditors
                                  </button>
                                  <button type="button" className={btnSecondary} onClick={() => decide(s.id, 'not_ours')}>
                                    Not ours
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className={btnPrimary} onClick={() => decide(s.id, 'timing')}>
                                    Accept as timing
                                  </button>
                                  <button type="button" className={btnSecondary} onClick={() => decide(s.id, 'not_ours')}>
                                    Other reason
                                  </button>
                                </>
                              ))
                            }
                          >
                            {v.suggestion.why}
                          </SuggestionRow>
                        )}
                        {v.needsDispute && !s.dispute && (
                          <SuggestionRow
                            actions={
                              !locked && (
                                <>
                                  <button type="button" className={btnPrimary} onClick={() => askClient(s)}>
                                    Ask the client
                                  </button>
                                  <button type="button" className={btnSecondary} onClick={() => setSupplier(s.id, { dispute: 'not_disputed' })}>
                                    Not disputed
                                  </button>
                                </>
                              )
                            }
                          >
                            Nothing paid since the period end and the oldest invoice is {s.oldest_days} days old. It may be disputed or not owed.
                          </SuggestionRow>
                        )}
                        {s.decision && (
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <Pill tone="info">
                              {
                                {
                                  missing_invoice: `Missing invoice added${s.expense_code ? ` to ${s.expense_code}` : ''}`,
                                  timing: 'Payment in transit',
                                  not_ours: 'Not ours',
                                  debtors: 'Moved to other debtors',
                                  leave: 'Left in creditors',
                                }[s.decision]
                              }
                            </Pill>
                            {s.decision === 'missing_invoice' && (
                              <label className="flex items-center gap-1">
                                VAT included
                                <span className="w-24">
                                  <MoneyInput label={`VAT in the missing invoice for ${name}`} value={s.vat_p} disabled={locked} allowNegative={false} onCommit={(p) => setSupplier(s.id, { vat_p: p })} />
                                </span>
                                {!locked && v.diff && (
                                  <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => setSupplier(s.id, { vat_p: ((v.diff! + 3n) / 6n).toString() })}>
                                    20%
                                  </button>
                                )}
                              </label>
                            )}
                            {(s.decision === 'not_ours' || s.decision === 'leave') && (
                              <span className="w-64">
                                <TextInput label={`Reason for ${name}`} value={s.reason} disabled={locked} placeholder="Reason (required)" onCommit={(r) => setSupplier(s.id, { reason: r })} />
                              </span>
                            )}
                            {!locked && (
                              <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => decide(s.id, undefined)}>
                                Undo
                              </button>
                            )}
                          </div>
                        )}
                        {s.dispute && (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#4A5878]">
                            {s.dispute === 'ask' ? 'Sent to the client as a query in Comments.' : 'Not disputed:'}
                            {s.dispute === 'not_disputed' && (
                              <span className="w-72">
                                <TextInput label={`Why ${name} is not disputed`} value={s.dispute_reason} disabled={locked} placeholder="Reason (required), e.g. client confirmed, paid 3 Jun" onCommit={(r) => setSupplier(s.id, { dispute_reason: r })} />
                              </span>
                            )}
                            {!locked && (
                              <button type="button" className="text-[#1D4E89] underline" onClick={() => setSupplier(s.id, { dispute: undefined })}>
                                Undo
                              </button>
                            )}
                          </div>
                        )}
                        {isOpen(s.id) && (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                            <div className={card}>
                              <div className="font-bold mb-1">Open invoices at {peLabel}</div>
                              {!s.invoices?.length && <div className="text-[11px] text-[#7E8DA6]">None from the ledger.</div>}
                              {s.invoices?.map((i, k) => (
                                <div key={k} className="flex justify-between gap-2 text-[11px] border-t border-[#EEF1F6] py-1">
                                  <span>{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="text-[#1D4E89] underline">{i.ref || 'Invoice'}</a> : i.ref || 'Invoice'}</span>
                                  <span>{ukDate(i.date)}</span>
                                  <span className="font-mono">{formatPence(asPence(i.amount_p), { symbol: '' })}</span>
                                </div>
                              ))}
                              {!s.invoices && (
                                <label className="flex flex-col gap-1 mt-1">
                                  <span className="text-[10px] font-semibold text-[#4A5878]">Supplier name and ledger balance</span>
                                  <TextInput label="Supplier name" value={s.name} disabled={locked} onCommit={(n) => setSupplier(s.id, { name: n })} />
                                  <MoneyInput label={`Ledger balance for ${name}`} value={s.ledger_p} disabled={locked} onCommit={(p) => setSupplier(s.id, { ledger_p: p })} />
                                </label>
                              )}
                            </div>
                            <div className={card}>
                              <div className="font-bold mb-1">Paid after {peLabel}</div>
                              {!s.payments_after?.length && <div className="text-[11px] text-[#7E8DA6]">No payment to this supplier in the {windowDays} days after the period end.</div>}
                              {s.payments_after?.map((p, k) => (
                                <div key={k} className="flex justify-between gap-2 text-[11px] border-t border-[#EEF1F6] py-1">
                                  <span>{ukDate(p.date)}</span>
                                  <span className="flex-1">{p.desc}</span>
                                  <span className="font-mono">{formatPence(asPence(p.amount_p), { symbol: '' })}</span>
                                </div>
                              ))}
                              {s.bank_check && (
                                <>
                                  <div className="font-bold mt-2 mb-1">Xero bank to {ukDate(s.bank_check.to)}</div>
                                  {!s.bank_check.matches.length && <div className="text-[11px] text-[#7E8DA6]">No payment by this name, or for an open invoice amount, left the bank.</div>}
                                  {s.bank_check.matches.map((p, k) => (
                                    <div key={k} className="flex justify-between gap-2 text-[11px] border-t border-[#EEF1F6] py-1">
                                      <span>{ukDate(p.date)}</span>
                                      <span className="flex-1">
                                        {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="text-[#1D4E89] underline">{p.contact || p.ref}</a> : p.contact || p.ref}
                                        {p.reconciled ? '' : ' · not reconciled'}
                                      </span>
                                      <span className="font-mono">{formatPence(asPence(p.amount_p), { symbol: '' })}</span>
                                    </div>
                                  ))}
                                </>
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
          </tbody>
          {views.length > 0 && (
            <tfoot className="border-t-2 border-[#122654]/20 font-bold">
              <tr>
                <td />
                <td className="p-2">Total · {control?.passed ? 'agrees to TB 750' : 'differs from TB 750'}</td>
                <td className="p-2 text-right font-mono">{money(tot('aged'))}</td>
                <td className="p-2 text-right font-mono">{money(views.reduce((a, v) => a + (v.statement ?? 0n), 0n))}</td>
                <td className="p-2 text-right font-mono">{money(views.reduce((a, v) => a + (v.diff ?? 0n), 0n))}</td>
                <td className="p-2 text-right font-mono">{money(tot('paid_after'))}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="-mt-2 text-[10px] text-[#4A5878]">Amounts owed are positive; debit balances are in brackets. Enter the statement balance from the supplier's statement and attach it to the row.</p>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div>
            <div className="font-bold">Search for unrecorded liabilities</div>
            <div className="text-[10px] text-[#4A5878]">
              {data.search?.searched_at
                ? `${items.length} cost${items.length === 1 ? '' : 's'} over ${formatPence(minimum)} posted in the ${windowDays} days after ${peLabel}. Decide which belong to this year.`
                : `Costs over ${formatPence(minimum)} posted in the ${windowDays} days after ${peLabel}, from the ledger.`}
            </div>
          </div>
          {!locked && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px]">
                Days
                <input
                  type="number"
                  min={1}
                  aria-label="Days after the period end to search"
                  defaultValue={windowDays}
                  onBlur={(e) => Number(e.target.value) !== windowDays && save({ search: { ...(live().search ?? {}), window_days: Number(e.target.value) || 60 } })}
                  className="w-14 px-1.5 py-1 border border-[#D3DCEE] rounded-[6px] text-right"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px]">
                Over £
                <span className="w-24">
                  <MoneyInput label="Minimum amount to search" value={minimum.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ search: { ...(live().search ?? {}), min_p: p } })} />
                </span>
              </label>
              <button type="button" onClick={runSearch} className={btnAdd}>
                <Search className="w-3.5 h-3.5" /> {data.search?.searched_at ? 'Search again' : 'Search'}
              </button>
            </div>
          )}
        </div>
        {data.search?.searched_at && items.length === 0 && <div className="text-[11px] text-[#4A5878]">Nothing over the minimum was posted in the window.</div>}
        {items.length > 0 && (
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Posted</th>
                <th className={`${th} text-left`}>Item</th>
                <th className={`${th} text-left`}>Account</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-left`}>Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {items.map((i) => (
                <tr key={i.id} className={i.decision ? '' : 'bg-[#FFF8E6]'}>
                  <td className="p-2">{ukDate(i.date)}</td>
                  <td className="p-2">
                    <div className="font-semibold">{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="underline">{i.contact || i.desc}</a> : i.contact || i.desc}</div>
                    {i.contact && <div className="text-[10px] text-[#4A5878]">{i.desc}</div>}
                  </td>
                  <td className="p-2">
                    <CodePicker label={`Account for ${i.contact || i.desc}`} value={i.code} codes={codes} disabled={locked || !!i.decision} onChange={(c) => setItem(i.id, { code: c })} />
                  </td>
                  <td className="p-2 text-right font-mono">{formatPence(asPence(i.amount_p), { symbol: '' })}</td>
                  <td className="p-2">
                    {i.decision ? (
                      <span className="flex items-center gap-2">
                        <Pill tone={i.decision === 'not_liability' ? 'plain' : 'info'}>{{ accrue: 'Accrued', creditor: 'Added to creditors', not_liability: 'Not this year' }[i.decision]}</Pill>
                        {!locked && (
                          <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => setItem(i.id, { decision: undefined })}>
                            Undo
                          </button>
                        )}
                      </span>
                    ) : (
                      !locked && (
                        <span className="flex gap-1">
                          <button type="button" className={btnPrimary} onClick={() => setItem(i.id, { decision: 'accrue' })}>
                            Accrue
                          </button>
                          <button type="button" className={btnSecondary} onClick={() => setItem(i.id, { decision: 'creditor' })}>
                            Add to creditors
                          </button>
                          <button type="button" className={btnSecondary} onClick={() => setItem(i.id, { decision: 'not_liability' })}>
                            Not this year
                          </button>
                        </span>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel
          engagementId={result.engagementId}
          date={pe}
          lines={lines}
          sent={data.journal}
          narrative="Trade creditors: missing invoices, accruals found after the period end and debit balances"
          source="K-10"
          locked={locked}
          save={save}
          title="Year-end journals"
        />
        <AccountsPreview
          rows={[
            { label: 'Trade creditors per ledger', amount: tot('control') },
            { label: 'Missing invoices and bills added', amount: lines.filter((l) => l.code === '750').reduce((a, l) => a + l.credit, 0n) },
            { label: 'Debit balances moved to debtors', amount: lines.filter((l) => l.code === '750').reduce((a, l) => a + l.debit, 0n) },
            { label: 'Trade creditors due within one year', amount: tot('after_adjustments'), strong: true },
            { label: 'Accruals (on the Accruals paper)', amount: lines.filter((l) => l.code === '760').reduce((a, l) => a + l.credit, 0n) },
          ]}
        />
      </div>
    </div>
  );
}

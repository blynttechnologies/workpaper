'use client';

import { Notice } from '@/components/ui/Notice';
import React, { useState } from 'react';
import { Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { db } from '@/lib/server/db';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { btnAdd, btnPrimary, btnSecondary, CodePicker, JournalPanel, money, newId, Pill, SuggestBanner, th, Tiles } from '../kit';
import { addDays, expenseCodes } from '@/lib/workpapers/common';
import { accruedIncome, findPrepaidCosts, lastYear, prepaymentsJournal, prepView, type PrepLine } from '@/lib/workpapers/prepayments';

export function PrepaymentsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<'prep' | 'accrued'>('prep');
  const eng = db.engagements.find((e) => e.id === result.engagementId);
  const pe = eng?.period_end ?? '';
  const ctx = {
    engagementId: result.engagementId,
    priorId: eng?.prior_engagement_id ?? null,
    periodEnd: pe,
    tb: (prefix: string) => {
      const l = result.leads.find((x) => x.code === prefix);
      return { draft: l?.draft ?? 0n, adjustments: l?.adjustments ?? 0n, final: l?.final ?? 0n, mapped: !!l?.mapped };
    },
  };
  const minimum = asPence(data.min_p ?? '10000');
  const views = ((data.prepayments ?? []) as PrepLine[]).map((l) => prepView(l, pe));
  const accrued = accruedIncome(result.engagementId);
  const ly = lastYear(ctx);
  const lines = prepaymentsJournal(ctx, data);
  const tot = (k: string) => result.totals[k] ?? 0n;
  const codes = expenseCodes();

  const setLine = (id: string, patch: Partial<PrepLine>) => save({ prepayments: (live().prepayments ?? []).map((l: PrepLine) => (l.id === id ? { ...l, ...patch } : l)) });
  // The AI reads each cost still to decide: the period it covers when the description says, and whether it runs past the year end. It never decides.
  const [aiReading, setAiReading] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const unread = (l: PrepLine) => !!l.found && !l.decision && !l.ai;
  const readCosts = async (ids: string[]) => {
    if (!ids.length) return;
    setAiReading(true);
    setAiNote('');
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(result.engagementId)}/ai-prepaid-costs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The AI could not read these costs. Try again.');
      const read = new Map<string, NonNullable<PrepLine['ai']>>((body.items ?? []).map((x: { id: string; from: string; to: string; summary: string }) => [x.id, { from: x.from, to: x.to, summary: x.summary }]));
      save({ prepayments: (live().prepayments ?? []).map((l: PrepLine) => (read.has(l.id) ? { ...l, ai: read.get(l.id) } : l)) });
    } catch (e) {
      setAiNote((e as Error).message);
    } finally {
      setAiReading(false);
    }
  };
  const scan = () => {
    // live(), not the render's value: the amount box commits on blur, just before this click
    const minimum = asPence(live().min_p ?? '10000');
    // Ledger suggestions now under the amount are dropped, added or not. Hand-added lines stay, and so does a
    // suggestion someone has worked on: its period entered or its invoice attached
    const all = (live().prepayments ?? []) as PrepLine[];
    const kept = all.filter((l) => !(l.found && asPence(l.net_p) < minimum && !l.end && l.method !== 'all' && !filesFor(l.id).length));
    const dropped = all.length - kept.length;
    const r = findPrepaidCosts(result.engagementId, pe, minimum, kept);
    const lines = [...kept.filter((l) => !r.dupes.has(l.id)).map((l) => ({ ...l, ...r.links.get(l.id) })), ...r.found];
    save({ prepayments: lines, scanned_at: new Date().toISOString(), scan: { scanned: r.scanned, small: r.small, small_p: r.smallTotal.toString() } });
    void readCosts(lines.filter(unread).map((l) => l.id));
    setNote(
      `${r.scanned} cost${r.scanned === 1 ? '' : 's'} in the year scanned; ${r.found.length} new one${r.found.length === 1 ? '' : 's'} read like they run past the year end.${r.small ? ` ${r.small} under ${formatPence(minimum)} (${formatPence(r.smallTotal)}) left out.` : ''}${dropped ? ` ${dropped} taken off the list.` : ''} Enter the period covered from each invoice.`
    );
  };
  const add = () => save({ prepayments: [...(live().prepayments ?? []), { id: newId('prep'), desc: '', code: '', net_p: '0', method: 'months', start: addDays(pe, -30) }] });
  const pending = views.filter((v) => v.l.found && !v.l.decision);
  const counted = views.filter((v) => v.counted && v.prepaid > 0n);
  const date = (v: string | undefined, label: string, onChange: (d: string) => void) => (
    <input type="date" aria-label={label} value={v ?? ''} disabled={locked} onChange={(e) => onChange(e.target.value)} className="w-[110px] px-1.5 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px] disabled:bg-[#F5F8FD]" />
  );

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Prepayments', value: formatPence(tot('prepaid')), sub: `${counted.length} items · last year ${formatPence(ly.total)}` },
          { label: 'Accrued income', value: formatPence(tot('accrued')), sub: 'from the Revenue paper' },
          { label: 'Costs scanned', value: data.scan ? String(data.scan.scanned) : '–', sub: data.scan ? `${pending.length} to decide · ${data.scan.small} under ${formatPence(minimum)} left out` : 'search the ledger below' },
          {
            label: "Last year's prepayments",
            value: ly.reversed || tot('tb_draft') === 0n ? 'Released' : 'Still in 7300',
            tone: ly.reversed || tot('tb_draft') === 0n ? 'good' : 'warn',
            sub: ly.reversed ? `${formatPence(ly.total)} reversed on ${ukDate(eng?.period_start ?? '')}` : `${formatPence(tot('tb_draft'))} in the TB before adjustments`,
          },
          { label: 'Evidence', value: `${counted.filter((v) => filesFor(v.l.id).length).length} of ${counted.length}`, sub: 'invoice on every line' },
        ]}
      />
      <SuggestBanner
        count={pending.length}
        locked={locked}
        onAccept={() => save({ prepayments: (live().prepayments ?? []).map((l: PrepLine) => (l.found && !l.decision ? { ...l, decision: 'add' } : l)) })}
        decided={views.filter((v) => v.l.found && v.l.decision).length}
        onUndo={() => save({ prepayments: (live().prepayments ?? []).map((l: PrepLine) => (l.found && l.decision ? { ...l, decision: undefined } : l)) })}
        text={`${pending.map((v) => v.l.desc).join(' · ')} read like costs that run past the year end. Enter the period from each invoice so the prepaid part is right.`}
      />

      <div className="flex flex-col gap-2 p-3 bg-white border border-[#E3E7EF] rounded-[12px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E3E7EF]">
        <div role="tablist" aria-label="Schedule" className="flex gap-1">
          {(
            [
              ['prep', `Prepayments (${views.length})`],
              ['accrued', `Accrued income (${accrued.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs border-b-2 -mb-px whitespace-nowrap ${tab === k ? 'font-bold border-[#FF7A66] text-[#122654]' : 'font-semibold border-transparent text-[#4A5878] hover:text-[#122654]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {!locked && tab === 'prep' && (
          <div className="ml-auto mb-1.5 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px]">
              Ignore items under £
              <span className="w-20">
                <MoneyInput label="Ignore items under" value={minimum.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ min_p: p })} />
              </span>
            </label>
            <button type="button" onClick={scan} className={btnAdd}>
              <Search className="w-3.5 h-3.5" /> {data.scanned_at ? 'Search the ledger again' : 'Search the ledger'}
            </button>
            <button type="button" onClick={add} className={btnAdd}>
              <Plus className="w-3.5 h-3.5" /> Add line
            </button>
          </div>
        )}
      </div>
      {note && <Notice tone="ok" inline>{note}</Notice>}
      {aiNote && <Notice inline>{aiNote}</Notice>}
      {!locked && !aiReading && tab === 'prep' && views.some((v) => unread(v.l)) && (
        <button type="button" className="self-start text-[10px] text-[#1D4E89] underline inline-flex items-center gap-1" onClick={() => readCosts(views.filter((v) => unread(v.l)).map((v) => v.l.id))}>
          <Sparkles className="w-3 h-3 text-[#B8432F]" aria-hidden="true" /> Read with AI
        </button>
      )}

      {tab === 'prep' && (
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Item</th>
              <th className={`${th} text-left`}>Invoice date</th>
              <th className={`${th} text-left`}>Period covered</th>
              <th className={`${th} text-right w-[110px]`}>Invoice net</th>
              <th className={`${th} text-left`}>Method</th>
              <th className={`${th} text-right`}>Prepaid c/f</th>
              <th className={`${th} text-left`}>Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {views.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-[11px] text-[#7E8DA6]">
                  No prepayments yet. Search the ledger, or add a line for each cost that covers time after the year end.
                </td>
              </tr>
            )}
            {views.map((v) => {
              const l = v.l;
              const name = l.desc || 'New line';
              const off = l.found && l.decision === 'not';
              return (
                <React.Fragment key={l.id}>
                  <tr
                    className={off ? 'opacity-50' : l.found && !l.decision ? 'bg-[#FFFBEF]' : ''}
                    onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = Array.from(e.dataTransfer.files ?? []);
                      if (f.length && !locked && dropFiles) dropFiles(f, l.id);
                    }}
                  >
                    <td className="p-1.5 align-top min-w-[200px]">
                      {l.found ? (
                        // A cost from the ledger keeps the ledger's name, which opens it in Xero
                        <div className="px-0.5 py-1 font-semibold">
                          {l.url ? (
                            <a href={l.url} target="_blank" rel="noreferrer" className="text-[#1D4E89] underline">
                              {name}
                            </a>
                          ) : (
                            name
                          )}
                        </div>
                      ) : (
                        <TextInput label="Item" value={l.desc} disabled={locked} placeholder="e.g. Business insurance · annual policy" onCommit={(d) => setLine(l.id, { desc: d })} />
                      )}
                      {/* The picker shrinks and the note drops under it when the column is narrow, so the table fits beside the review panel */}
                      <div className="mt-1 flex flex-wrap items-center gap-1 [&>select]:w-full [&>select]:min-w-0">
                        <CodePicker label={`Cost account for ${name}`} value={l.code} codes={codes} disabled={locked} onChange={(c) => setLine(l.id, { code: c })} />
                        {l.found && <span className="text-[10px] text-[#4A5878]">found in the ledger{l.ref ? ` · ${l.ref}` : ''}</span>}
                      </div>
                    </td>
                    <td className="p-1.5 align-top">{date(l.invoice_date, `Invoice date of ${name}`, (d) => setLine(l.id, { invoice_date: d }))}</td>
                    <td className="p-1.5 align-top">
                      {l.method === 'all' ? (
                        <div className="text-[11px]">All after the year end</div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {date(l.start, `Period start for ${name}`, (d) => setLine(l.id, { start: d }))}–{date(l.end, `Period end for ${name}`, (d) => setLine(l.id, { end: d }))}
                        </div>
                      )}
                      <div className={`text-[10px] ${v.worked ? 'text-[#4A5878]' : 'text-[#B8432F]'}`}>{v.span}</div>
                    </td>
                    <td className="p-1.5 align-top">
                      <MoneyInput label={`Invoice net for ${name}`} value={l.net_p} disabled={locked} allowNegative={false} onCommit={(p) => setLine(l.id, { net_p: p })} />
                    </td>
                    <td className="p-1.5 align-top">
                      <select
                        aria-label={`How to work out the prepaid part of ${name}`}
                        value={l.method}
                        disabled={locked}
                        onChange={(e) => setLine(l.id, { method: e.target.value as PrepLine['method'] })}
                        className="px-1.5 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px]"
                      >
                        <option value="days">By days</option>
                        <option value="months">By months</option>
                        <option value="all">All prepaid</option>
                      </select>
                    </td>
                    <td className="p-2 align-top text-right font-mono font-bold">{money(v.prepaid)}</td>
                    <td className="p-2 align-top">
                      {/* A long file name is cut short here (full name on hover), or it widens the table past the page */}
                      <div className="flex items-center gap-2 flex-wrap [&_button]:max-w-[80px]">
                        {tickFor(l.id, name)}
                        <RowFiles files={filesFor(l.id)} onPreview={preview} onAttach={() => attachTo(l.id)} disabled={locked} label={`the invoice for ${name}`} />
                        {!locked && !l.found && (
                          <button type="button" aria-label={`Remove ${name}`} onClick={() => save({ prepayments: (live().prepayments ?? []).filter((x: PrepLine) => x.id !== l.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {l.found && (
                    <tr>
                      <td colSpan={7} className="px-3 pb-2">
                        {!l.decision ? (
                          <div className="px-3 py-2 rounded-[8px] bg-[#F5F8FD] text-[11px] text-[#122654] flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="flex-1 flex items-start gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 mt-px shrink-0 text-[#B8432F]" aria-hidden="true" />
                              <span>
                                {l.ai?.summary
                                  ? `${l.ai.summary}${l.ai.from && l.ai.to ? ` Reads as covering ${ukDate(l.ai.from)} to ${ukDate(l.ai.to)}.` : ''}`
                                  : aiReading
                                    ? 'Reading the description…'
                                    : `Posted ${ukDate(l.invoice_date ?? '')} and reads like it covers time after ${ukDate(pe)}. Check the invoice for the period it covers.`}
                              </span>
                            </div>
                            {!locked && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button type="button" className={btnPrimary} onClick={() => setLine(l.id, { decision: 'add' })}>
                                  Add as prepayment
                                </button>
                                <button type="button" className={btnSecondary} onClick={() => setLine(l.id, { decision: 'not' })}>
                                  Not a prepayment
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[#4A5878]">
                            {l.decision === 'add' ? 'Added as a prepayment.' : 'Not a prepayment, left in costs.'}{' '}
                            {!locked && (
                              <button type="button" className="text-[#1D4E89] underline" onClick={() => setLine(l.id, { decision: undefined })}>
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
            <tr className="font-bold bg-[#F5F8FD]">
              <td colSpan={5} className="p-2.5">
                Total prepayments
              </td>
              <td className="p-2.5 text-right font-mono">{money(tot('prepaid'))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {tab === 'accrued' && (
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Item</th>
              <th className={`${th} text-left`}>Date</th>
              <th className={`${th} text-left`}>Period covered</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-left`}>Source</th>
              <th className={`${th} text-right`}>Accrued</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {accrued.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-[11px] text-[#7E8DA6]">
                  None. Work done before the year end but invoiced after is accrued on the Revenue paper and shows here.
                </td>
              </tr>
            )}
            {accrued.map((i) => (
              <tr key={i.id}>
                <td className="p-2">
                  <div className="font-semibold">{[i.desc, i.contact].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="p-2">{ukDate(i.date)}</td>
                <td className="p-2 text-[11px]">Work done before {ukDate(pe)}</td>
                <td className="p-2 text-right font-mono">{formatPence(asPence(i.amount_p), { symbol: '' })}</td>
                <td className="p-2">
                  <Pill tone="info">From Revenue</Pill>
                </td>
                <td className="p-2 text-right font-mono font-bold">{money(asPence(i.amount_p))}</td>
                <td />
              </tr>
            ))}
            <tr className="font-bold bg-[#F5F8FD]">
              <td colSpan={5} className="p-2.5">
                Total accrued income
              </td>
              <td className="p-2.5 text-right font-mono">{money(tot('accrued'))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      )}
      </div>

      <JournalPanel
        engagementId={result.engagementId}
        date={pe}
        lines={lines}
        sent={data.journal}
        narrative="Prepayments at the year end"
        source="C-20"
        autoReverse
        locked={locked}
        save={save}
        title="Year-end journal"
        note="Accrued income is posted by the Revenue journal, so it is not repeated here. The reversal is made on the first day of next year, so next year starts clean."
      />
    </div>
  );
}

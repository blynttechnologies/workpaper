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
import { addDays, expenseCodes, inLead } from '@/lib/workpapers/common';
import { ACCRUED_WINDOW, accruedIncome, accruedLines, findAccruedSales, findPrepaidCosts, lastYear, nextYear, prepaymentsJournal, prepView, withinYear, type PrepLine } from '@/lib/workpapers/prepayments';
import { REVENUE_CODES } from '@/lib/workpapers/revenue';

type Tab = 'prep' | 'accrued';
const s = (n: number) => (n === 1 ? '' : 's');

// What differs between the two tabs. The table, the ledger search, the AI reading and the decisions are the same for both.
const KINDS = {
  prep: {
    key: 'prepayments',
    at: 'scanned_at',
    scan: 'scan',
    api: 'ai-prepaid-costs',
    find: findPrepaidCosts,
    hidden: withinYear,
    part: 'Prepaid c/f',
    noun: 'prepaid',
    all: 'All after the year end',
    account: 'Cost account',
    placeholder: 'e.g. Business insurance · annual policy',
    add: 'Add as prepayment',
    not: 'Not a prepayment',
    added: 'Added as a prepayment.',
    left: 'Not a prepayment, left in costs.',
    total: 'Total prepayments',
    empty: 'No prepayments yet. Search the ledger, or add a line for each cost that covers time after the year end.',
    hiddenNote: (n: number) => `${n} cost${s(n)} the AI read as wholly within the year left out.`,
    unread: (date: string, pe: string) => `Posted ${ukDate(date)} and reads like it covers time after ${ukDate(pe)}. Check the invoice for the period it covers.`,
    banner: 'read like costs that run past the year end. Enter the period from each invoice so the prepaid part is right.',
    scanned: (n: number, found: number) => `${n} cost${s(n)} in the year scanned; ${found} new one${s(found)} read like they run past the year end.`,
  },
  accrued: {
    key: 'accrued_income',
    at: 'accrued_scanned_at',
    scan: 'accrued_scan',
    api: 'ai-accrued-sales',
    find: findAccruedSales,
    hidden: nextYear,
    part: 'Accrued',
    noun: 'accrued',
    all: 'All before the year end',
    account: 'Income account',
    placeholder: 'e.g. March retainer · invoiced in April',
    add: 'Add as accrued income',
    not: 'Not accrued income',
    added: 'Added as accrued income.',
    left: "Not accrued income, left in next year's sales.",
    total: 'Total accrued income',
    empty: 'No accrued income yet. Search the ledger, or add a line for each sale invoiced after the year end for work done before it.',
    hiddenNote: (n: number) => `${n} sale${s(n)} the AI read as wholly after the year end left out.`,
    unread: (date: string, pe: string) => `Invoiced ${ukDate(date)}, after the year end of ${ukDate(pe)}. Check the invoice for when the work was done.`,
    banner: 'These sales were invoiced after the year end and may be for work done before it. Enter the period from each invoice so the accrued part is right.',
    scanned: (n: number, found: number) => `${n} sale${s(n)} invoiced in the ${ACCRUED_WINDOW} days after the year end; ${found} new one${s(found)} to check for work done before it.`,
  },
} as const;

export function PrepaymentsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  // Each tab keeps the note from its own search
  const [notes, setNotes] = useState<Partial<Record<Tab, string>>>({});
  const [tab, setTab] = useState<Tab>('prep');
  const k = KINDS[tab];
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
  // Costs the AI read as wholly within the year (or sales wholly after it) stay off the list unless asked for; they keep their line, so a new search does not bring them back
  const [showWithin, setShowWithin] = useState(false);
  // The Revenue paper's accrued sales show on the accrued tab as they are; this paper's own lines are worked like prepayments
  const accrued = accruedIncome(result.engagementId);
  const linesOf = (t: Tab) => (t === 'prep' ? ((data.prepayments ?? []) as PrepLine[]) : accruedLines(result.engagementId, data));
  const viewsOf = (t: Tab, all = false) => linesOf(t).filter((l) => all || !KINDS[t].hidden(l, pe)).map((l) => prepView(l, pe, t === 'accrued'));
  const within = linesOf(tab).filter((l) => k.hidden(l, pe)).length;
  const views = viewsOf(tab, showWithin);
  const other = viewsOf(tab === 'prep' ? 'accrued' : 'prep', showWithin);
  const [prepViews, accViews] = tab === 'prep' ? [views, other] : [other, views];
  const ly = lastYear(ctx);
  const lines = prepaymentsJournal(ctx, data);
  const tot = (key: string) => result.totals[key] ?? 0n;
  // Income accounts by the rule the search uses, so a practice's own account under one of them can be picked too
  const codes = tab === 'prep' ? expenseCodes() : db.blynt_accounts.filter((a) => REVENUE_CODES.some((c) => inLead(a.code, c))).map((a) => ({ code: a.code, name: a.name }));

  // Every change below is to the lines of the tab on screen
  const stored = () => (live()[k.key] ?? []) as PrepLine[];
  const setLine = (id: string, patch: Partial<PrepLine>) => save({ [k.key]: stored().map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  // The AI reads each cost or sale still to decide: the period it covers when the description says, and which year it belongs to. It never decides.
  // Kept for each tab, as a read on one can still be running when the other is opened
  const [reading, setReading] = useState<Partial<Record<Tab, boolean>>>({});
  const [aiNotes, setAiNotes] = useState<Partial<Record<Tab, string>>>({});
  const aiReading = !!reading[tab];
  const aiNote = aiNotes[tab];
  const setAiReading = (on: boolean) => setReading((r) => ({ ...r, [tab]: on }));
  const setAiNote = (text: string) => setAiNotes((n) => ({ ...n, [tab]: text }));
  const unread = (l: PrepLine) => !!l.found && !l.decision && !l.ai;
  const readCosts = async (ids: string[]) => {
    if (!ids.length) return;
    setAiReading(true);
    setAiNote('');
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(result.engagementId)}/${k.api}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The AI could not read these. Try again.');
      const read = new Map<string, NonNullable<PrepLine['ai']>>((body.items ?? []).map((x: { id: string; from: string; to: string; summary: string }) => [x.id, { from: x.from, to: x.to, summary: x.summary }]));
      save({ [k.key]: stored().map((l) => (read.has(l.id) ? { ...l, ai: read.get(l.id) } : l)) });
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
    const all = stored();
    const kept = all.filter((l) => !(l.found && asPence(l.net_p) < minimum && !l.end && l.method !== 'all' && !filesFor(l.id).length));
    const dropped = all.length - kept.length;
    const r = k.find(result.engagementId, pe, minimum, kept);
    const lines = [...kept.filter((l) => !r.dupes.has(l.id)).map((l) => ({ ...l, ...r.links.get(l.id) })), ...r.found];
    save({ [k.key]: lines, [k.at]: new Date().toISOString(), [k.scan]: { scanned: r.scanned, small: r.small, small_p: r.smallTotal.toString() } });
    void readCosts(lines.filter(unread).map((l) => l.id));
    setNotes({
      ...notes,
      [tab]: `${k.scanned(r.scanned, r.found.length)}${r.small ? ` ${r.small} under ${formatPence(minimum)} (${formatPence(r.smallTotal)}) left out.` : ''}${dropped ? ` ${dropped} taken off the list.` : ''} Enter the period covered from each invoice.`,
    });
  };
  // A line added by hand for accrued income starts as the month before the year end, so the whole sale is accrued until the period is changed
  const add = () => save({ [k.key]: [...stored(), { id: newId(tab === 'prep' ? 'prep' : 'acc'), desc: '', code: '', net_p: '0', start: addDays(pe, -30), ...(tab === 'prep' ? { method: 'months' } : { method: 'days', end: pe }) }] });
  const open = (l: PrepLine) => !!l.found && !l.decision && !k.hidden(l, pe);
  const pending = views.filter((v) => open(v.l));
  const prepPending = prepViews.filter((v) => v.l.found && !v.l.decision && !withinYear(v.l, pe));
  const counted = prepViews.filter((v) => v.counted && v.prepaid > 0n);
  const accCounted = accViews.filter((v) => v.counted && v.prepaid > 0n);
  const withInvoice = [...counted, ...accCounted];
  const date = (v: string | undefined, label: string, onChange: (d: string) => void) => (
    <input type="date" aria-label={label} value={v ?? ''} disabled={locked} onChange={(e) => onChange(e.target.value)} className="w-[110px] px-1.5 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px] disabled:bg-[#F5F8FD]" />
  );

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Prepayments', value: formatPence(tot('prepaid')), sub: `${counted.length} items · last year ${formatPence(ly.total)}` },
          { label: 'Accrued income', value: formatPence(tot('accrued')), sub: accCounted.length ? `${accCounted.length + accrued.length} items · ${accrued.length} from the Revenue paper` : 'from the Revenue paper' },
          { label: 'Costs scanned', value: data.scan ? String(data.scan.scanned) : '–', sub: data.scan ? `${prepPending.length} to decide · ${data.scan.small} under ${formatPence(minimum)} left out` : 'search the ledger below' },
          {
            label: "Last year's prepayments",
            value: ly.reversed || tot('tb_draft') === 0n ? 'Released' : 'Still in 7300',
            tone: ly.reversed || tot('tb_draft') === 0n ? 'good' : 'warn',
            sub: ly.reversed ? `${formatPence(ly.total)} reversed on ${ukDate(eng?.period_start ?? '')}` : `${formatPence(tot('tb_draft'))} in the TB before adjustments`,
          },
          { label: 'Evidence', value: `${withInvoice.filter((v) => filesFor(v.l.id).length).length} of ${withInvoice.length}`, sub: 'invoice on every line' },
        ]}
      />
      {/* The suggestions of the tab on screen, so the AI's help is there on both */}
      <SuggestBanner
        count={pending.length}
        locked={locked}
        onAccept={() => save({ [k.key]: stored().map((l) => (open(l) ? { ...l, decision: 'add' } : l)) })}
        decided={views.filter((v) => v.l.found && v.l.decision).length}
        onUndo={() => save({ [k.key]: stored().map((l) => (l.found && l.decision ? { ...l, decision: undefined } : l)) })}
        // Every sale after the year end is listed for accrued income, too many to name here
        text={tab === 'prep' ? `${pending.map((v) => v.l.desc).join(' · ')} ${k.banner}` : k.banner}
      />

      <div className="flex flex-col gap-2 p-3 bg-white border border-[#E3E7EF] rounded-[12px]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E3E7EF]">
        <div role="tablist" aria-label="Schedule" className="flex gap-1">
          {(
            [
              ['prep', `Prepayments (${prepViews.length})`],
              ['accrued', `Accrued income (${accViews.length + accrued.length})`],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs border-b-2 -mb-px whitespace-nowrap ${tab === t ? 'font-bold border-[#FF7A66] text-[#122654]' : 'font-semibold border-transparent text-[#4A5878] hover:text-[#122654]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {!locked && (
          <div className="ml-auto mb-1.5 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px]">
              Ignore items under £
              <span className="w-24">
                <MoneyInput label="Ignore items under" value={minimum.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ min_p: p })} />
              </span>
            </label>
            <button type="button" onClick={scan} className={btnAdd}>
              <Search className="w-3.5 h-3.5" /> {data[k.at] ? 'Search the ledger again' : 'Search the ledger'}
            </button>
            <button type="button" onClick={add} className={btnAdd}>
              <Plus className="w-3.5 h-3.5" /> Add line
            </button>
          </div>
        )}
      </div>
      {notes[tab] && <Notice tone="ok" inline>{notes[tab]}</Notice>}
      {aiNote && <Notice inline>{aiNote}</Notice>}
      {within > 0 && (
        <div className="text-[10px] text-[#4A5878]">
          {k.hiddenNote(within)}{' '}
          <button type="button" className="text-[#1D4E89] underline" onClick={() => setShowWithin(!showWithin)}>
            {showWithin ? 'Hide' : 'Show'}
          </button>
        </div>
      )}
      {!locked && !aiReading && views.some((v) => unread(v.l)) && (
        <button type="button" className="self-start text-[10px] text-[#1D4E89] underline inline-flex items-center gap-1" onClick={() => readCosts(views.filter((v) => unread(v.l)).map((v) => v.l.id))}>
          <Sparkles className="w-3 h-3 text-[#B8432F]" aria-hidden="true" /> Read with AI
        </button>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Item</th>
              <th className={`${th} text-left`}>Invoice date</th>
              <th className={`${th} text-left`}>Period covered</th>
              <th className={`${th} text-right w-[110px]`}>Invoice net</th>
              <th className={`${th} text-left`}>Method</th>
              <th className={`${th} text-right`}>{k.part}</th>
              <th className={`${th} text-left`}>Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {views.length === 0 && !(tab === 'accrued' && accrued.length) && (
              <tr>
                <td colSpan={7} className="p-3 text-[11px] text-[#7E8DA6]">
                  {k.empty}
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
                        <TextInput label="Item" value={l.desc} disabled={locked} placeholder={k.placeholder} onCommit={(d) => setLine(l.id, { desc: d })} />
                      )}
                      {/* The picker shrinks and the note drops under it when the column is narrow, so the table fits beside the review panel */}
                      <div className="mt-1 flex flex-wrap items-center gap-1 [&>select]:w-full [&>select]:min-w-0">
                        <CodePicker label={`${k.account} for ${name}`} value={l.code} codes={codes} disabled={locked} onChange={(c) => setLine(l.id, { code: c })} />
                        {l.found && <span className="text-[10px] text-[#4A5878]">found in the ledger{l.ref ? ` · ${l.ref}` : ''}</span>}
                      </div>
                    </td>
                    <td className="p-1.5 align-top">{date(l.invoice_date, `Invoice date of ${name}`, (d) => setLine(l.id, { invoice_date: d }))}</td>
                    <td className="p-1.5 align-top">
                      {l.method === 'all' ? (
                        <div className="text-[11px]">{k.all}</div>
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
                        aria-label={`How to work out the ${k.noun} part of ${name}`}
                        value={l.method}
                        disabled={locked}
                        onChange={(e) => setLine(l.id, { method: e.target.value as PrepLine['method'] })}
                        className="px-1.5 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px]"
                      >
                        <option value="days">By days</option>
                        <option value="months">By months</option>
                        <option value="all">All {k.noun}</option>
                      </select>
                    </td>
                    <td className="p-2 align-top text-right font-mono font-bold">{money(v.prepaid)}</td>
                    <td className="p-2 align-top">
                      {/* A long file name is cut short here (full name on hover), or it widens the table past the page */}
                      <div className="flex items-center gap-2 flex-wrap [&_button]:max-w-[80px]">
                        {tickFor(l.id, name)}
                        <RowFiles files={filesFor(l.id)} onPreview={preview} onAttach={() => attachTo(l.id)} disabled={locked} label={`the invoice for ${name}`} />
                        {!locked && !l.found && (
                          <button type="button" aria-label={`Remove ${name}`} onClick={() => save({ [k.key]: stored().filter((x) => x.id !== l.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
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
                                    : k.unread(l.invoice_date ?? '', pe)}
                              </span>
                            </div>
                            {!locked && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button type="button" className={btnPrimary} onClick={() => setLine(l.id, { decision: 'add' })}>
                                  {k.add}
                                </button>
                                <button type="button" className={btnSecondary} onClick={() => setLine(l.id, { decision: 'not' })}>
                                  {k.not}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[#4A5878]">
                            {l.decision === 'add' ? k.added : k.left}{' '}
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
            {/* Sales the Revenue paper accrued: decided and posted there, so they are shown as they are */}
            {tab === 'accrued' &&
              accrued.map((i) => (
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
                {k.total}
              </td>
              <td className="p-2.5 text-right font-mono">{money(tot(tab === 'prep' ? 'prepaid' : 'accrued'))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
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
        note="Accrued income from the Revenue paper is posted by the Revenue journal, so it is not repeated here. The reversal is made on the first day of next year, so next year starts clean."
      />
    </div>
  );
}

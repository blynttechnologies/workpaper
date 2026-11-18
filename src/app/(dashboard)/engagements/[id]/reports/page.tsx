'use client';

import { Notice } from '@/components/ui/Notice';
import { ask } from '@/components/ui/ask';
import React, { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { asPence, formatPence, toPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { periodLabel } from '@/lib/periods';
import { downloadText } from '@/lib/download';
import { buildAccounts } from '@/lib/workpapers/accounts';
import { checklistFor, notesFor } from '@/lib/completion';
import {
  REPORTS, buildReport, toCsv, type ReportKey, newBudget, setBudgetCell, setActiveBudget, budgetCsv, importBudgetCsv, budgetVsActual,
  cashFlow, cashForecast, saveForecast, DEFAULT_FORECAST, quarterlyPack, setQuarterly, fileIndex,
} from '@/lib/management';
import { btnPrimary, btnSecondary, card, th, Tiles } from '@/components/workpaper/kit';
import type { ForecastAssumptions } from '@/lib/types/models';

/** Stage E on one engagement: report library (RPT-01), management pack (MGT-01), budgets (MGT-03), cash flow (MGT-04), forecast (MGT-05), quarterly insight (QTR-01) and the full file (RPT-02). */

const money = (p: bigint) => formatPence(p, { accountingFormat: true });
const TABS = [['library', 'Report library'], ['pack', 'Management accounts'], ['budgets', 'Budgets'], ['cashflow', 'Cash flow'], ['forecast', 'Cash forecast'], ['quarterly', 'Quarterly insight'], ['file', 'Full file']] as const;
type Tab = (typeof TABS)[number][0];
// Plain-English labels for the client version of the pack (MGT-01)
const PLAIN: Record<string, string> = { Turnover: 'Sales', 'Cost of sales': 'Cost of making those sales', 'Trade debtors': 'Money owed to you', 'Creditors: trade': 'Money you owe suppliers', 'Cash at bank and in hand': 'Money in the bank', 'Taxation and social security': 'Tax you owe' };
const PACK_SECTIONS = ['Summary', 'Profit and loss', 'Balance sheet', 'Cash flow'] as const;

export default function ReportsPage() {
  const engagementId = (useParams()?.id as string) || '';
  const [tab, setTab] = useState<Tab>('library');
  const [report, setReport] = useState<ReportKey>('tb_adjusted');
  const [plain, setPlain] = useState(true);
  const [off, setOff] = useState<string[]>([]);
  const [clientView, setClientView] = useState(true);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const eng = db.engagements.find((e) => e.id === engagementId);
  const client = db.clients.find((c) => c.id === eng?.client_id);
  if (!eng || !client) return <div className={card}>Engagement not found.</div>;
  const firm = db.firms.find((f) => f.id === eng.firm_id);
  const brand = firm?.settings?.branding;
  const actor = getActor();
  const locked = eng.status === 'locked';
  const snapshot = db.tb_snapshots.filter((s) => s.engagement_id === engagementId).map((s) => (s as { imported_at?: string; created_at?: string }).imported_at ?? (s as { created_at?: string }).created_at ?? '').sort().pop();
  const done = (msg: string | null = null) => { setNotice(msg); redraw((n) => n + 1); };
  const logDownload = (what: string) => db.logAudit(eng.firm_id, actor, 'DOWNLOAD_REPORT', 'engagements', eng.id, null, { report: what, period_end: eng.period_end, snapshot: snapshot ?? null });
  const print = (what: string) => { logDownload(what); window.print(); };

  const a = buildAccounts(engagementId);
  const label = (l: string) => (plain ? PLAIN[l] ?? l : l);

  /** Every printed report carries the client, period, data date and the practice branding. */
  const Sheet = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="print-area bg-white border border-[#E3E7EF] rounded-xl p-5 text-xs text-[#122654] overflow-x-auto">
      <div className="flex items-start justify-between gap-4 border-b border-[#E3E7EF] pb-3 mb-3" style={brand?.colour ? { borderColor: brand.colour } : undefined}>
        <div>
          <h2 className="text-base font-bold">{title}{locked ? ' · Final' : ''}</h2>
          <p className="text-[#4A5878]">{client.name} · {periodLabel(eng)}{snapshot ? ` · ledger data from ${ukDate(snapshot)}` : ''}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand?.logo_file_key ? <img src={`/api/v1/files/${brand.logo_file_key}`} alt={firm?.name ?? 'Practice logo'} className="h-9" /> : <span className="font-bold">{firm?.name}</span>}
      </div>
      {children}
      {(brand?.footer || brand?.disclaimer) && <p className="mt-4 pt-2 border-t border-[#E3E7EF] text-[10px] text-[#4A5878]">{[brand.footer, brand.disclaimer].filter(Boolean).join(' · ')}</p>}
    </div>
  );
  const Lines = ({ rows }: { rows: [string, bigint, boolean?][] }) => (
    <table className="w-full max-w-xl">
      <tbody>{rows.map(([l, v, bold]) => <tr key={l} className={bold ? 'font-bold border-t border-[#E3E7EF]' : ''}><td className="py-1">{l}</td><td className="py-1 text-right font-mono">{money(v)}</td></tr>)}</tbody>
    </table>
  );

  const r = tab === 'library' ? buildReport(engagementId, report) : null;
  const budgets = eng.budgets ?? [];
  const budget = budgets.find((b) => b.id === budgetId) ?? budgets.find((b) => b.active) ?? budgets[0];
  const cf = cashFlow(engagementId);
  const assumptions = eng.forecast ?? DEFAULT_FORECAST;
  const forecast = cashForecast(engagementId);
  const q = quarterlyPack(engagementId);
  const bva = budgetVsActual(engagementId);
  const setAssumption = (k: keyof ForecastAssumptions, v: string) => {
    const days = k === 'debtor_days' || k === 'creditor_days';
    saveForecast(engagementId, { ...assumptions, [k]: days ? Math.max(0, Number(v) || 0) : toPence(v).toString() }, actor);
    done();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white border border-[#E3E7EF] rounded-xl p-5 no-print">
        <h1 className="text-xl font-bold text-[#122654]">Reports</h1>
        <p className="text-xs text-[#4A5878] mt-1">Every report reads the same figures for {periodLabel(eng)}. Download PDF opens the print dialog: choose Save as PDF.</p>
      </div>
      <div className="flex gap-2 border-b border-[#E3E7EF] overflow-x-auto no-print" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setNotice(null); }} className={`px-3 py-2 text-xs font-bold border-b-2 whitespace-nowrap ${tab === k ? 'border-[#FF7A66] text-[#122654]' : 'border-transparent text-[#4A5878]'}`}>{l}</button>)}
      </div>
      {notice && <Notice tone="info" className="no-print">{notice}</Notice>}

      {r && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs no-print">
            <select aria-label="Report" value={report} onChange={(e) => setReport(e.target.value as ReportKey)} className="px-3 py-1.5 border border-[#D3DCEE] rounded-lg bg-white text-[#122654]">
              {REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button type="button" className={btnPrimary} onClick={() => print(r.title)}>Download PDF</button>
            <button type="button" className={btnSecondary} onClick={() => { logDownload(`${r.title} (Excel)`); downloadText(`${client.name} ${r.title}.csv`, toCsv(r.columns, r.rows)); }}>Download for Excel</button>
          </div>
          <Sheet title={r.title}>
            {r.rows.length === 0 ? <p className="text-[#4A5878]">Nothing to show for this period.</p> : (
              <table className="w-full">
                <thead><tr className="text-left">{r.columns.map((c) => <th key={c} className={th}>{c}</th>)}</tr></thead>
                <tbody>{r.rows.map((row, i) => <tr key={i} className="border-t border-[#E3E7EF]">{row.map((c, j) => <td key={j} className={`p-2 ${typeof c === 'bigint' ? 'text-right font-mono' : ''}`}>{typeof c === 'bigint' ? money(c) : c}</td>)}</tr>)}</tbody>
              </table>
            )}
          </Sheet>
        </>
      )}

      {tab === 'pack' && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs no-print">
            {PACK_SECTIONS.map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={!off.includes(s)} onChange={() => setOff(off.includes(s) ? off.filter((x) => x !== s) : [...off, s])} />{s}</label>)}
            <label className="flex items-center gap-1"><input type="checkbox" checked={plain} onChange={() => setPlain(!plain)} />Plain-English labels</label>
            <button type="button" className={btnPrimary} onClick={() => print('Management accounts')}>Download PDF</button>
          </div>
          <Sheet title="Management accounts">
            <div className="space-y-5">
              {!off.includes('Summary') && (
                <section>
                  <Tiles items={q.kpis.map((k) => ({ label: k.label, value: k.value === null ? '–' : money(k.value) }))} />
                  {/* Only commentary a person has marked client-facing reaches the pack (ANL-03) */}
                  {Object.entries(eng.commentary ?? {}).filter(([, c]) => c.visibility === 'client' && c.text.trim()).map(([k, c]) => <p key={k} className="mt-2"><strong>{label(k)}:</strong> {c.text}</p>)}
                </section>
              )}
              {!off.includes('Profit and loss') && (
                <section><h3 className="font-bold mb-1">Profit and loss</h3>
                  <table className="w-full max-w-2xl">
                    <thead><tr className="text-left"><th className={th} /><th className={`${th} text-right`}>This period</th>{a.hasPrior && <th className={`${th} text-right`}>Last year</th>}{bva && <th className={`${th} text-right`}>Budget</th>}{bva && <th className={`${th} text-right`}>Variance</th>}</tr></thead>
                    <tbody>
                      {a.pl.map((l) => { const b = bva?.rows.find((x) => x.label === l.label); return <tr key={l.label}><td className="py-1">{label(l.label)}</td><td className="py-1 text-right font-mono">{money(l.amount)}</td>{a.hasPrior && <td className="py-1 text-right font-mono">{money(l.prior ?? 0n)}</td>}{bva && <td className="py-1 text-right font-mono">{money(b?.budget ?? 0n)}</td>}{bva && <td className="py-1 text-right font-mono">{money(b?.variance ?? 0n)}</td>}</tr>; })}
                      <tr className="font-bold border-t border-[#E3E7EF]"><td className="py-1">{plain ? 'Profit' : 'Profit/(loss) for the period'}</td><td className="py-1 text-right font-mono">{money(a.profit.amount)}</td>{a.hasPrior && <td className="py-1 text-right font-mono">{money(a.profit.prior ?? 0n)}</td>}{bva && <td colSpan={2} />}</tr>
                    </tbody>
                  </table>
                </section>
              )}
              {!off.includes('Balance sheet') && (
                <section><h3 className="font-bold mb-1">Balance sheet</h3>
                  <Lines rows={[...[...a.bs.fixed, ...a.bs.current].map((l): [string, bigint] => [label(l.label), l.amount]), ...[...a.bs.creditorsShort, ...a.bs.creditorsLong, ...a.bs.provisions].map((l): [string, bigint] => [label(l.label), -l.amount]), [plain ? 'What the business is worth on paper' : 'Net assets', a.netAssets.amount, true]]} />
                </section>
              )}
              {!off.includes('Cash flow') && cf && <section><h3 className="font-bold mb-1">Cash flow</h3><Lines rows={[...cf.lines.map((l): [string, bigint] => [plain ? l.plain : l.label, l.amount]), [plain ? 'Change in your cash' : 'Net change in cash', cf.change, true]]} /></section>}
            </div>
          </Sheet>
        </>
      )}

      {tab === 'budgets' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs no-print">
            {budgets.length > 0 && <select aria-label="Budget version" value={budget?.id} onChange={(e) => setBudgetId(e.target.value)} className="px-3 py-1.5 border border-[#D3DCEE] rounded-lg bg-white">{budgets.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? ' (active)' : ''}</option>)}</select>}
            {(['prior', 'blank'] as const).map((m) => (
              <button key={m} type="button" disabled={locked} className={btnSecondary} onClick={async () => { const name = await ask.text({ title: 'Name this budget version', label: 'Name', initial: budgets.length ? 'Reforecast' : 'Original', action: 'Create' }); const b = name && newBudget(engagementId, name, m, actor); if (b) setBudgetId(b.id); done(); }}>{m === 'prior' ? `New from ${a.hasPrior ? 'last year' : 'this year’s figures'}` : 'New blank'}</button>
            ))}
            {budget && !budget.active && <button type="button" disabled={locked} className={btnPrimary} onClick={() => { setActiveBudget(engagementId, budget.id, actor); done(); }}>Set as active</button>}
            {budget && <button type="button" className={btnSecondary} onClick={() => downloadText(`${client.name} budget ${budget.name}.csv`, budgetCsv(budget))}>Export for Excel</button>}
            {budget && <button type="button" disabled={locked} className={btnSecondary} onClick={() => fileInput.current?.click()}>Import</button>}
            <input ref={fileInput} type="file" accept=".csv" className="hidden" aria-label="Import budget file" onChange={async (e) => { const f = e.target.files?.[0]; if (f && budget) done(`${importBudgetCsv(engagementId, budget.id, (await f.text()).replace(/^﻿/, ''), actor)} budget lines read from ${f.name}.`); e.target.value = ''; }} />
          </div>
          {!budget ? <p className={card}>No budget yet. Start one from last year’s figures or blank.</p> : (
            <div className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
              <table className="text-xs">
                <thead><tr><th className={`${th} text-left sticky left-0 bg-white`}>Line (£)</th>{Array.from({ length: 12 }, (_, i) => <th key={i} className={`${th} text-right`}>M{i + 1}</th>)}<th className={`${th} text-right`}>Year</th></tr></thead>
                <tbody>
                  {Object.entries(budget.lines).map(([line, months]) => (
                    <tr key={line} className="border-t border-[#E3E7EF]">
                      <td className="p-2 whitespace-nowrap sticky left-0 bg-white">{line}</td>
                      {months.map((m, i) => (
                        <td key={`${i}:${m}`} className="p-1"><input aria-label={`${line}, month ${i + 1}`} disabled={locked} defaultValue={(Number(asPence(m)) / 100).toFixed(0)} onBlur={(e) => { const p = toPence(e.target.value); if (p !== asPence(m)) { setBudgetCell(engagementId, budget.id, line, i, p, actor); done(); } }} className="w-20 px-1 py-1 text-right font-mono border border-[#E3E7EF] rounded" /></td>
                      ))}
                      <td className="p-2 text-right font-mono font-bold">{money(months.reduce((t, m) => t + asPence(m), 0n))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'cashflow' && (!cf ? <p className={card}>A cash flow statement needs last year’s balance sheet. Roll forward from last year or import the prior year.</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs no-print">
            <button type="button" className={btnSecondary} aria-pressed={clientView} onClick={() => setClientView(true)}>Client view</button>
            <button type="button" className={btnSecondary} aria-pressed={!clientView} onClick={() => setClientView(false)}>Statutory view</button>
            <button type="button" className={btnPrimary} disabled={cf.difference !== 0n} onClick={() => print('Cash flow statement')}>Download PDF</button>
          </div>
          {cf.difference !== 0n && <Notice>Closing cash is {money(cf.difference)} away from the balance sheet, so this cannot be downloaded. This happens when this year’s or last year’s balance sheet does not balance: finish the mapping for both years.</Notice>}
          <Sheet title="Cash flow statement">
            {(['Operating', 'Investing', 'Financing'] as const).map((g) => (
              <section key={g} className="mb-3">
                {!clientView && <h3 className="font-bold mb-1">{g} activities</h3>}
                <Lines rows={cf.lines.filter((l) => l.group === g).map((l): [string, bigint] => [clientView ? l.plain : l.label, l.amount])} />
              </section>
            ))}
            <Lines rows={[[clientView ? 'Change in your cash' : 'Net increase/(decrease) in cash', cf.change, true], ['Cash at the start', cf.opening], ['Cash at the end (balance sheet)', cf.closing, true]]} />
          </Sheet>
        </>
      ))}

      {tab === 'forecast' && (!forecast ? <p className={card}>The forecast is built from the active budget. Create a budget first.</p> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs no-print">
            {([['debtor_days', 'Debtor days'], ['creditor_days', 'Creditor days'], ['minimum_cash_p', 'Minimum cash (£)'], ['capex_p', 'Planned spend on assets a month (£)'], ['dividends_p', 'Dividends a month (£)']] as const).map(([k, l]) => (
              <label key={k} className="flex flex-col gap-1 text-[#4A5878]">{l}
                <input disabled={locked} key={String(assumptions[k])} defaultValue={k.endsWith('_p') ? (Number(asPence(assumptions[k] as string)) / 100).toFixed(0) : assumptions[k]} onBlur={(e) => setAssumption(k, e.target.value)} className="px-2 py-1.5 border border-[#D3DCEE] rounded-lg text-[#122654]" />
              </label>
            ))}
          </div>
          <button type="button" className={`${btnPrimary} self-start no-print`} onClick={() => print('Cash flow forecast')}>Download PDF</button>
          <Sheet title="12-month cash flow forecast">
            <table className="w-full">
              <thead><tr><th className={`${th} text-left`}>Month</th>{['Opening cash', 'Receipts', 'Payments', 'Closing cash'].map((h) => <th key={h} className={`${th} text-right`}>{h}</th>)}</tr></thead>
              <tbody>{forecast.map((m) => <tr key={m.month} className={`border-t border-[#E3E7EF] ${m.below ? 'bg-[#FDECEA] text-[#B42318] font-bold' : ''}`}><td className="p-2">Month {m.month}{m.below ? ' · below minimum' : ''}</td>{[m.opening, m.receipts, m.payments, m.closing].map((v, i) => <td key={i} className="p-2 text-right font-mono">{money(v)}</td>)}</tr>)}</tbody>
            </table>
            <p className="mt-2 text-[#4A5878]">Built from the active budget; receipts arrive after {assumptions.debtor_days} days and bills are paid after {assumptions.creditor_days} days.</p>
          </Sheet>
        </>
      ))}

      {tab === 'quarterly' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs no-print">
            <span className="px-2 py-1 rounded bg-[#F5F8FD] font-bold text-[#122654]">{q.state.status === 'approved' ? `Approved by ${q.state.approved_by}` : q.state.status === 'ready' ? 'Ready for approval' : 'Needs comment'}</span>
            {q.state.status === 'draft' && <button type="button" disabled={locked} className={btnPrimary} onClick={() => done(setQuarterly(engagementId, actor, { status: 'ready' }))}>Mark ready</button>}
            {q.state.status === 'ready' && <button type="button" disabled={locked} className={btnPrimary} onClick={() => done(setQuarterly(engagementId, actor, { status: 'approved' }))}>Approve</button>}
            <button type="button" className={btnSecondary} disabled={q.state.status !== 'approved'} title={q.state.status === 'approved' ? '' : 'A pack is approved before it leaves the practice'} onClick={() => print('Quarterly insight pack')}>Download PDF</button>
          </div>
          <Sheet title="Quarterly insight">
            {q.unadjusted && <p className="mb-2 font-bold text-[#6B4700]">Based on unadjusted figures: the schedules for this period are not all reviewed.</p>}
            <Tiles items={q.kpis.map((k) => ({ label: k.label, value: k.value === null ? '–' : money(k.value) }))} />
            <h3 className="font-bold mt-4 mb-1">What changed</h3>
            {q.insights.length === 0 && <p className="text-[#4A5878]">No movements large enough to report.</p>}
            <ul className="space-y-1">{q.insights.map((t) => <li key={t} className="flex justify-between gap-3"><span>{t}</span>{q.state.status === 'draft' && !locked && <button type="button" className="no-print underline text-[#4A5878]" onClick={() => done(setQuarterly(engagementId, actor, { remove: t }))}>Remove</button>}</li>)}</ul>
            {q.leftOut > 0 && <p className="mt-1 text-[#4A5878] no-print">{q.leftOut} movement(s) left out because the ledger does not explain them.</p>}
            <h3 className="font-bold mt-4 mb-1">Coming up</h3>
            {q.deadlines.map((d) => <p key={d.label}>{d.label}: {ukDate(d.date)}</p>)}
            <h3 className="font-bold mt-4 mb-1">From your accountant</h3>
            <textarea aria-label="Accountant’s comment" disabled={locked || q.state.status === 'approved'} key={q.state.comment} defaultValue={q.state.comment} rows={3} onBlur={(e) => e.target.value !== q.state.comment && done(setQuarterly(engagementId, actor, { comment: e.target.value }))} className="w-full p-2 border border-[#D3DCEE] rounded-lg" />
          </Sheet>
        </>
      )}

      {tab === 'file' && (
        <>
          <button type="button" className={`${btnPrimary} self-start no-print`} onClick={() => print('Full working paper file')}>Download PDF</button>
          <Sheet title="Working paper file">
            <h3 className="font-bold mb-1">Index</h3>
            <ol className="mb-4 columns-2">{fileIndex(engagementId).map((w) => <li key={w.id}><a href={`#file-${w.id}`} className="underline">{w.ref} {w.title}</a> · {w.status}</li>)}</ol>
            {fileIndex(engagementId).map((w) => (
              <section key={w.id} id={`file-${w.id}`} className="py-3 border-t border-[#E3E7EF] break-inside-avoid">
                <h3 className="font-bold">{w.ref} {w.title} · {w.status}</h3>
                {w.leads.length > 0 && <Lines rows={w.leads.map((l): [string, bigint] => [`${l.code} ${l.label}`, l.final])} />}
                {w.conclusion && <p className="mt-1"><strong>Conclusion:</strong> {w.conclusion}</p>}
                <p className="mt-1 text-[#4A5878]">Sign-offs: {w.signoffs.map((s) => `${s.role} ${s.user_name} ${ukDate(s.signed_at)}`).join('; ') || 'none'}</p>
                {w.comments.map((c) => <p key={c.id} className="text-[#4A5878]">{c.type === 'review_note' ? 'Review point' : 'Comment'} ({c.status}) {c.created_by_name}: {c.body}</p>)}
                {w.evidence.length > 0 && <p className="text-[#4A5878]">Evidence: {w.evidence.map((x) => x.filename).join(', ')}</p>}
              </section>
            ))}
            <section className="py-3 border-t border-[#E3E7EF]"><h3 className="font-bold mb-1">Journals</h3>
              {db.adjustments.filter((j) => j.engagement_id === engagementId).map((j) => <p key={j.id}>{j.ref} · {j.status} · {j.narrative} · {money(j.lines.reduce((t, l) => t + asPence(l.debit_p), 0n))}</p>)}
            </section>
            <section className="py-3 border-t border-[#E3E7EF]"><h3 className="font-bold mb-1">Disclosure checklist</h3>
              {checklistFor(engagementId).map((c) => <p key={c.id}>{c.question}: <strong>{c.confirmed_answer ?? 'not confirmed'}</strong>{c.confirmed_by ? ` (${c.confirmed_by})` : ''}</p>)}
            </section>
            <section className="py-3 border-t border-[#E3E7EF]"><h3 className="font-bold mb-1">Notes to the accounts</h3>
              {notesFor(engagementId).map((n) => <p key={n.id}>{n.note_number}. {n.title}: {n.narrative_html}</p>)}
            </section>
          </Sheet>
        </>
      )}
    </div>
  );
}

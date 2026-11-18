'use client';

import { Notice } from '@/components/ui/Notice';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { bsAnalysis, clientQueries, plAnalysis, postBalanceSheetEvents, setCommentary, type MovementRow } from '@/lib/analysis';
import { budgetVsActual } from '@/lib/management';
import { btnSecondary, card, th, Tiles } from '@/components/workpaper/kit';

/** Step 13: analysis against last year (ANL-01, ANL-02), commentary (ANL-03), client queries (AIX-03) and events after the year end (AIX-07). */

const signed = (p: bigint) => formatPence(p, { accountingFormat: true });
type Tab = 'pl' | 'bs' | 'queries' | 'events';

export default function AnalysisPage() {
  const engagementId = (useParams()?.id as string) || '';
  const [tab, setTab] = useState<Tab>('pl');
  const [compare, setCompare] = useState<'prior' | 'budget'>('prior');
  const [, redraw] = useState(0);
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) return <div className={card}>Engagement not found.</div>;

  const locked = eng.status === 'locked';
  const pl = plAnalysis(engagementId);
  const bs = bsAnalysis(engagementId);
  const queries = clientQueries(engagementId);
  const events = postBalanceSheetEvents(engagementId);
  const budget = budgetVsActual(engagementId);
  const save = (key: string, change: Parameters<typeof setCommentary>[3]) => {
    setCommentary(engagementId, key, getActor(), change);
    redraw((n) => n + 1);
  };

  const Movements = ({ rows }: { rows: MovementRow[] }) => (
    <div className="bg-white border border-[#E3E7EF] rounded-xl divide-y divide-[#E3E7EF]">
      {rows.length === 0 && <p className="p-4 text-xs text-[#4A5878]">No figures yet. Import the trial balance and confirm the mapping.</p>}
      {rows.map((r) => {
        const c = eng.commentary?.[r.key];
        return (
          <div key={r.key} className="p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-[#122654]">{r.label}</span>
              <span className="font-mono text-[#122654]">
                {signed(r.amount)}
                {r.prior !== null && <span className="text-[#4A5878]"> · last year {signed(r.prior)}</span>}
                {r.movement !== null && r.movement !== 0n && (
                  <span className={r.flagged ? 'font-bold text-[#B8432F]' : 'text-[#4A5878]'}> · {r.movement > 0n ? '+' : '−'}{formatPence(r.movement < 0n ? -r.movement : r.movement)}{r.percent !== null ? ` (${r.percent.toFixed(1)}%)` : ''}</span>
                )}
              </span>
            </div>
            {r.flagged && (
              <p className={`mt-2 p-2 rounded-lg ${r.explanation ? 'bg-[#F5F8FD] text-[#122654]' : 'bg-[#FFF4DB] text-[#6B4700]'}`}>
                {r.explanation ? <><strong>Drafted explanation:</strong> {r.explanation}</> : <><strong>Needs explanation.</strong> The ledger does not show why this moved; it is on the client query list until you comment.</>}
                {r.explanation && !c?.text && !locked && (
                  <button type="button" className="ml-2 underline font-bold" onClick={() => save(r.key, { text: r.explanation!, ai_text: r.explanation! })}>Use as my comment</button>
                )}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                aria-label={`Your comment on ${r.label}`}
                key={c?.text ?? ''}
                defaultValue={c?.text ?? ''}
                disabled={locked}
                placeholder="Your comment"
                onBlur={(e) => e.target.value !== (c?.text ?? '') && save(r.key, { text: e.target.value })}
                className="flex-1 min-w-48 px-3 py-1.5 bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg text-[#122654]"
              />
              {c?.ai_text && c.text !== c.ai_text && <span className="text-[10px] font-bold uppercase text-[#4A5878]">Edited</span>}
              <select
                aria-label={`Who sees the comment on ${r.label}`}
                value={c?.visibility ?? 'internal'}
                disabled={locked || !c?.text.trim()}
                onChange={(e) => save(r.key, { visibility: e.target.value as 'internal' | 'client' })}
                className="px-2 py-1.5 border border-[#D3DCEE] rounded-lg bg-white text-[#122654]"
              >
                <option value="internal">Internal</option>
                <option value="client">Client-facing</option>
              </select>
              {(c?.history.length ?? 0) > 1 && (
                <details className="basis-full text-[#4A5878]">
                  <summary className="cursor-pointer">History ({c!.history.length})</summary>
                  {c!.ai_text && <p className="mt-1">Drafted: {c!.ai_text}</p>}
                  {c!.history.map((h) => <p key={h.at} className="mt-1">{ukDate(h.at)} {h.by}: {h.text}</p>)}
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const tabs: [Tab, string, number?][] = [['pl', 'Profit and loss'], ['bs', 'Balance sheet'], ['queries', 'Client queries', queries.length], ['events', 'After the year end', events.length]];
  const ratioText = (v: number | null, unit = '%') => (v === null ? '–' : `${unit === 'x' ? v.toFixed(2) : unit === '%' ? v.toFixed(1) : v}${unit}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-white border border-[#E3E7EF] rounded-xl p-5">
        <h1 className="text-xl font-bold text-[#122654]">Analysis</h1>
        <p className="text-xs text-[#4A5878] mt-1">
          This year against last year, from the confirmed trial balance and journals. A line is flagged when it moves by more than 10% and more than the practice review threshold.
        </p>
      </div>

      <div className="flex gap-2 border-b border-[#E3E7EF] overflow-x-auto" role="tablist">
        {tabs.map(([k, label, count]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-2 text-xs font-bold border-b-2 whitespace-nowrap ${tab === k ? 'border-[#FF7A66] text-[#122654]' : 'border-transparent text-[#4A5878]'}`}>
            {label}{count ? ` (${count})` : ''}
          </button>
        ))}
      </div>

      {(tab === 'pl' || tab === 'bs') && !pl.hasPrior && (
        <Notice tone="warn">There are no figures for last year, so movements cannot be shown. Roll forward from last year or import the prior year.</Notice>
      )}

      {tab === 'pl' && (
        <>
          <Tiles items={pl.ratios.map((r) => ({ label: r.label, value: ratioText(r.value) }))} />
          {budget && (
            <div className="flex gap-2 text-xs">
              <button type="button" className={btnSecondary} aria-pressed={compare === 'prior'} onClick={() => setCompare('prior')}>Against last year</button>
              <button type="button" className={btnSecondary} aria-pressed={compare === 'budget'} onClick={() => setCompare('budget')}>Against budget: {budget.name}</button>
            </div>
          )}
          {compare === 'budget' && budget ? (
            <div className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left"><th className={th}>Line</th><th className={`${th} text-right`}>Actual</th><th className={`${th} text-right`}>Budget</th><th className={`${th} text-right`}>Variance</th><th className={`${th} text-right`}>%</th></tr></thead>
                <tbody>
                  {budget.rows.map((r) => (
                    <tr key={r.label} className="border-t border-[#E3E7EF]"><td className="p-2">{r.label}</td><td className="p-2 text-right font-mono">{signed(r.actual)}</td><td className="p-2 text-right font-mono">{signed(r.budget)}</td><td className="p-2 text-right font-mono">{signed(r.variance)}</td><td className="p-2 text-right font-mono">{r.percent === null ? '–' : `${r.percent.toFixed(1)}%`}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Movements rows={pl.rows} />}
        </>
      )}

      {tab === 'bs' && (
        <>
          <div className={`p-4 rounded-xl border text-xs flex gap-3 ${bs.goingConcern.length ? 'bg-[#FDECEA] border-[#B42318]/30 text-[#B42318]' : 'bg-[#E6F4EF] border-[#0B6B52]/30 text-[#0B6B52]'}`}>
            {bs.goingConcern.length ? <AlertTriangle className="w-5 h-5 shrink-0" /> : <CheckCircle2 className="w-5 h-5 shrink-0" />}
            <div>
              <h2 className="font-bold">Going concern indicators</h2>
              {bs.goingConcern.length ? <ul className="list-disc pl-4 mt-1">{bs.goingConcern.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="mt-1">None triggered: net assets, net current assets, profit and cash against borrowing and tax were checked.</p>}
            </div>
          </div>
          <Tiles items={bs.ratios.map((r) => ({ label: r.label, value: ratioText(r.value, r.unit) }))} />
          <Movements rows={bs.rows} />
        </>
      )}

      {tab === 'queries' && (
        <div className="bg-white border border-[#E3E7EF] rounded-xl divide-y divide-[#E3E7EF]">
          {queries.length === 0 && <p className="p-4 text-xs text-[#4A5878]">Nothing to ask the client. Every flagged movement is explained and no evidence is missing.</p>}
          {queries.map((q) => (
            <div key={q.id} className="p-4 text-xs flex flex-wrap items-center justify-between gap-2">
              <span className="text-[#122654]">{q.text}</span>
              <Link href={q.href} className="font-bold text-[#B8432F] hover:underline">{q.source}</Link>
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <div className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
          {events.length === 0 ? (
            <p className="p-4 text-xs text-[#4A5878]">No ledger postings over the review threshold are dated after {ukDate(eng.period_end)}. Only postings already pulled from the ledger are scanned.</p>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-left"><th className={th}>Date</th><th className={th}>Contact</th><th className={th}>Description</th><th className={th}>Account</th><th className={`${th} text-right`}>Amount</th></tr></thead>
              <tbody>
                {events.map((t) => (
                  <tr key={t.id} className="border-t border-[#E3E7EF]"><td className="p-2">{ukDate(t.date)}</td><td className="p-2">{t.contact}</td><td className="p-2">{t.description}</td><td className="p-2">{t.account_code} {t.account_name}</td><td className="p-2 text-right font-mono">{signed(asPence(t.amount_p))}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

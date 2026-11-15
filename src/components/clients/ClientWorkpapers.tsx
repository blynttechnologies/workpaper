'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, Plus } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { periodLabel } from '@/lib/periods';
import { TEMPLATES, templateOf } from '@/lib/workpapers/templates';
import { StatusBadge } from '@/components/ui/StatusPill';
import { Engagement, Workpaper } from '@/lib/types/models';

type Filter = 'all' | 'attention' | 'in_progress' | 'not_started' | 'done';

// Where a paper stands, in the buckets the filter chips use
const bucket = (w: Workpaper): Exclude<Filter, 'all'> =>
  w.status === 'unreconciled' ? 'attention' : w.status === 'in_progress' ? 'in_progress' : w.status === 'not_started' ? 'not_started' : 'done';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['in_progress', 'In progress'],
  ['not_started', 'Not started'],
  ['done', 'Done'],
];

/** Every working paper for each of a client's periods, newest first: what's in the file and what can be added. */
export function ClientWorkpapers({ clientId }: { clientId: string }) {
  const [, refresh] = useState(0);
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const engagements = db.engagements.filter((e) => e.client_id === clientId).sort((a, b) => b.period_end.localeCompare(a.period_end));

  const add = (eng: Engagement, ref: string) => {
    const wp = db.addWorkpaper(eng.id, ref);
    db.logAudit(eng.firm_id, getActor(), 'ADD_WORKPAPER', 'workpapers', wp?.id ?? ref, null, { ref });
    refresh((n) => n + 1);
  };

  return (
    <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-xs p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#122654]">Working papers</h2>
        <span className="text-[11px] text-[#7E8DA6]">{engagements.length} {engagements.length === 1 ? 'period' : 'periods'}</span>
      </div>

      {!engagements.length && <p className="text-xs text-[#4A5878]">No periods yet. Start a new engagement to create this client’s working papers.</p>}

      {engagements.map((eng, i) => {
        const papers = db.workpapers.filter((w) => w.engagement_id === eng.id).sort((a, b) => a.ref.localeCompare(b.ref));
        const missing = TEMPLATES.filter((t) => !papers.some((w) => w.ref === t.ref));
        const count = (f: Filter) => (f === 'all' ? papers.length : papers.filter((w) => bucket(w) === f).length);
        const signedOff = papers.filter((w) => w.status === 'signed_off').length;
        const done = count('done');
        const pct = (n: number) => (papers.length ? `${(n / papers.length) * 100}%` : '0%');
        const filter = filters[eng.id] ?? 'all';
        const shown = filter === 'all' ? papers : papers.filter((w) => bucket(w) === filter);

        return (
          <details key={eng.id} open={i === 0} className="group rounded-xl border border-[#E3E7EF]">
            <summary className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 cursor-pointer list-none">
              <ChevronDown className="w-4 h-4 text-[#7E8DA6] -rotate-90 group-open:rotate-0 transition-transform shrink-0" aria-hidden="true" />
              <span className="min-w-[180px] flex-1">
                <span className="block text-sm font-bold text-[#122654]">{periodLabel(eng)}</span>
                <span className="block text-[11px] text-[#4A5878]">{eng.framework}{eng.status === 'locked' ? ' · Locked' : ''}</span>
              </span>
              <span className="w-full sm:w-56">
                <span className="flex justify-between text-[11px] text-[#4A5878] mb-1">
                  <span><strong className="text-[#122654]">{done}</strong> of {papers.length} done</span>
                  <span>{signedOff} signed off</span>
                </span>
                <span role="progressbar" aria-label={`${periodLabel(eng)}: papers done`} aria-valuenow={papers.length ? Math.round((done / papers.length) * 100) : 0} aria-valuemin={0} aria-valuemax={100} className="flex gap-0.5 h-1.5 rounded-full bg-[#EEF2F9] overflow-hidden">
                  <span className="bg-[#122654]" style={{ width: pct(signedOff) }} />
                  <span className="bg-[#FF7A66]" style={{ width: pct(done - signedOff) }} />
                  <span className="bg-[#B9C3E6]" style={{ width: pct(count('in_progress') + count('attention')) }} />
                </span>
              </span>
              <Link href={`/engagements/${eng.id}`} className="inline-flex items-center gap-1 min-h-[32px] px-3 rounded-lg border border-[#D3DCEE] text-xs font-semibold text-[#122654] hover:border-[#122654]">
                Open engagement <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </summary>

            <div className="px-4 pb-4 space-y-3">
              <div role="tablist" aria-label={`Filter ${periodLabel(eng)} papers`} className="flex flex-wrap gap-1.5 pt-3 border-t border-[#E3E7EF]">
                {FILTERS.filter(([f]) => f === 'all' || count(f) > 0).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilters({ ...filters, [eng.id]: f })}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold cursor-pointer transition-colors ${
                      filter === f
                        ? 'bg-[#122654] border-[#122654] text-white'
                        : f === 'attention'
                          ? 'bg-[#FFF1EE] border-[#FF7A66]/40 text-[#A23A27] hover:border-[#FF7A66]'
                          : 'bg-white border-[#D3DCEE] text-[#4A5878] hover:border-[#122654]'
                    }`}
                  >
                    {label}
                    <span className={filter === f ? 'opacity-80' : 'opacity-70'}>{count(f)}</span>
                  </button>
                ))}
              </div>

              <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
                {shown.map((w) => (
                  <li key={w.id} className="border-b border-[#EEF2F9]">
                    <Link href={`/engagements/${eng.id}/workpapers/${w.id}`} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover:bg-[#F5F8FD] text-xs text-[#122654]">
                      <span className="font-mono text-[10px] font-bold text-[#4A5878] bg-[#F5F8FD] border border-[#E3E7EF] rounded px-1.5 py-0.5 w-12 text-center shrink-0">{w.ref}</span>
                      <span className="flex-1 min-w-0 truncate" title={templateOf(w)?.title ?? w.ref}>{templateOf(w)?.title ?? w.ref}</span>
                      <StatusBadge status={w.status} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>

              {missing.length > 0 && (
                <details>
                  <summary className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D4E89] cursor-pointer list-none hover:underline">
                    {eng.status === 'locked' ? (
                      `Not in this file (${missing.length})`
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add more working papers ({missing.length})
                      </>
                    )}
                  </summary>
                  <ul className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-x-6">
                    {missing.map((t) => (
                      <li key={t.ref} className="flex items-center gap-2.5 px-1.5 py-1.5 border-b border-[#EEF2F9] text-xs text-[#4A5878]">
                        <span className="font-mono text-[10px] font-bold bg-[#F5F8FD] border border-[#E3E7EF] rounded px-1.5 py-0.5 w-12 text-center shrink-0">{t.ref}</span>
                        <span className="flex-1 min-w-0 truncate" title={t.title}>{t.title}</span>
                        {eng.status !== 'locked' && (
                          <button type="button" onClick={() => add(eng, t.ref)} aria-label={`Add ${t.ref} ${t.title} to ${periodLabel(eng)}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#D3DCEE] font-semibold text-[#1D4E89] hover:border-[#1D4E89] cursor-pointer">
                            <Plus className="w-3 h-3" aria-hidden="true" /> Add
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

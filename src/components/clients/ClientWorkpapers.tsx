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

// Left stripe colour on each paper card
const STRIPE: Record<Exclude<Filter, 'all'>, string> = {
  attention: 'border-l-[#FF7A66]',
  in_progress: 'border-l-[#1D4E89]',
  not_started: 'border-l-[#D3DCEE]',
  done: 'border-l-[#0B6B52]',
};

const DOT: Record<Exclude<Filter, 'all'>, string> = {
  attention: 'bg-[#FF7A66]',
  in_progress: 'bg-[#1D4E89]',
  not_started: 'bg-[#B9C3E6]',
  done: 'bg-[#0B6B52]',
};

/** Papers in their template's area (B Cash and bank, C Debtors…), areas in letter order. */
function groupByArea(papers: Workpaper[]) {
  const groups = new Map<string, { area: string; name: string; papers: Workpaper[] }>();
  for (const w of papers) {
    const t = templateOf(w);
    const area = t?.area ?? w.ref.charAt(0);
    if (!groups.has(area)) groups.set(area, { area, name: t?.areaName ?? 'Other', papers: [] });
    groups.get(area)!.papers.push(w);
  }
  return [...groups.values()].sort((a, b) => a.area.localeCompare(b.area));
}

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
                    {f !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${DOT[f]}`} aria-hidden="true" />}
                    {label}
                    <span className={filter === f ? 'opacity-80' : 'opacity-70'}>{count(f)}</span>
                  </button>
                ))}
              </div>

              {shown.length === 0 && <p className="text-xs text-[#4A5878] py-2">No papers here.</p>}

              {/* Papers grouped by area (B Cash and bank, C Debtors…), each a small card striped by where it stands */}
              <div className="space-y-4">
                {groupByArea(shown).map(({ area, name, papers: group }) => {
                  const groupDone = group.filter((w) => bucket(w) === 'done').length;
                  return (
                    <section key={area} aria-label={`${area} ${name}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-6 h-6 rounded-md bg-[#122654] text-white text-[11px] font-bold flex items-center justify-center">{area}</span>
                        <h3 className="text-xs font-bold text-[#122654]">{name}</h3>
                        <span className="text-[10px] text-[#7E8DA6]">{groupDone}/{group.length} done</span>
                        <span className="flex-1 h-px bg-[#EEF2F9]" aria-hidden="true" />
                      </div>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                        {group.map((w) => (
                          <li key={w.id}>
                            <Link
                              href={`/engagements/${eng.id}/workpapers/${w.id}`}
                              className={`flex h-full flex-col gap-2 p-3 rounded-lg border border-[#E3E7EF] border-l-4 ${STRIPE[bucket(w)]} bg-white hover:shadow-sm hover:-translate-y-px transition-all`}
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[10px] font-bold text-[#4A5878]">{w.ref}</span>
                                <StatusBadge status={w.status} size="sm" />
                              </span>
                              <span className="text-xs font-semibold text-[#122654] leading-snug line-clamp-2">{templateOf(w)?.title ?? w.ref}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>

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

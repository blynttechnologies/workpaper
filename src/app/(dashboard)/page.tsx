'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ArrowUpRight, Building2, CalendarClock, MessageSquare, Plus, TableProperties } from 'lucide-react';
import { db } from '@/lib/server/db';
import { useCompany } from '@/context/CompanyContext';
import { useLocale } from '@/context/LocaleContext';
import { DashboardBanner } from '@/components/dashboard/DashboardBanner';
import { Workpaper } from '@/lib/types/models';

// Where a paper stands, in order. One blue ramp (validated ordinal) plus orange for papers that need attention.
type Stand = 'signed_off' | 'prepared' | 'in_progress' | 'not_started' | 'attention';
const STANDS: { key: Stand; label: string; colour: string }[] = [
  { key: 'signed_off', label: 'Signed off', colour: '#0d366b' },
  { key: 'prepared', label: 'Prepared', colour: '#1c5cab' },
  { key: 'in_progress', label: 'In progress', colour: '#3987e5' },
  { key: 'not_started', label: 'Not started', colour: '#86b6ef' },
  { key: 'attention', label: 'Needs attention', colour: '#eb6834' },
];
const standOf = (w: Workpaper): Stand =>
  w.status === 'signed_off'
    ? 'signed_off'
    : w.status === 'prepared' || w.status === 'reconciled'
      ? 'prepared'
      : w.status === 'unreconciled'
        ? 'attention'
        : w.status === 'in_progress'
          ? 'in_progress'
          : 'not_started';

const STAGES = ['Import', 'Map', 'Prepare', 'Review', 'Sign'] as const;

/** A part-to-whole bar of papers by where they stand, 2px gaps between segments, hover shows the count. */
function StandBar({ counts, total, height = 'h-2' }: { counts: Record<Stand, number>; total: number; height?: string }) {
  return (
    <span className={`flex gap-[2px] ${height} w-full rounded-full overflow-hidden bg-[#EEF2F9]`}>
      {STANDS.filter((s) => counts[s.key] > 0).map((s) => (
        <span key={s.key} title={`${s.label}: ${counts[s.key]} of ${total}`} style={{ width: `${(counts[s.key] / total) * 100}%`, background: s.colour }} />
      ))}
    </span>
  );
}

const countStands = (papers: Workpaper[]) => {
  const counts = { signed_off: 0, prepared: 0, in_progress: 0, not_started: 0, attention: 0 } as Record<Stand, number>;
  for (const w of papers) counts[standOf(w)]++;
  return counts;
};

export default function PracticeHomePage() {
  const { clients, setActiveCompanyId } = useCompany();
  const { formatDate, jurisdiction } = useLocale();

  const fmtDate = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86400000);
  const timeAgo = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };

  // All figures and counts strictly derived from live data (Ground Rule 2)
  const activeClients = clients.filter((c) => !c.archived_at);
  const openEngagements = db.engagements.filter((e) => e.status !== 'locked' && activeClients.some((c) => c.id === e.client_id));
  const openReviewNotes = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open');
  const accountsToMap = db.account_mappings.filter((m) => m.status !== 'confirmed');
  const readyForSignoff = db.workpapers.filter((w) => w.status === 'prepared');

  // One row per active client: its latest year, papers by where they stand, and the stage it has reached
  const rows = activeClients.map((client) => {
    const eng = db.engagements.filter((e) => e.client_id === client.id).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    const papers = eng ? db.workpapers.filter((w) => w.engagement_id === eng.id && w.applicable !== false) : [];
    const counts = countStands(papers);
    const done = counts.signed_off + counts.prepared;
    let stage = eng ? 'Import' : 'No engagement';
    if (eng) {
      const hasTb = db.tb_snapshots.some((t) => t.engagement_id === eng.id);
      const maps = db.account_mappings.filter((m) => m.engagement_id === eng.id);
      const unmapped = maps.filter((m) => m.status !== 'confirmed').length;
      const doneFlags = [hasTb, hasTb && maps.length > 0 && unmapped === 0, papers.length > 0 && done === papers.length, papers.length > 0 && counts.signed_off === papers.length, Boolean(eng.locked_at)];
      const at = doneFlags.findIndex((f) => !f);
      stage = at === -1 ? 'Signed' : STAGES[at];
    }
    return { client, eng, papers, counts, done, stage, href: `/clients/${client.id}`, percent: papers.length ? Math.round((done / papers.length) * 100) : 0 };
  });

  const allPapers = rows.flatMap((r) => r.papers);
  const practiceCounts = countStands(allPapers);
  const practiceDone = practiceCounts.signed_off + practiceCounts.prepared;
  const practicePercent = allPapers.length ? Math.round((practiceDone / allPapers.length) * 100) : 0;

  // Engagements by the stage they have reached
  const stageCounts = STAGES.map((s) => ({ stage: s, count: rows.filter((r) => r.stage === s).length }));
  const signedCount = rows.filter((r) => r.stage === 'Signed').length;
  const stageMax = Math.max(1, ...stageCounts.map((s) => s.count), signedCount);

  // Practice updates: what needs someone now, then what has happened
  const needsYou = rows.flatMap((r) => {
    if (!r.eng) return [];
    const items: { key: string; icon: 'attention' | 'notes' | 'map'; text: string; href: string }[] = [];
    if (r.counts.attention) items.push({ key: `${r.eng.id}_att`, icon: 'attention', text: `${r.client.name}: ${r.counts.attention} working paper${r.counts.attention === 1 ? ' does' : 's do'} not agree to the trial balance`, href: `/clients/${r.client.id}` });
    const ids = new Set(r.papers.map((w) => w.id));
    const notes = openReviewNotes.filter((c) => ids.has(c.workpaper_id)).length;
    if (notes) items.push({ key: `${r.eng.id}_notes`, icon: 'notes', text: `${r.client.name}: ${notes} open review note${notes === 1 ? '' : 's'}`, href: `/engagements/${r.eng.id}/review` });
    const unmapped = accountsToMap.filter((m) => m.engagement_id === r.eng!.id).length;
    if (unmapped) items.push({ key: `${r.eng.id}_map`, icon: 'map', text: `${r.client.name}: ${unmapped} account${unmapped === 1 ? '' : 's'} to map`, href: `/engagements/${r.eng.id}/mapping` });
    return items;
  });

  // Statutory filing deadline: 9 months after year end (private companies)
  const deadlines = rows
    .filter((r) => r.eng && r.eng.status !== 'locked')
    .map((r) => {
      const due = new Date(r.eng!.period_end);
      due.setMonth(due.getMonth() + 9);
      return { client: r.client.name, date: fmtDate(due.toISOString()), days: daysUntil(due) };
    })
    .filter((d) => d.days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);

  const recent = [...db.audit_logs]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5)
    .map((log) => ({ id: log.id, actor: log.actor_name, action: `${log.action.toLowerCase().replace(/_/g, ' ')} (${log.entity.replace(/_/g, ' ')})`, time: timeAgo(log.at) }));

  const metrics = [
    { value: openEngagements.length, label: 'In progress', sub: 'Open engagements', colour: 'text-[#122654]' },
    { value: openReviewNotes.length, label: 'Review notes', sub: 'Open notes', colour: 'text-[#C2410C]' },
    { value: accountsToMap.length, label: 'Accounts to map', sub: 'Awaiting confirmation', colour: 'text-[#122654]' },
    { value: readyForSignoff.length, label: 'Ready for sign-off', sub: 'Papers prepared', colour: 'text-[#122654]' },
  ];
  const card = 'bg-white border border-[#E3E7EF] rounded-xl shadow-2xs';
  const updateIcon = { attention: AlertTriangle, notes: MessageSquare, map: TableProperties };

  return (
    <div className="flex flex-col gap-5 pb-14 max-w-7xl mx-auto">
      <h1 className="sr-only">Dashboard</h1>
      {/* Banner: live working-paper news, then what Blynt can do */}
      <DashboardBanner
        summary={`${activeClients.length} client${activeClients.length === 1 ? '' : 's'} · ${allPapers.length} working papers · ${practiceCounts.attention} need attention`}
      />

      {/* Fresh workspace welcome banner if no company added yet */}
      {clients.length === 0 && (
        <div className={`${card} p-10 text-center flex flex-col items-center`}>
          <div className="w-14 h-14 rounded-2xl bg-[#0B1A3B] flex items-center justify-center mb-4">
            <Building2 className="w-7 h-7 text-[#FF7A66]" />
          </div>
          <h2 className="text-xl font-extrabold text-[#122654]">Welcome to Blynt Workpapers</h2>
          <p className="text-sm text-[#4A5878] max-w-md mt-2 mb-5">Add your first client to start managing working papers, trial balances and statutory accounts.</p>
          <Link href="/engagements/new" className="px-5 py-2.5 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-xl flex items-center gap-2">
            <Plus className="w-4 h-4 stroke-[2.5]" /> Create first client and engagement
          </Link>
        </div>
      )}

      {clients.length > 0 && (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {metrics.map((m) => (
              <div key={m.label} className={`${card} px-4 py-3 flex items-center gap-3`}>
                <span className={`text-2xl font-bold font-mono-numbers ${m.colour}`}>{m.value}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[#122654]">{m.label}</span>
                  <span className="block text-[11px] text-[#4A5878]">{m.sub}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Client list with each client's progress */}
            <section aria-labelledby="clients-heading" className={`${card} lg:col-span-8 p-4`}>
              <div className="flex items-center justify-between mb-2">
                <h2 id="clients-heading" className="text-sm font-bold text-[#122654]">Clients</h2>
                <Link href="/clients" className="text-xs font-semibold text-[#122654] hover:underline flex items-center gap-1">
                  All clients <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              <ul className="divide-y divide-[#EEF2F9]">
                {rows.map((r) => (
                  <li key={r.client.id}>
                    <Link
                      href={r.href}
                      onClick={() => setActiveCompanyId(r.client.id)}
                      className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_5.5rem_auto] items-center gap-x-4 gap-y-1.5 py-2.5 px-1 rounded-md hover:bg-[#F5F8FD] group"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-[#122654] truncate group-hover:text-[#B8432F]">{r.client.name}</span>
                        <span className="block text-[10px] text-[#4A5878] truncate">
                          {r.client.company_type}{r.eng ? ` · YE ${fmtDate(r.eng.period_end)}` : ''}
                        </span>
                      </span>
                      <span className="col-span-2 sm:col-span-1 order-last sm:order-none flex items-center gap-2">
                        {r.papers.length ? <StandBar counts={r.counts} total={r.papers.length} /> : <span className="text-[10px] text-[#7E8DA6]">No papers yet</span>}
                        <span className="text-[11px] font-bold text-[#122654] font-mono-numbers w-9 text-right shrink-0">{r.papers.length ? `${r.percent}%` : ''}</span>
                      </span>
                      <span className="hidden sm:inline text-[10px] font-semibold text-[#4A5878]">{r.stage}</span>
                      <span className="flex items-center gap-1.5 justify-end">
                        {r.counts.attention > 0 && (
                          <span className="text-[10px] font-bold px-1.5 rounded-full bg-[#FFF1EE] text-[#A23A27]" title={`${r.counts.attention} need attention`}>! {r.counts.attention}</span>
                        )}
                        <ArrowRight className="w-3.5 h-3.5 text-[#7E8DA6] group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {/* Charts */}
            <div className="lg:col-span-4 flex flex-col gap-5">
              <section aria-labelledby="papers-chart-heading" className={`${card} p-4`}>
                <h2 id="papers-chart-heading" className="text-sm font-bold text-[#122654]">Working papers</h2>
                <p className="text-[11px] text-[#4A5878] mb-3">Latest year of every client</p>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl font-extrabold text-[#122654] font-mono-numbers">{practicePercent}%</span>
                  <span className="text-[11px] text-[#4A5878]">done · {practiceDone} of {allPapers.length}</span>
                </div>
                {allPapers.length > 0 && <StandBar counts={practiceCounts} total={allPapers.length} height="h-3" />}
                {/* Legend doubles as the table view: every status with its count */}
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {STANDS.map((s) => (
                    <div key={s.key} className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.colour }} aria-hidden="true" />
                      <dt className="text-[#4A5878] flex-1">{s.label}</dt>
                      <dd className="font-bold text-[#122654] font-mono-numbers">{practiceCounts[s.key]}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-labelledby="stage-chart-heading" className={`${card} p-4`}>
                <h2 id="stage-chart-heading" className="text-sm font-bold text-[#122654]">Where engagements are</h2>
                <p className="text-[11px] text-[#4A5878] mb-3">Clients by the stage their latest year has reached</p>
                <ul className="flex items-end gap-2 h-28" aria-label="Engagements by stage">
                  {[...stageCounts, { stage: 'Signed', count: signedCount }].map((s) => (
                    <li key={s.stage} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${s.stage}: ${s.count}`}>
                      <span className="text-[11px] font-bold text-[#122654] font-mono-numbers">{s.count}</span>
                      <span className="w-full max-w-8 rounded-t bg-[#1c5cab]" style={{ height: `${(s.count / stageMax) * 70}%`, minHeight: s.count ? 4 : 0 }} />
                      <span className="w-full border-t border-[#D3DCEE] pt-1 text-center text-[10px] text-[#4A5878]">{s.stage}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          {/* Practice updates */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <section aria-labelledby="updates-heading" className={`${card} lg:col-span-8 p-4`}>
              <h2 id="updates-heading" className="text-sm font-bold text-[#122654] mb-2">Practice updates</h2>
              {needsYou.length === 0 && recent.length === 0 && <p className="text-xs text-[#4A5878] py-2">Nothing new.</p>}
              <ul className="divide-y divide-[#EEF2F9]">
                {needsYou.map((u) => {
                  const Icon = updateIcon[u.icon];
                  return (
                    <li key={u.key}>
                      <Link href={u.href} className="flex items-center gap-2.5 py-2 text-xs text-[#122654] hover:text-[#B8432F]">
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${u.icon === 'attention' ? 'bg-[#FFF1EE] text-[#C2410C]' : 'bg-[#EAF0FB] text-[#1D4E89]'}`}>
                          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        </span>
                        <span className="flex-1 min-w-0">{u.text}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#7E8DA6] shrink-0" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
                {recent.map((a) => (
                  <li key={a.id} className="flex items-center gap-2.5 py-2 text-xs text-[#122654]">
                    <span className="w-6 h-6 rounded-md bg-[#F5F8FD] text-[#4A5878] flex items-center justify-center text-[10px] font-bold shrink-0" aria-hidden="true">
                      {a.actor.charAt(0)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="font-bold">{a.actor}</span> {a.action}
                    </span>
                    <span className="text-[10px] text-[#7E8DA6] shrink-0">{a.time}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="deadlines-heading" className={`${card} lg:col-span-4 p-4`}>
              <h2 id="deadlines-heading" className="text-sm font-bold text-[#122654] mb-2 flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4" aria-hidden="true" /> Upcoming deadlines
              </h2>
              {deadlines.length === 0 && <p className="text-xs text-[#4A5878] py-2">No upcoming deadlines.</p>}
              <ul className="divide-y divide-[#EEF2F9]">
                {deadlines.map((d) => (
                  <li key={d.client + d.date} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-[#122654] truncate">{d.client}</span>
                      <span className="block text-[10px] text-[#4A5878]">{jurisdiction.filingDeadlineLabel} · {d.date}</span>
                    </span>
                    <span className={`text-[11px] font-bold whitespace-nowrap ${d.days <= 60 ? 'text-[#B8432F]' : 'text-[#4A5878]'}`}>{d.days} days</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

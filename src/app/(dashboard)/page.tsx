'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Plus, Building2 } from 'lucide-react';
import { db } from '@/lib/server/db';
import { WorkflowCards } from '@/components/workflow/WorkflowCards';
import { useCompany } from '@/context/CompanyContext';
import { useLocale } from '@/context/LocaleContext';

const PILL_STYLE: Record<string, string> = {
  done: 'bg-[#E6F4EF] text-[#0B6B52] border-[#0B6B52]/30',
  alert: 'bg-[#FFF1EE] text-[#A23A27] border-[#FF7A66]',
  in_progress: 'bg-[#EAF0FB] text-[#1D4E89] border-[#1D4E89]/30',
  todo: 'bg-white text-[#7E8DA6] border-[#D3DCEE]',
};
const PILL_SYMBOL: Record<string, string> = { done: '✓', alert: '!', in_progress: '●', todo: '○' };

export default function PracticeHomePage() {
  const { activeCompany, activeEngagement, clients, setActiveCompanyId } = useCompany();
  const { formatDate, jurisdiction } = useLocale();

  // Scoped metrics for active selected company
  const companyEng = activeEngagement;

  // All figures and counts strictly derived from live data (Ground Rule 2)
  const engagementsInProgress = db.engagements.filter((e) => e.status !== 'locked');
  const openReviewNotes = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open');
  const accountsToMap = db.account_mappings.filter((m) => m.status !== 'confirmed');
  const readyForSignoff = db.workpapers.filter((w) => w.status === 'prepared');

  const fmtDate = (iso: string) =>
    formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const daysUntil = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86400000);
  const timeAgo = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins}m ago`;
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };
  const clientName = (clientId: string) => db.clients.find((c) => c.id === clientId)?.name ?? 'Unknown client';

  // Engagements list with 5-stage chain visual, derived from live data
  const engagements = engagementsInProgress.map((e) => {
    const hasTb = db.tb_snapshots.some((t) => t.engagement_id === e.id);
    const maps = db.account_mappings.filter((m) => m.engagement_id === e.id);
    const unmapped = maps.filter((m) => m.status !== 'confirmed').length;
    const papers = db.workpapers.filter((w) => w.engagement_id === e.id);
    const prepared = papers.filter((w) => w.status === 'prepared' || w.status === 'signed_off').length;
    const reviewed = papers.filter((w) => w.status === 'signed_off').length;
    const st = (done: boolean, started: boolean, alert = false) =>
      done ? 'done' : alert ? 'alert' : started ? 'in_progress' : 'todo';
    const mapDone = hasTb && maps.length > 0 && unmapped === 0;
    const prepDone = papers.length > 0 && prepared === papers.length;
    const revDone = papers.length > 0 && reviewed === papers.length;
    const stages = [
      { label: 'Import', status: st(hasTb, true) },
      { label: 'Map', status: st(mapDone, hasTb, hasTb && unmapped > 0) },
      { label: 'Prepare', status: st(prepDone, prepared > 0) },
      { label: 'Review', status: st(revDone, reviewed > 0) },
      { label: 'Sign', status: st(Boolean(e.locked_at), false) },
    ];
    const targetHref = !hasTb
      ? `/engagements/${e.id}/import`
      : !mapDone
        ? `/engagements/${e.id}/mapping`
        : `/engagements/${e.id}`;
    return {
      id: e.id,
      client: clientName(e.client_id),
      framework: e.framework,
      yearEnd: fmtDate(e.period_end),
      periodEnd: e.period_end,
      stages,
      targetHref,
    };
  });

  // Statutory filing deadline: 9 months after year end (private companies)
  const upcomingDeadlines = engagements
    .map((eng) => {
      const due = new Date(eng.periodEnd);
      due.setMonth(due.getMonth() + 9);
      return {
        date: fmtDate(due.toISOString()),
        client: eng.client,
        label: jurisdiction.filingDeadlineLabel,
        days: daysUntil(due),
      };
    })
    .filter((d) => d.days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 3);

  // Recent activity from the audit trail
  const recentActivities = [...db.audit_logs]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4)
    .map((log) => ({
      actor: log.actor_name,
      action: `${log.action.toLowerCase().replace(/_/g, ' ')} (${log.entity.replace(/_/g, ' ')})`,
      time: timeAgo(log.at),
    }));

  const metrics = [
    { value: engagementsInProgress.length, label: 'In progress', sub: 'Active engagements', colour: 'text-[#122654]' },
    { value: openReviewNotes.length, label: 'Review notes for you', sub: 'Open notes', colour: 'text-[#E0533D]' },
    { value: accountsToMap.length, label: 'Accounts to map', sub: 'Awaiting confirmation', colour: 'text-[#0B6B52]' },
    { value: readyForSignoff.length, label: 'Ready for sign-off', sub: 'Papers prepared', colour: 'text-[#122654]' },
  ];

  const emptyNote = (text: string) => <p className="text-xs text-[#4A5878] py-3">{text}</p>;

  return (
    <div className="flex flex-col gap-6 pb-14 max-w-7xl mx-auto">
      {/* Fresh workspace welcome banner if no company added yet */}
      {clients.length === 0 && (
        <div className="blynt-card p-8 bg-gradient-to-br from-white via-[#F5F8FD] to-[#EDF2F9] border-[#D3DCEE] shadow-sm relative overflow-hidden text-center flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-3xl bg-[#0B1A3B] text-[#FF7A66] flex items-center justify-center font-bold shadow-md mb-4">
            <Building2 className="w-8 h-8 text-[#FF7A66]" />
          </div>
          <h2 className="text-2xl font-extrabold text-[#122654] tracking-tight">
            Welcome to Blynt Workpapers
          </h2>
          <p className="text-sm text-[#4A5878] max-w-md mt-2 mb-6">
            Your environment is clean with zero demo data. Add your first accounting client or company to start managing workpapers, trial balances, and statutory accounts.
          </p>
          <Link
            href="/engagements/new"
            className="px-5 py-2.5 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Create First Company &amp; Engagement</span>
          </Link>
        </div>
      )}

      {/* If companies exist but none selected, show interactive Company Selector Cards */}
      {!activeCompany && clients.length > 0 && (
        <div className="blynt-card p-6 bg-white border-[#D3DCEE] shadow-sm animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E3E7EF]">
            <div>
              <h2 className="text-base font-bold text-[#122654]">Select a company to open its working papers</h2>
              <p className="text-xs text-[#4A5878] mt-0.5">Click any company below to load all options, engagement stages, and statutory accounts.</p>
            </div>
            <Link
              href="/engagements/new"
              className="px-3.5 py-2 bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-2xs shrink-0 self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Company</span>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {clients.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCompanyId(c.id)}
                className="p-4 rounded-xl border border-[#E3E7EF] hover:border-[#122654] hover:shadow-md bg-white text-left transition-all group cursor-pointer flex flex-col justify-between min-h-[120px]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EAF5FC] text-[#1D4E89] uppercase">
                    {c.company_type}
                  </span>
                  <span className="text-xs font-bold text-[#FF7A66] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                    Open <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
                <div>
                  <div className="text-sm font-bold text-[#122654] group-hover:text-[#B8432F] transition-colors mt-2">
                    {c.name}
                  </div>
                  <div className="text-xs text-[#4A5878] mt-1 font-mono-numbers">
                    Co #{c.company_no} · Year End: {c.year_end || '2026-12-31'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeCompany && companyEng && (
        <>
          {/* Company header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-xl bg-[#122654] shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-[#122654] tracking-tight">{activeCompany.name}</h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#EAF0FB] text-[#1D4E89] border border-[#1D4E89]/20 uppercase">
                    {activeCompany.company_type}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E6F4EF] text-[#0B6B52] uppercase">
                    ● {companyEng.status}
                  </span>
                </div>
                <p className="text-xs text-[#4A5878] mt-1">
                  Year end {fmtDate(companyEng.period_end)} · Source: {activeCompany.data_source === 'csv' ? 'CSV/Excel' : activeCompany.data_source}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href={`/engagements/${companyEng.id}/import`}
                className="min-h-[44px] px-4 flex items-center border border-[#D3DCEE] hover:border-[#122654] bg-white text-[#122654] text-xs font-semibold rounded-xl transition-colors"
              >
                Import trial balance
              </Link>
              <Link
                href="/engagements/new"
                className="min-h-[44px] px-4 flex items-center gap-1.5 bg-[#FF7A66] hover:bg-[#ff9485] text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                New engagement
              </Link>
            </div>
          </div>

          <WorkflowCards
            engagementIds={db.engagements.filter((e) => e.client_id === companyEng.client_id).sort((x, y) => y.period_end.localeCompare(x.period_end)).map((e) => e.id)}
          />

          {/* Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((m) => (
              <Link key={m.label} href="/clients" className="blynt-card px-4 py-3.5 flex items-center gap-4 hover:border-[#122654]/40 transition-colors">
                <span className={`text-2xl font-mono-numbers ${m.colour}`}>{m.value}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[#122654]">{m.label}</span>
                  <span className="block text-[11px] text-[#4A5878]">{m.sub}</span>
                </span>
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Active engagements */}
            <div className="lg:col-span-8 blynt-card p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-[#122654]">Active engagements</h2>
                <Link href="/clients" className="text-xs font-semibold text-[#122654] hover:underline flex items-center gap-1">
                  View all clients <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              {engagements.length === 0 && emptyNote('No active engagements yet.')}
              <ul className="divide-y divide-[#E3E7EF]">
                {engagements.map((eng) => (
                  <li key={eng.id}>
                    <Link href={eng.targetHref} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 group">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#122654] group-hover:text-[#B8432F] transition-colors truncate">{eng.client}</div>
                        <div className="text-[11px] text-[#4A5878]">{eng.framework} · YE {eng.yearEnd}</div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="flex flex-wrap items-center gap-1">
                          {eng.stages.map((s) => (
                            <span key={s.label} className={`text-[10px] font-semibold px-1.5 py-1 rounded-md border whitespace-nowrap ${PILL_STYLE[s.status]}`}>
                              {PILL_SYMBOL[s.status]} {s.label}
                            </span>
                          ))}
                        </div>
                        <span className="text-xs font-bold text-[#122654] group-hover:underline whitespace-nowrap">Open →</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right rail */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              <div className="blynt-card p-5">
                <h3 className="text-sm font-bold text-[#122654] mb-1">Upcoming deadlines</h3>
                {upcomingDeadlines.length === 0 && emptyNote('No upcoming deadlines.')}
                <ul className="divide-y divide-[#E3E7EF]">
                  {upcomingDeadlines.map((dl, idx) => (
                    <li key={idx} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#122654] truncate">{dl.client}</div>
                        <div className="text-[11px] text-[#4A5878]">{dl.label} · {dl.date}</div>
                      </div>
                      <span className="text-[11px] font-bold text-[#B8432F] whitespace-nowrap">{dl.days} days</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="blynt-card p-5">
                <h3 className="text-sm font-bold text-[#122654] mb-2">Recent activity</h3>
                {recentActivities.length === 0 && emptyNote('No activity yet.')}
                <ul className="flex flex-col gap-3 text-xs">
                  {recentActivities.map((act, i) => (
                    <li key={i} className="text-[#122654]">
                      <span className="font-bold">{act.actor}</span> {act.action}
                      <span className="text-[10px] text-[#7E8DA6] ml-2">{act.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

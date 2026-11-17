'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  Building2,
  MessageSquare,
  FileDown,
  TableProperties,
  Scale,
  FileCheck2,
  Lock,
  FileSpreadsheet,
  BookOpen,
  GraduationCap,
  Percent,
  ArrowUpRight,
  Sliders,
  Globe,
  ListChecks,
  LineChart,
  Timer,
} from 'lucide-react';
import { formatDuration } from './useEngagementTimer';
import { BlyntLogo } from '@/components/ui/BlyntLogo';
import { db } from '@/lib/server/db';
import { workflowsOf } from '@/lib/workflows';
import { useCompany } from '@/context/CompanyContext';
import { useLocale } from '@/context/LocaleContext';
import { ukDate } from '@/lib/dates';

// Brand kit: deep navy for dark sections, navy for the active item, coral only as a shape (bar, badge, icon)
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A66] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1A3B]';

/** Locale indicator badge shown in the sidebar footer */
const LocaleFooterBadge: React.FC = () => {
  const { jurisdiction } = useLocale();
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/5">
      <Globe className="w-3.5 h-3.5 text-[#FF7A66] shrink-0" aria-hidden="true" />
      <div className="flex flex-col min-w-0">
        <span className="text-[11px] text-[#C5CFE3] leading-tight truncate">{jurisdiction.label}</span>
        <span className="text-[10px] text-[#8C9BBA] truncate">
          {jurisdiction.currency} · {jurisdiction.frameworkLabel}
        </span>
      </div>
    </div>
  );
};

type Item = { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number; badgeLabel?: string };

const itemCls = (on: boolean) =>
  `relative flex items-center gap-3 mx-3 px-3 h-9 rounded-lg text-[13px] transition-colors ${focus} ${on ? 'bg-[#122654] text-white font-semibold' : 'text-[#C5CFE3] font-medium hover:bg-white/5 hover:text-white'}`;
// The coral bar beside the page you are on
const ActiveBar = () => <span aria-hidden="true" className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#FF7A66]" />;

function NavLink({ item, on, onClick }: { item: Item; on: boolean; onClick?: () => void }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} onClick={onClick} aria-current={on ? 'page' : undefined} className={itemCls(on)}>
      {on && <ActiveBar />}
      <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-[#FF7A66]' : 'text-[#8C9BBA]'}`} aria-hidden="true" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#FF7A66] text-[#0B1A3B] text-[11px] font-bold flex items-center justify-center" aria-label={item.badgeLabel}>
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="px-6 pb-1.5 text-[11px] font-semibold text-[#8C9BBA]">{label}</p>
      <nav aria-label={label} className="flex flex-col gap-0.5">
        {children}
      </nav>
    </div>
  );
}

interface AppSidebarProps {
  currentEngagementId?: string;
  onMobileClose?: () => void;
  /** Seconds this engagement has been open; shown once it reaches five minutes */
  timerSeconds?: number;
  /** No activity for a while: the timer has stopped counting */
  timerPaused?: boolean;
}

const TIMER_SHOW_AFTER = 5 * 60;

export const AppSidebar: React.FC<AppSidebarProps> = ({ currentEngagementId: currentEngagementIdProp, onMobileClose, timerSeconds = 0, timerPaused = false }) => {
  const { activeCompany, activeEngagement: contextEngagement } = useCompany();
  const pathname = usePathname();
  const router = useRouter();

  const match = pathname.match(/\/engagements\/([^/]+)/);
  const routeEngagementId = match && match[1] !== 'new' ? match[1] : null;

  const activeEngagement = currentEngagementIdProp
    ? db.engagements.find((e) => e.id === currentEngagementIdProp) || contextEngagement
    : routeEngagementId
      ? db.engagements.find((e) => e.id === routeEngagementId) || contextEngagement
      : contextEngagement;

  const routeClient = activeEngagement ? db.clients.find((c) => c.id === activeEngagement.client_id) : null;
  const activeClient = routeClient || activeCompany;

  const currentEngagementId = activeEngagement?.id ?? currentEngagementIdProp ?? routeEngagementId ?? null;
  const engagementBase = currentEngagementId ? `/engagements/${currentEngagementId}` : '';

  // Engagement nav only inside a client's engagement; the dashboard and other practice pages hide it
  const showEngagementOptions = Boolean(routeEngagementId || currentEngagementIdProp);
  const workflows = activeEngagement ? workflowsOf(activeEngagement.id) : [];

  // Live counts for the badges
  const engagementPaperIds = new Set(db.workpapers.filter((w) => w.engagement_id === currentEngagementId).map((w) => w.id));
  const openReviewNotesCount = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open' && engagementPaperIds.has(c.workpaper_id)).length;
  const mappingNeededCount = db.account_mappings.filter((m) => m.engagement_id === currentEngagementId && m.status !== 'confirmed').length;

  // Keyboard shortcut: N for New engagement
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'n' || e.key === 'N') && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) && !(e.target as HTMLElement)?.isContentEditable) {
        e.preventDefault();
        router.push('/engagements/new');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  const isLinkActive = (href: string, exact = false) => (exact ? pathname === href : pathname.startsWith(href));

  const links = (items: Item[]) => items.map((i) => <NavLink key={i.href} item={i} on={isLinkActive(i.href, i.exact)} onClick={onMobileClose} />);

  const practice: Item[] = [
    { href: '/', label: 'Dashboard', icon: Home, exact: true },
    { href: '/clients', label: 'Clients', icon: Building2 },
    { href: '/time', label: 'Time log', icon: Timer },
    { href: '/settings', label: 'Practice settings', icon: Sliders },
  ];
  const prepare: Item[] = [
    { href: `${engagementBase}/workflow`, label: 'Workflow', icon: ListChecks },
    { href: `${engagementBase}/trial-balance`, label: 'Trial balance', icon: Scale },
    { href: `${engagementBase}/mapping`, label: 'Mapping', icon: TableProperties, badge: mappingNeededCount, badgeLabel: `${mappingNeededCount} accounts to map` },
    { href: `${engagementBase}/journals`, label: 'Journals', icon: BookOpen },
    { href: `${engagementBase}/documents`, label: 'Documents', icon: FileSpreadsheet },
  ];
  const report: Item[] = [
    { href: `${engagementBase}/analysis`, label: 'Analysis', icon: LineChart },
    { href: `${engagementBase}/disclosures`, label: 'Disclosures and notes', icon: FileCheck2 },
    { href: `${engagementBase}/reports`, label: 'Reports', icon: FileDown },
  ];
  const finish: Item[] = [
    { href: `${engagementBase}/review`, label: 'Review', icon: MessageSquare, badge: openReviewNotesCount, badgeLabel: `${openReviewNotesCount} open review ${openReviewNotesCount === 1 ? 'note' : 'notes'}` },
    { href: `${engagementBase}/history`, label: 'History', icon: Lock },
  ];
  const library: Item[] = [
    { href: '/library/standards', label: 'Learning library', icon: GraduationCap },
    { href: '/library/tax', label: 'Tax library', icon: Percent },
  ];

  return (
    <aside aria-label="Sidebar navigation" className="w-full h-full min-h-full bg-[#0B1A3B] text-white flex flex-col justify-between shrink-0 select-none">
      <div className="flex flex-col pb-4">
        {/* Logo, in its white rectangle */}
        <div className="px-5 pt-5 pb-1">
          <Link href="/" onClick={onMobileClose} aria-label="Blynt Workpapers home" className={`inline-flex rounded-lg p-1 ${focus}`}>
            <BlyntLogo variant="full" theme="dark" size="md" />
          </Link>
        </div>

        <Group label="Practice">{links(practice)}</Group>

        {showEngagementOptions && activeEngagement && (
          <>
            {/* Which client and year these links work on */}
            <div className="mt-5 mx-3 rounded-xl bg-[#122654] px-3 py-2.5">
              <p className="text-[10px] font-semibold text-[#8C9BBA]">Working on</p>
              <Link href={activeClient ? `/clients/${activeClient.id}` : '/clients'} onClick={onMobileClose} className={`block text-sm font-bold text-white truncate hover:underline rounded ${focus}`} title={activeClient?.name}>
                {activeClient?.name ?? 'Client'}
              </Link>
              <p className="text-[11px] text-[#C5CFE3]">Year ended {ukDate(activeEngagement.period_end)}</p>
              {timerSeconds >= TIMER_SHOW_AFTER && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white" title="Time on this client, recorded against you">
                  <Timer className="w-3.5 h-3.5 text-[#FF7A66]" aria-hidden="true" />
                  <span className="font-mono tabular-nums" role="timer" aria-label="Time on this client">{formatDuration(timerSeconds)}</span>
                  {timerPaused && <span className="text-[#8C9BBA]">Paused, no activity</span>}
                </p>
              )}
            </div>

            <Group label="Prepare">{links(prepare)}</Group>
            <Group label="Report">{links(report)}</Group>
            <Group label="Finish">{links(finish)}</Group>

            {workflows.length > 0 && (
              <Group label="Workflows">
                {workflows.map((wf) => {
                  const href = `${engagementBase}/workflows/${wf.id}`;
                  const on = isLinkActive(href);
                  const initials = wf.name
                    .split(/[\s-]+/)
                    .filter((w) => /^[A-Za-z]/.test(w))
                    .map((w) => w[0].toUpperCase())
                    .slice(0, 3)
                    .join('');
                  return (
                    <Link key={wf.id} href={href} onClick={onMobileClose} aria-current={on ? 'page' : undefined} className={itemCls(on)}>
                      {on && <ActiveBar />}
                      <span className="w-6 h-6 shrink-0 rounded-md bg-white/10 text-[9px] font-bold flex items-center justify-center" aria-hidden="true">
                        {initials}
                      </span>
                      <span className="truncate" title={wf.name}>{wf.name}</span>
                    </Link>
                  );
                })}
              </Group>
            )}
          </>
        )}

        <Group label="Library">{links(library)}</Group>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-white/10 px-4 pb-6 flex flex-col gap-1.5">
        <LocaleFooterBadge />
        <a
          href="https://blynt.co.uk"
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center justify-between px-2.5 py-2 text-xs text-[#C5CFE3] hover:text-white rounded-lg hover:bg-white/5 transition-colors ${focus}`}
        >
          <span>Back to Blynt accounting</span>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </aside>
  );
};

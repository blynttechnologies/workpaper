import { db } from '@/lib/server/db';
import { Client, Workpaper } from '@/lib/types/models';

// Where a paper stands, in order. One blue ramp (validated ordinal) plus orange for papers that need attention.
export type Stand = 'signed_off' | 'prepared' | 'in_progress' | 'not_started' | 'attention';
export const STANDS: { key: Stand; label: string; colour: string }[] = [
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

export const STAGES = ['Import', 'Map', 'Prepare', 'Review', 'Sign'] as const;

/** A part-to-whole bar of papers by where they stand, 2px gaps between segments, hover shows the count. */
export function StandBar({ counts, total, height = 'h-2' }: { counts: Record<Stand, number>; total: number; height?: string }) {
  return (
    <span className={`flex gap-[2px] ${height} w-full rounded-full overflow-hidden bg-[#EEF2F9]`}>
      {STANDS.filter((s) => counts[s.key] > 0).map((s) => (
        <span key={s.key} title={`${s.label}: ${counts[s.key]} of ${total}`} style={{ width: `${(counts[s.key] / total) * 100}%`, background: s.colour }} />
      ))}
    </span>
  );
}

export const countStands = (papers: Workpaper[]) => {
  const counts = { signed_off: 0, prepared: 0, in_progress: 0, not_started: 0, attention: 0 } as Record<Stand, number>;
  for (const w of papers) counts[standOf(w)]++;
  return counts;
};

/** A client's latest year: its papers by where they stand, and the stage it has reached. */
export function clientProgress(client: Client) {
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
}

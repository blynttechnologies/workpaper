'use client';

import { Notice } from '@/components/ui/Notice';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { allWorkflowsOf, archiveWorkflow, canCustomise, deleteWorkflow, workflowProgress, workflowsOf } from '@/lib/workflows';
import { AddWorkflowDialog } from '@/components/workflow/AddWorkflowDialog';
import { ukDate } from '@/lib/dates';

const COLOURS = { signedOff: '#122654', prepared: '#FF7A66', inProgress: '#B9C3E6' };

/** One card per workflow on a client's years: a bar of how far its papers have got, and a legend of the counts. */
export function WorkflowCards({ engagementIds }: { engagementIds: string[] }) {
  const [adding, setAdding] = useState(false);
  const [, refresh] = useState(0);
  const firmId = db.engagements.find((e) => e.id === engagementIds[0])?.firm_id ?? db.firms[0]?.id ?? '';
  const cards = engagementIds.flatMap((id) => workflowsOf(id));
  const multiplePeriods = engagementIds.length > 1;
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState('');
  const actor = getActor();
  // Only managers and above can archive, delete or restore, so only they see those options
  const manager = canCustomise(actor.role);
  const archived = manager ? engagementIds.flatMap((id) => allWorkflowsOf(id)).filter((w) => w.archived_at) : [];

  const run = (fn: typeof archiveWorkflow, engagementId: string, workflowId: string) => {
    setError(fn(engagementId, workflowId, actor) ?? '');
    setConfirmDelete(null);
    refresh((n) => n + 1);
  };

  return (
    <section aria-labelledby="workflows-heading">
      <div className="flex items-center justify-between mb-3">
        <h2 id="workflows-heading" className="text-base font-bold text-[#122654]">Workflows</h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={engagementIds.length === 0}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#122654] bg-white border border-[#D3DCEE] rounded-lg hover:bg-[#EAF5FC] disabled:opacity-40 cursor-pointer"
        >
          <Plus className="w-3 h-3" aria-hidden="true" /> Add workflow
        </button>
      </div>

      {error && <Notice inline className="mb-3">{error}</Notice>}
      {/* Say why Archive and Delete are greyed out, and where the role is changed */}
      {!manager && cards.length > 0 && (
        <p id="workflow-role-hint" className="mb-3 text-[11px] text-[#6B4700]">
          Only a manager, partner or admin can archive or delete a workflow. A partner or admin can change your role under team roles in{' '}
          <Link href="/settings" className="underline font-semibold">Settings</Link>.
        </p>
      )}
      {cards.length === 0 && <p className="text-xs text-[#4A5878]">No workflows yet. Add one to start working on a client year.</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {cards.map((wf) => {
          const eng = db.engagements.find((e) => e.id === wf.engagement_id)!;
          const p = workflowProgress(wf.engagement_id, wf.refs);
          const pct = (n: number) => (p.total ? `${(n / p.total) * 100}%` : '0%');
          // "UK Working Papers - Partnership" shows as a small label over the name
          const [eyebrow, title] = wf.name.includes(' - ') ? [wf.name.slice(0, wf.name.indexOf(' - ')), wf.name.slice(wf.name.indexOf(' - ') + 3)] : ['', wf.name];
          return (
            <div
              key={`${wf.engagement_id}:${wf.id}`}
              className="relative flex flex-col p-5 bg-white border border-[#E3E7EF] rounded-2xl shadow-2xs hover:border-[#B9C6E2] transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {eyebrow && <div className="text-[10px] font-semibold tracking-wider uppercase text-[#4A5878]">{eyebrow}</div>}
                  <div className="text-sm font-bold text-[#122654] truncate mt-0.5">{title}</div>
                  {multiplePeriods && <div className="text-[11px] text-[#4A5878]">{ukDate(eng.period_start)} to {ukDate(eng.period_end)}</div>}
                </div>
                <div className="text-3xl font-extrabold text-[#122654] font-mono-numbers shrink-0">
                  {p.percent}<span className="text-base">%</span>
                </div>
              </div>

              <div className="mt-4 flex gap-0.5 h-2.5 rounded-full overflow-hidden bg-[#EAF0F8]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Working papers completed">
                <div style={{ width: pct(p.signedOff), background: COLOURS.signedOff }} />
                <div style={{ width: pct(p.prepared), background: COLOURS.prepared }} />
                <div style={{ width: pct(p.inProgress), background: COLOURS.inProgress }} />
              </div>

              <ul className="mt-4 grid grid-cols-3 gap-2">
                {([['signedOff', 'Signed off'], ['prepared', 'Prepared'], ['inProgress', 'In progress']] as const).map(([key, label]) => (
                  <li key={key}>
                    <div className="text-lg font-bold text-[#122654] font-mono-numbers">{p[key]}/{p.total}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#4A5878]">
                      <span className="w-2 h-2 rounded-full" style={{ background: COLOURS[key] }} aria-hidden="true" />
                      {label}
                    </div>
                  </li>
                ))}
              </ul>

              {confirmDelete === `${wf.engagement_id}:${wf.id}` ? (
                <div role="alertdialog" aria-label="Delete workflow" className="mt-4 p-3 rounded-xl border border-[#F0C2BA] bg-[#FFF8F6] text-xs text-[#122654] space-y-2">
                  <p>Delete <strong>{wf.name}</strong>? Its {p.total} working papers and their work stay, but the workflow cannot be brought back. Archive it if you may need it again.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => run(deleteWorkflow, wf.engagement_id, wf.id)} className="min-h-[36px] px-3 rounded-lg bg-[#B8432F] text-white font-bold cursor-pointer">Delete workflow</button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-[36px] px-3 rounded-lg border border-[#D3DCEE] bg-white font-semibold cursor-pointer">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-3">
                  <Link
                    href={`/engagements/${wf.engagement_id}/workflows/${wf.id}`}
                    aria-label={`Continue ${wf.name}, ${p.percent}% complete`}
                    // after: stretches the link over the whole card, so a click anywhere opens it
                    className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold transition-colors after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                  >
                    Continue working papers <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                  {/* relative z-10 keeps it above the card-wide link, like Archive and Delete */}
                  <Link href={`/engagements/${wf.engagement_id}/mapping`} aria-label={`Mapping for ${wf.name}`} className="relative z-10 text-xs font-semibold text-[#4A5878] hover:text-[#122654]">Mapping</Link>
                  {eng.status !== 'locked' && (
                    <>
                      <button type="button" disabled={!manager} onClick={() => run(archiveWorkflow, wf.engagement_id, wf.id)} aria-label={`Archive ${wf.name}`} aria-describedby={manager ? undefined : 'workflow-role-hint'} className="relative z-10 text-xs font-semibold text-[#4A5878] hover:text-[#122654] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#4A5878]">Archive</button>
                      <button type="button" disabled={!manager} onClick={() => setConfirmDelete(`${wf.engagement_id}:${wf.id}`)} aria-label={`Delete ${wf.name}`} aria-describedby={manager ? undefined : 'workflow-role-hint'} className="relative z-10 text-xs font-semibold text-[#4A5878] hover:text-[#B8432F] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[#4A5878]">Delete</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {archived.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} className="text-xs font-semibold text-[#4A5878] hover:text-[#122654] cursor-pointer">
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 border border-[#E3E7EF] rounded-xl divide-y divide-[#E3E7EF] bg-white">
              {archived.map((wf) => (
                <li key={wf.id}>
                  <Link href={`/engagements/${wf.engagement_id}/workflows/${wf.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-[#F5F8FD]">
                    <span className="font-semibold text-[#122654] truncate">{wf.name}</span>
                    <span className="text-[#4A5878] shrink-0">Archived {ukDate(wf.archived_at!)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {adding && <AddWorkflowDialog engagementIds={engagementIds} firmId={firmId} onClose={() => setAdding(false)} onAdded={() => refresh((n) => n + 1)} />}
    </section>
  );
}

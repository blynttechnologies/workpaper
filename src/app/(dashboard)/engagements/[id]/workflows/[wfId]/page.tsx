'use client';

import { Notice } from '@/components/ui/Notice';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Plus, X } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { addPaperToWorkflow, allWorkflowsOf, archiveWorkflow, canCustomise, deleteWorkflow, restoreWorkflow, workflowProgress } from '@/lib/workflows';
import { packFor, TEMPLATES, templateOf } from '@/lib/workpapers/templates';
import { evaluatePaper, levelsFor, paperStatus } from '@/lib/workpapers/engine';
import { CustomPaperDialog } from '@/components/workpaper/CustomPaperDialog';
import { STATUS_DEFINITIONS, UserRole, Workpaper } from '@/lib/types/models';
import { formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';

const button = 'px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer';
const outline = `${button} border-[#D3DCEE] text-[#122654] hover:bg-[#EAF5FC]`;

const SIGN_LEVELS: { role: string; letter: string; label: string; done: string; action: string; may: UserRole[] }[] = [
  { role: 'preparer', letter: 'P', label: 'Prepared', done: 'prepared', action: 'prepare', may: ['preparer', 'reviewer', 'manager', 'partner', 'admin'] },
  { role: 'reviewer', letter: 'M', label: 'Reviewed', done: 'reviewed', action: 'review', may: ['reviewer', 'manager', 'partner', 'admin'] },
  { role: 'partner', letter: 'Pt', label: 'Approved', done: 'approved', action: 'approve', may: ['partner', 'admin'] },
];

const MANDATORY = ['B-10', 'F-10', 'Z-10', 'Z-20'];
const signoffBy = (workpaperId: string, role: string) => db.signoffs.find((s) => s.workpaper_id === workpaperId && s.role === role && !s.stale_at);
const byRef = (a: { ref: string }, b: { ref: string }) => a.ref.localeCompare(b.ref, undefined, { numeric: true });

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [, setRev] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showAllPapers, setShowAllPapers] = useState(false);
  const [creatingPaper, setCreatingPaper] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signMessage, setSignMessage] = useState('');
  const [pendingNa, setPendingNa] = useState<Workpaper | null>(null);
  const [naReason, setNaReason] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const refresh = () => setRev((n) => n + 1);
  const engagementId = params?.id as string;
  const wf = allWorkflowsOf(engagementId).find((w) => w.id === params?.wfId);
  const eng = db.engagements.find((e) => e.id === engagementId);
  const client = db.clients.find((c) => c.id === eng?.client_id);
  const actor = getActor();
  const back = client ? `/clients/${client.id}` : '/';

  if (!wf || !eng) return <div className="p-6 text-sm text-[#4A5878]">Workflow not found.</div>;
  const p = workflowProgress(engagementId, wf.refs);
  const filePapers = db.workpapers.filter((w) => w.engagement_id === engagementId);
  const onWorkflow = filePapers.filter((w) => wf.refs.includes(w.ref));
  const papers = onWorkflow.filter((w) => w.applicable !== false);
  const notApplicable = onWorkflow.filter((w) => w.applicable === false).sort(byRef);
  // Grouped by area (A, B, C...), each group in reference order: C-10 before C-20 before D-10
  const groups = [...new Set(papers.map((w) => templateOf(w)?.area ?? '~'))]
    .sort()
    .map((area) => {
      const inArea = papers.filter((w) => (templateOf(w)?.area ?? '~') === area).sort(byRef);
      return { area, name: templateOf(inArea[0])?.areaName ?? 'Other', papers: inArea };
    });

  const canEdit = eng.status !== 'locked' && actor.role !== 'readonly' && !wf.archived_at;
  const levels = SIGN_LEVELS.slice(0, Math.max(0, ...papers.map(levelsFor)));
  const signActions = canEdit ? levels.filter((l) => l.may.includes(actor.role)) : [];
  const unreconciled = papers.filter((w) => evaluatePaper(w)?.totals.difference).length;
  const reviewedPct = papers.length ? Math.round((papers.filter((w) => signoffBy(w.id, 'reviewer')).length / papers.length) * 100) : 0;
  const unsigned = (role: string) => papers.filter((w) => !signoffBy(w.id, role));

  // Papers this workflow could take: suited to the client's type of business, or already in the year's file
  const suited = new Set(packFor(client?.company_type));
  const isSuited = (a: { ref: string }) => suited.has(a.ref) || filePapers.some((w) => w.ref === a.ref);
  const available = [
    ...TEMPLATES.filter((t) => !wf.refs.includes(t.ref)).map((t) => ({ ref: t.ref, title: t.title })),
    ...filePapers.filter((w) => w.custom_template && !wf.refs.includes(w.ref)).map((w) => ({ ref: w.ref, title: templateOf(w)?.title ?? w.ref })),
  ].sort(byRef);
  const offered = showAllPapers ? available : available.filter(isSuited);
  const hiddenCount = available.length - available.filter(isSuited).length;

  const run = (fn: typeof archiveWorkflow, then?: () => void) => {
    const res = fn(engagementId, wf.id, actor);
    if (res) return setError(res);
    setError('');
    then ? then() : refresh();
  };

  const addPaper = (ref: string) => {
    const res = addPaperToWorkflow(engagementId, wf.id, ref, actor);
    setError(res ?? '');
    refresh();
  };

  const signAll = async (role: string, action: string, done: string) => {
    setSigning(true);
    const failed: string[] = [];
    let count = 0;
    for (const w of unsigned(role)) {
      const res = await fetch(`/api/v1/workpapers/${encodeURIComponent(w.id)}/signoffs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) count++;
      else failed.push(`${w.ref}: ${(await res.json().catch(() => ({}))).error || `not ${done}`}`);
    }
    setSignMessage(`${count} ${done}.${failed.length ? ` Not ${done}: ${failed.join(' · ')}` : ''}`);
    setSigning(false);
  };

  const setApplicable = (w: Workpaper, applicable: boolean, reason: string) => {
    db.logAudit(eng.firm_id, actor, applicable ? 'TICK_APPLICABLE' : 'UNTICK_APPLICABLE', 'workpapers', w.id, { applicable: w.applicable !== false }, { applicable, reason });
    w.applicable = applicable;
    w.na_reason = applicable ? null : reason;
    w.updated_at = new Date().toISOString();
    refresh();
  };

  // The paper to do next: the first one not agreeing to the trial balance, else the first still in progress
  const ordered = groups.flatMap((g) => g.papers);
  const nextUnreconciled = ordered.find((w) => evaluatePaper(w)?.totals.difference);
  const nextInProgress = ordered.find((w) => !['signed_off', 'reconciled', 'prepared'].includes(paperStatus(w)));
  const next = nextUnreconciled ?? nextInProgress;
  const nextDifference = next ? evaluatePaper(next)?.totals.difference : undefined;
  const paperIds = new Set(filePapers.map((w) => w.id));
  const reviewWaiting = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open' && paperIds.has(c.workpaper_id)).length;
  const isDone = (w: Workpaper) => ['signed_off', 'reconciled', 'prepared'].includes(paperStatus(w));
  const tile = 'p-4 bg-white';

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 flex flex-col lg:flex-row gap-5 items-start">
      <div className="flex-1 min-w-0 w-full space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link href={back} className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D4E89] hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> {client?.name ?? 'Client'}
            </Link>
            <h1 className="text-xl font-bold text-[#122654] mt-1">{wf.name}</h1>
            <p className="text-sm text-[#4A5878]">
              {client?.company_type ?? client?.name} · {ukDate(eng.period_start)} to {ukDate(eng.period_end)}
            </p>
          </div>
          {canCustomise(actor.role) && eng.status !== 'locked' && (
            <div className="flex items-center gap-2">
              {wf.archived_at ? (
                <button type="button" onClick={() => run(restoreWorkflow)} className={outline}>Restore</button>
              ) : (
                <button type="button" onClick={() => run(archiveWorkflow, () => router.push(back))} className={outline}>Archive</button>
              )}
              <button type="button" onClick={() => setConfirming(true)} className={`${button} border-[#F0C2BA] text-[#B8432F] hover:bg-[#FFF1EE]`}>Delete</button>
            </div>
          )}
        </div>

        {wf.archived_at && <Notice tone="warn">Archived on {ukDate(wf.archived_at)}. It is hidden from the client page and menu until restored.</Notice>}
        {error && <Notice inline>{error}</Notice>}

        {confirming && (
          <div role="alertdialog" aria-label="Delete workflow" className="p-4 rounded-xl border border-[#F0C2BA] bg-[#FFF8F6] text-xs text-[#122654] space-y-3">
            <p>Delete <strong>{wf.name}</strong> from this year? The {papers.length} working papers and their work stay, but this workflow cannot be brought back. Archive it instead if you may need it again.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => run(deleteWorkflow, () => router.push(back))} className={`${button} bg-[#B8432F] border-[#B8432F] text-white`}>Delete workflow</button>
              <button type="button" onClick={() => setConfirming(false)} className={`${button} border-[#D3DCEE]`}>Cancel</button>
            </div>
          </div>
        )}

        {/* Sign-off totals and what does not agree yet */}
        <section aria-label="Progress" className="grid grid-cols-2 md:grid-cols-4 border border-[#E3E7EF] rounded-xl overflow-hidden divide-x divide-[#E3E7EF] bg-white">
          {SIGN_LEVELS.map((l, i) => {
            const n = papers.filter((w) => signoffBy(w.id, l.role)).length;
            const pct = papers.length ? (n / papers.length) * 100 : 0;
            const colour = ['text-[#0B6B52]', 'text-purple-700', 'text-[#0B6B52]'][i];
            const bar = ['bg-[#0B6B52]', 'bg-purple-600', 'bg-[#0B6B52]'][i];
            return (
              <div key={l.role} className={`${tile} ${i < levels.length ? '' : 'opacity-50'}`}>
                <div className="text-[10px] uppercase font-bold tracking-wider text-[#7E8DA6]">{l.label}</div>
                <div className="mt-1 font-mono">
                  <span className={`text-2xl font-bold ${colour}`}>{n}</span> <span className="text-xs text-[#7E8DA6]">of {papers.length}</span>
                </div>
                <div className="mt-2 h-1.5 bg-[#E3E7EF] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          <div className={`${tile} ${unreconciled ? 'bg-[#FFF4F2]' : ''}`}>
            <div className={`text-[10px] uppercase font-bold tracking-wider ${unreconciled ? 'text-[#B8432F]' : 'text-[#7E8DA6]'}`}>Unreconciled</div>
            <div className={`mt-1 text-2xl font-bold font-mono ${unreconciled ? 'text-[#B8432F]' : 'text-[#0B6B52]'}`}>{unreconciled}</div>
            <div className="text-xs text-[#7E8DA6]">{unreconciled === 1 ? 'schedule' : 'schedules'}</div>
          </div>
        </section>

        {/* Sign off in bulk, add papers */}
        {canEdit && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {signActions.map((l) => {
                const n = unsigned(l.role).length;
                return (
                  n > 0 && (
                    <button key={l.action} type="button" disabled={signing} onClick={() => signAll(l.role, l.action, l.done)} className="px-4 py-2.5 text-xs font-bold rounded-lg bg-[#122654] text-white cursor-pointer disabled:opacity-60">
                      {signing ? 'Signing…' : `Mark all ${l.done} (${n})`}
                    </button>
                  )
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)} className={`${outline} inline-flex items-center gap-1 bg-white py-2.5`}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add more papers
              </button>
              <button type="button" onClick={() => setCreatingPaper(true)} className={`${outline} inline-flex items-center gap-1 bg-white py-2.5`}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Custom paper
              </button>
            </div>
          </div>
        )}
        {signMessage && <Notice tone="info">{signMessage}</Notice>}

        {canEdit && showAdd && (
          <section aria-label="Add more papers" className="bg-white border border-[#E3E7EF] rounded-xl px-4 py-3">
            <h2 className="text-xs font-bold text-[#4A5878] pb-1.5">
              {showAllPapers || !client?.company_type ? 'Papers to add' : `Papers for a ${client.company_type}`} ({offered.length})
            </h2>
            {offered.length === 0 && <p className="text-xs text-[#4A5878] py-1">Every paper for this type of business is already on this workflow.</p>}
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
              {offered.map((t) => (
                <li key={t.ref} className="flex items-center gap-3 py-1.5 border-b border-[#E3E7EF] text-xs text-[#4A5878]">
                  <span className="font-mono font-bold w-10 shrink-0">{t.ref}</span>
                  <span className="flex-1 min-w-0">{t.title}</span>
                  <button type="button" onClick={() => addPaper(t.ref)} aria-label={`Add ${t.ref} ${t.title}`} className="inline-flex items-center gap-1 font-bold text-[#1D4E89] hover:underline cursor-pointer">
                    <Plus className="w-3 h-3" aria-hidden="true" /> Add
                  </button>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button type="button" onClick={() => setShowAllPapers((v) => !v)} className="mt-2 text-xs font-semibold text-[#1D4E89] hover:underline cursor-pointer">
                {showAllPapers ? 'Show only papers for this type of business' : `Show all standard papers (${hiddenCount} more)`}
              </button>
            )}
          </section>
        )}

        {groups.map((g) => {
          const isClosed = closed.has(g.area);
          const done = g.papers.filter(isDone).length;
          return (
            <section key={g.area} aria-labelledby={`area-${g.area}`} className="bg-white border border-[#E3E7EF] rounded-xl overflow-hidden">
              <h2 id={`area-${g.area}`} className="flex items-center gap-2 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#122654]">
                <button
                  type="button"
                  onClick={() => setClosed((s) => (s.has(g.area) ? new Set([...s].filter((a) => a !== g.area)) : new Set(s).add(g.area)))}
                  aria-expanded={!isClosed}
                  aria-label={`${isClosed ? 'Show' : 'Hide'} ${g.name}`}
                  className="text-[#4A5878] cursor-pointer"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${isClosed ? '-rotate-90' : ''}`} />
                </button>
                <span>{g.name}</span>
                <span className="font-normal normal-case tracking-normal text-[#7E8DA6]">
                  {g.papers.length} {g.papers.length === 1 ? 'paper' : 'papers'}
                </span>
                <span className="ml-auto font-mono normal-case tracking-normal text-[#4A5878]">
                  {done}/{g.papers.length} done
                </span>
              </h2>
              {!isClosed && (
                <ul className="divide-y divide-[#E3E7EF] border-t border-[#E3E7EF]">
                  {g.papers.map((w) => {
                    const state = paperStatus(w);
                    const status = STATUS_DEFINITIONS[state];
                    const title = templateOf(w)?.title ?? w.ref;
                    const difference = evaluatePaper(w)?.totals.difference;
                    const steps = SIGN_LEVELS.slice(0, levelsFor(w));
                    return (
                      <li key={w.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 py-3 hover:bg-[#F5F8FD]">
                        <input
                          type="checkbox"
                          aria-label={`Use ${w.ref} ${title} this year`}
                          title="Untick to mark not applicable"
                          checked
                          disabled={!canEdit}
                          onChange={() => {
                            setPendingNa(w);
                            setNaReason('');
                          }}
                          className="rounded border-gray-400 shrink-0 cursor-pointer"
                        />
                        <Link href={`/engagements/${engagementId}/workpapers/${w.id}`} className="flex flex-1 min-w-[60%] sm:min-w-0 items-start gap-3">
                          <span className="font-mono text-xs text-[#4A5878] w-10 shrink-0 pt-0.5">{w.ref}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-[#122654] truncate">{title}</span>
                            <span className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bgClass} ${status.colorClass}`}>{status.label}</span>
                              {!!difference && <span className="font-mono text-xs font-bold text-[#B8432F]">{formatPence(difference)}</span>}
                            </span>
                          </span>
                        </Link>
                        {/* Prepared, reviewed, approved: filled once signed, with who and when on hover */}
                        <ol className="flex items-start shrink-0" aria-label={`${w.ref} sign-off`}>
                          {steps.map((l, i) => {
                            const s = signoffBy(w.id, l.role);
                            return (
                              <li key={l.role} className="flex items-start">
                                {i > 0 && <span className={`mt-2.5 w-8 h-px ${s ? 'bg-[#0B6B52]' : 'bg-[#D3DCEE]'}`} aria-hidden="true" />}
                                <span className="flex flex-col items-center w-14" title={s ? `${l.label} by ${s.user_name}${s.signed_at ? ` on ${ukDate(s.signed_at.slice(0, 10))}` : ''}` : `${l.label}: pending`}>
                                  <span className={`w-5 h-5 rounded-full flex items-center justify-center ${s ? 'bg-[#0B6B52] text-white' : 'border-2 border-[#D3DCEE] bg-white'}`}>
                                    {s && <Check className="w-3 h-3" strokeWidth={3} />}
                                  </span>
                                  <span className="mt-1 text-[9px] text-[#7E8DA6]">{l.label}</span>
                                  <span className="sr-only">{s ? `by ${s.user_name}` : 'pending'}</span>
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {notApplicable.length > 0 && (
          <section aria-labelledby="area-na" className="bg-white border border-[#E3E7EF] rounded-xl">
            <h2 id="area-na" className="p-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#4A5878]">
              Not applicable ({notApplicable.length}) <span className="font-normal normal-case tracking-normal text-[#7E8DA6]">· tick to use again</span>
            </h2>
            <ul className="px-3 pb-2 divide-y divide-[#E3E7EF]">
              {notApplicable.map((w) => (
                <li key={w.id} className="py-2 flex items-center gap-3 text-xs text-[#4A5878]">
                  <input
                    type="checkbox"
                    aria-label={`Use ${w.ref} ${templateOf(w)?.title ?? w.ref} this year`}
                    checked={false}
                    disabled={!canEdit}
                    onChange={() => setApplicable(w, true, 'Ticked again on the workflow')}
                    className="rounded border-gray-400 shrink-0 cursor-pointer"
                  />
                  <span className="font-mono font-bold w-10 shrink-0">{w.ref}</span>
                  <span className="flex-1 min-w-0">
                    <span className="line-through">{templateOf(w)?.title ?? w.ref}</span>
                    {w.na_reason && <span className="ml-2 text-[11px]">{w.na_reason}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* What to do next, what is waiting, how far along */}
      <aside aria-label="Summary" className="w-full lg:w-72 shrink-0 space-y-4 lg:sticky lg:top-4">
        <div className="p-4 rounded-xl bg-[#122654] text-white">
          <div className="text-[10px] uppercase font-bold tracking-wider text-[#A6B4D0]">Next best action</div>
          {next ? (
            <>
              <p className="mt-1 text-sm font-bold">
                {nextUnreconciled ? 'Reconcile' : 'Finish'} {next.ref} {templateOf(next)?.title ?? next.ref}
              </p>
              {!!nextDifference && <p className="mt-1 font-mono text-sm text-[#FF7A66]">{formatPence(nextDifference)}</p>}
              <Link href={`/engagements/${engagementId}/workpapers/${next.id}`} className="mt-3 block text-center px-3 py-2.5 rounded-lg bg-[#FF7A66] hover:bg-[#ff9485] text-[#0B1A3B] text-xs font-bold">
                Open paper
              </Link>
            </>
          ) : (
            <p className="mt-1 text-sm font-bold">Every paper agrees and is done. Sign off what is left.</p>
          )}
        </div>
        <div className="p-4 rounded-xl bg-white border border-[#E3E7EF] text-xs text-[#122654]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Review queue</span>
            {reviewWaiting > 0 && <span className="text-[11px] font-mono font-bold px-1.5 rounded-full bg-[#FF7A66] text-[#0B1A3B]">{reviewWaiting}</span>}
          </div>
          <p className="mt-1 text-[#4A5878]">
            {reviewWaiting === 0 ? 'Nothing is waiting for review.' : reviewWaiting === 1 ? 'One item is waiting for your review.' : `${reviewWaiting} items are waiting for your review.`}
          </p>
          <Link href={`/engagements/${engagementId}/review`} className="mt-2 inline-block font-semibold text-[#1D4E89] underline">
            Go to Review →
          </Link>
        </div>
        <div className="p-4 rounded-xl bg-white border border-[#E3E7EF] text-xs text-[#122654]">
          <div className="text-sm font-bold">Overall</div>
          <div role="progressbar" aria-label="Workflow progress" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} className="mt-1 text-3xl font-bold">
            {p.percent}%
          </div>
          <p className="text-[#4A5878]">
            {p.signedOff + p.prepared} of {p.total} papers done · reviewed {reviewedPct}%
          </p>
        </div>
      </aside>
      {creatingPaper && (
        <CustomPaperDialog
          engagementId={engagementId}
          firmId={eng.firm_id}
          clientId={eng.client_id}
          onClose={() => setCreatingPaper(false)}
          onCreated={(ref) => {
            setCreatingPaper(false);
            addPaper(ref);
          }}
        />
      )}

      {pendingNa && (
        <div role="dialog" aria-modal="true" aria-label="Mark not applicable" className="fixed inset-0 z-50 bg-[#0B1A3B]/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 text-xs text-[#122654]">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" /> Mark not applicable</h3>
              <button type="button" onClick={() => setPendingNa(null)} aria-label="Close" className="text-[#4A5878] hover:text-[#122654] cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-[#4A5878]">You are removing <strong>{pendingNa.ref} {templateOf(pendingNa)?.title}</strong> from the applicable working papers.</p>
            {(MANDATORY.includes(pendingNa.ref) || evaluatePaper(pendingNa)?.leads.some((l) => l.final !== 0n)) && (
              <p className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800"><strong>Manager approval required:</strong> this paper has a balance or is mandatory.</p>
            )}
            <label className="block font-semibold">
              Reason
              <textarea rows={3} value={naReason} onChange={(e) => setNaReason(e.target.value)} placeholder="e.g. No transactions or commitments in this financial year" className="mt-1 w-full p-2.5 font-normal bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPendingNa(null)} className="min-h-[36px] px-3 font-bold cursor-pointer">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  setApplicable(pendingNa, false, naReason.trim() || 'Marked not applicable');
                  setPendingNa(null);
                }}
                className="min-h-[36px] px-4 bg-[#122654] hover:bg-[#0B1A3B] text-white font-bold rounded-lg cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

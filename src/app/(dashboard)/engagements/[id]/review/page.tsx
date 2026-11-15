'use client';

import { db } from '@/lib/server/db';
import { services } from '@/lib/server/services';
import { getActor } from '@/lib/session';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, CircleDashed, ExternalLink, Lock, MessageSquare, Search, Send, Unlock } from 'lucide-react';
import { useCompany } from '@/context/CompanyContext';
import { Avatar } from '@/components/ui/Avatar';
import { getReviewNotes, engagementSummary } from '@/lib/api';
import { ReviewNoteItem } from '@/lib/types';

type Filter = 'open' | 'waiting' | 'resolved' | 'all';
const FILTERS: [Filter, string][] = [
  ['open', 'Open'],
  ['waiting', 'Waiting on client'],
  ['resolved', 'Resolved'],
  ['all', 'All'],
];
const isOpen = (n: ReviewNoteItem) => n.status === 'Open' || n.status === 'open';
const isWaiting = (n: ReviewNoteItem) => n.status === 'Waiting on me' || n.status === 'Waiting on client';
const isResolved = (n: ReviewNoteItem) => n.status === 'Cleared' || n.status === 'Resolved' || n.status === 'resolved';
const matches = (f: Filter) => (n: ReviewNoteItem) => (f === 'open' ? isOpen(n) : f === 'waiting' ? isWaiting(n) : f === 'resolved' ? isResolved(n) : true);
// Only these roles may resolve a review note (services.resolveComment enforces it)
const CAN_RESOLVE = ['reviewer', 'manager', 'partner', 'admin'];
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A66] focus-visible:ring-offset-1';

const authorName = (author: unknown) => (typeof author === 'string' ? author : (author as { name?: string } | null)?.name) || 'Team member';

const STATE_PILL = (n: ReviewNoteItem) =>
  isResolved(n)
    ? { label: 'Resolved', cls: 'bg-[#E6F4EF] text-[#0B6B52]' }
    : isWaiting(n)
      ? { label: 'Waiting on client', cls: 'bg-[#FFF4DB] text-[#6B4700]' }
      : { label: 'Open', cls: 'bg-[#FFE3DE] text-[#A23A27]' };

export default function ReviewNotesHubPage() {
  const params = useParams();
  const engagementId = (params?.id as string) || 'eng_harlow_fy26';
  const { activeEngagement, refreshCompanyData } = useCompany();
  const actor = getActor();
  const eng = db.engagements.find((e) => e.id === engagementId);
  const firmId = eng?.firm_id ?? activeEngagement?.firm_id ?? 'firm_blynt_uk';
  const canResolve = CAN_RESOLVE.includes(actor.role);

  const [notes, setNotes] = useState<ReviewNoteItem[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [replyInput, setReplyInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mode, setMode] = useState<'points' | 'signoff'>('points');
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [showUnlockModal, setShowUnlockModal] = useState(false);

  const reload = () => getReviewNotes(engagementId).then(setNotes);
  useEffect(() => {
    getReviewNotes(engagementId).then(setNotes);
  }, [engagementId]);

  const openCount = notes.filter(isOpen).length;
  const resolvedCount = notes.filter(isResolved).length;
  const q = searchQuery.trim().toLowerCase();
  const filteredNotes = notes.filter(matches(filter)).filter((n) => !q || `${n.workpaperRef} ${n.workpaperTitle ?? n.workpaperName ?? ''} ${n.content ?? n.text ?? ''}`.toLowerCase().includes(q));
  const selectedNote = filteredNotes.find((n) => n.id === selectedNoteId) ?? filteredNotes[0];

  const handleSendReply = (resolveToo = false) => {
    if (!selectedNote) return;
    const c = db.comments.find((x) => x.id === selectedNote.id);
    if (!c) return;
    if (replyInput.trim()) {
      const r = { id: `rep_${Date.now()}`, comment_id: c.id, body: replyInput.trim(), mentions: [], created_by: actor.id, created_by_name: actor.name, created_at: new Date().toISOString() };
      c.replies = [...(c.replies ?? []), r];
      db.logAudit(firmId, actor, 'REPLY_COMMENT', 'comments', c.id, null, r);
      setReplyInput('');
    }
    if (resolveToo) return handleResolve();
    reload();
  };

  // Resolve, then move on to the next open point so a reviewer can work down the list
  const handleResolve = () => {
    if (!selectedNote) return;
    try {
      services.resolveComment(firmId, actor, selectedNote.id);
      setActionError(null);
      const nextOpen = filteredNotes.find((n) => n.id !== selectedNote.id && isOpen(n));
      if (nextOpen) setSelectedNoteId(nextOpen.id);
    } catch (err) {
      setActionError((err as Error)?.message || 'Could not resolve this note.');
    }
    reload();
  };

  // Sign-off checks, each worked out from the file itself; one with no data says so instead of passing
  const isLocked = (eng ?? activeEngagement)?.status === 'locked';
  const papers = db.workpapers.filter((w) => w.engagement_id === engagementId && w.applicable !== false);
  const unreconciled = papers.filter((w) => w.status === 'unreconciled');
  const suspense = papers.find((w) => w.ref === 'S-10');
  const checklist = db.checklist_items.filter((c) => c.engagement_id === engagementId);
  const unanswered = checklist.filter((c) => !c.confirmed_answer).length;
  type Check = { title: string; state: 'pass' | 'fail' | 'manual'; detail: string; href?: string; action?: string };
  const checks: Check[] = [
    { title: 'Review points cleared', state: openCount === 0 ? 'pass' : 'fail', detail: openCount === 0 ? 'Every review point is resolved.' : `${openCount} review point${openCount === 1 ? ' is' : 's are'} still open.`, ...(openCount ? { action: 'See points' } : {}) },
    {
      title: 'Disclosure checklist answered',
      state: checklist.length && !unanswered ? 'pass' : 'fail',
      detail: !checklist.length ? 'The checklist has not been started.' : unanswered ? `${unanswered} of ${checklist.length} questions still need an answer.` : `All ${checklist.length} questions answered.`,
      href: `/engagements/${engagementId}/disclosures`,
      action: 'Open checklist',
    },
    {
      title: 'Schedules agree to the trial balance',
      state: unreconciled.length ? 'fail' : 'pass',
      detail: unreconciled.length ? `${unreconciled.length} working paper${unreconciled.length === 1 ? ' does' : 's do'} not agree: ${unreconciled.map((w) => w.ref).join(', ')}.` : 'No working paper shows a difference to the trial balance.',
      href: `/engagements/${engagementId}/workpapers`,
      action: 'Open papers',
    },
    {
      title: 'Suspense and clearing accounts at zero',
      state: !suspense ? 'manual' : ['reconciled', 'prepared', 'signed_off'].includes(suspense.status) ? 'pass' : 'fail',
      detail: !suspense ? 'There is no suspense paper (S-10) in this file: check the accounts by hand.' : ['reconciled', 'prepared', 'signed_off'].includes(suspense.status) ? 'S-10 shows suspense and clearing accounts cleared.' : 'S-10 is not finished yet.',
      ...(suspense ? { href: `/engagements/${engagementId}/workpapers/${suspense.id}`, action: 'Open S-10' } : {}),
    },
    { title: 'Opening balances agree to last year', state: 'manual', detail: 'Run the opening check on the engagement page and confirm it agrees.', href: `/engagements/${engagementId}`, action: 'Opening check' },
  ];
  const passed = checks.filter((c) => c.state === 'pass').length;

  const handleApproveAndLock = () => {
    const target = eng ?? activeEngagement;
    if (openCount > 0) return setActionError('Resolve every review point before approving the file.');
    if (!target) return;
    target.status = 'locked';
    target.locked_at = new Date().toISOString();
    target.locked_by = actor.name;
    db.logAudit(target.firm_id, actor, 'APPROVE_FILE_AND_LOCK', 'engagements', target.id, { status: 'review' }, { status: 'locked', locked_at: target.locked_at });
    refreshCompanyData();
  };

  const handleUnlockEngagement = () => {
    const target = eng ?? activeEngagement;
    if (unlockReason.trim().length < 10) return setActionError('Give a reason of at least 10 characters to unlock.');
    if (!target) return;
    target.status = 'fieldwork';
    target.locked_at = null;
    target.locked_by = null;
    db.logAudit(target.firm_id, actor, 'UNLOCK_PERIOD', 'engagements', target.id, { status: 'locked' }, { status: 'fieldwork', reason: unlockReason });
    refreshCompanyData();
    setShowUnlockModal(false);
    setUnlockReason('');
  };

  return (
    <div className="flex flex-col gap-5 max-w-7xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-[#4A5878]">
            <Link href={`/engagements/${engagementId}`} className={`hover:text-[#122654] hover:underline ${focus}`}>{engagementSummary(engagementId).clientName}</Link>
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#122654]">Review</h1>
          <p className="text-sm text-[#4A5878] mt-0.5">
            {notes.length === 0 ? 'No review points raised yet.' : openCount === 0 ? 'Every review point is resolved. The file can go to sign-off.' : `${openCount} open point${openCount === 1 ? '' : 's'} to clear before sign-off.`}
          </p>
        </div>
        {notes.length > 0 && (
          <div className="min-w-[220px]">
            <p className="text-xs text-[#4A5878] mb-1 text-right">
              <strong className="text-[#122654]">{resolvedCount}</strong> of {notes.length} points resolved
            </p>
            <div className="h-2 rounded-full bg-[#EEF2F9] overflow-hidden" role="progressbar" aria-label="Review points resolved" aria-valuemin={0} aria-valuemax={notes.length} aria-valuenow={resolvedCount}>
              <div className="h-full bg-[#0B6B52] transition-all" style={{ width: `${(resolvedCount / notes.length) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Two jobs on this page */}
      <div role="tablist" aria-label="Review" className="flex gap-1 border-b border-[#E3E7EF]">
        {(
          [
            ['points', `Review points${openCount ? ` (${openCount} open)` : ''}`],
            ['signoff', `Sign-off and lock · ${passed}/${checks.length} checks`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${focus} ${mode === k ? 'border-[#FF7A66] text-[#122654]' : 'border-transparent text-[#4A5878] hover:text-[#122654]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {actionError && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-lg text-sm border bg-[#FFF1EE] border-[#FF7A66]/40 text-[#A23A27]">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {actionError}
        </div>
      )}

      {/* Sign-off and lock */}
      {mode === 'signoff' && (
        <section aria-label="Sign-off checks" className="bg-white border border-[#E3E7EF] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#122654]">Before the partner signs off</h2>
              <p className="text-sm text-[#4A5878]">Each check is worked out from this file. Checks marked “by hand” need a person to confirm them.</p>
            </div>
            {isLocked ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#6B4700] bg-[#FFF4DB] px-3 py-1.5 rounded-lg">
                  <Lock className="w-4 h-4" aria-hidden="true" /> Approved and locked
                </span>
                <button type="button" onClick={() => setShowUnlockModal(true)} className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 border border-[#B8432F] text-[#B8432F] text-sm font-bold rounded-lg cursor-pointer hover:bg-[#FFF1EE] ${focus}`}>
                  <Unlock className="w-4 h-4" aria-hidden="true" /> Unlock
                </button>
              </div>
            ) : (
              <div className="text-right">
                <button
                  type="button"
                  disabled={openCount > 0}
                  onClick={handleApproveAndLock}
                  aria-describedby="lock-hint"
                  className={`inline-flex items-center gap-2 min-h-[40px] px-4 bg-[#0B6B52] hover:bg-[#095742] text-white text-sm font-bold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${focus}`}
                >
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Approve file and lock the year
                </button>
                <p id="lock-hint" className="text-xs text-[#4A5878] mt-1">{openCount > 0 ? 'Resolve every review point first.' : 'Locking stops further changes to this year.'}</p>
              </div>
            )}
          </div>

          <ol className="space-y-2">
            {checks.map((c, i) => (
              <li key={c.title} className={`flex flex-wrap items-center gap-3 p-3.5 rounded-xl border ${c.state === 'pass' ? 'border-[#0B6B52]/20 bg-[#F3FAF7]' : c.state === 'fail' ? 'border-[#FF7A66]/40 bg-[#FFF8F6]' : 'border-[#E3E7EF] bg-[#F5F8FD]'}`}>
                <span aria-hidden="true">
                  {c.state === 'pass' ? <CheckCircle2 className="w-5 h-5 text-[#0B6B52]" /> : c.state === 'fail' ? <AlertCircle className="w-5 h-5 text-[#B8432F]" /> : <CircleDashed className="w-5 h-5 text-[#4A5878]" />}
                </span>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-bold text-[#122654]">
                    {i + 1}. {c.title}
                  </p>
                  <p className="text-xs text-[#4A5878]">{c.detail}</p>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.state === 'pass' ? 'bg-[#E6F4EF] text-[#0B6B52]' : c.state === 'fail' ? 'bg-[#FFE3DE] text-[#A23A27]' : 'bg-[#EEF2F9] text-[#4A5878]'}`}>
                  {c.state === 'pass' ? 'Passed' : c.state === 'fail' ? 'Not yet' : 'By hand'}
                </span>
                {c.action &&
                  (c.href ? (
                    <Link href={c.href} className={`inline-flex items-center gap-1 text-xs font-bold text-[#122654] hover:underline ${focus}`}>
                      {c.action} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                    </Link>
                  ) : (
                    <button type="button" onClick={() => setMode('points')} className={`inline-flex items-center gap-1 text-xs font-bold text-[#122654] hover:underline cursor-pointer ${focus}`}>
                      {c.action} <ArrowRight className="w-3 h-3" aria-hidden="true" />
                    </button>
                  ))}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Review points */}
      {mode === 'points' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* The list */}
          <section aria-label="Review points" className="lg:col-span-5 bg-white border border-[#E3E7EF] rounded-xl overflow-hidden">
            <div className="p-3 border-b border-[#E3E7EF] space-y-2.5">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
                {FILTERS.map(([k, label]) => {
                  const n = notes.filter(matches(k)).length;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={filter === k}
                      onClick={() => setFilter(k)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold cursor-pointer ${focus} ${filter === k ? 'bg-[#122654] border-[#122654] text-white' : 'bg-white border-[#D3DCEE] text-[#4A5878] hover:border-[#122654]'}`}
                    >
                      {label} <span className={filter === k ? 'text-white/75' : 'text-[#7E8DA6]'}>{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-[#7E8DA6] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                <input
                  aria-label="Search review points"
                  type="text"
                  placeholder="Search by paper or words"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full min-h-[38px] pl-9 pr-3 text-sm bg-[#F5F8FD] border border-[#D3DCEE] rounded-lg text-[#122654] placeholder:text-[#7E8DA6] ${focus}`}
                />
              </div>
            </div>

            <ul className="divide-y divide-[#EEF2F9] max-h-[620px] overflow-y-auto">
              {filteredNotes.length === 0 ? (
                <li className="p-8 text-center text-sm text-[#4A5878]">
                  {filter === 'open' && !q ? (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-[#0B6B52] mx-auto mb-2" aria-hidden="true" /> Nothing open. Every point is resolved.
                    </>
                  ) : (
                    'No review points match.'
                  )}
                </li>
              ) : (
                filteredNotes.map((note) => {
                  const on = note.id === selectedNote?.id;
                  const pill = STATE_PILL(note);
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => setSelectedNoteId(note.id)}
                        className={`w-full text-left px-4 py-3 flex flex-col gap-1 border-l-4 cursor-pointer ${focus} ${on ? 'bg-[#FFF6F4] border-l-[#FF7A66]' : 'border-l-transparent hover:bg-[#F5F8FD]'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#122654] bg-[#EEF2F9] px-1.5 py-0.5 rounded">{note.workpaperRef}</span>
                          <span className="flex-1 min-w-0 truncate text-sm font-semibold text-[#122654]">{note.workpaperTitle || note.workpaperName}</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${pill.cls}`}>{pill.label}</span>
                        </span>
                        <span className="text-sm text-[#4A5878] line-clamp-2">{note.content || note.text}</span>
                        <span className="flex items-center gap-2 text-xs text-[#7E8DA6]">
                          <span>{authorName(note.author)}</span>·<span>{note.createdAt}</span>
                          {(note.replies?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 ml-auto">
                              <MessageSquare className="w-3 h-3" aria-hidden="true" /> {note.replies!.length}
                              <span className="sr-only"> replies</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>

          {/* The conversation */}
          {selectedNote ? (
            <section aria-label={`Review point on ${selectedNote.workpaperRef}`} className="lg:col-span-7 bg-white border border-[#E3E7EF] rounded-xl flex flex-col">
              <div className="flex flex-wrap items-start justify-between gap-3 p-5 border-b border-[#E3E7EF]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-[#122654] bg-[#EEF2F9] px-2 py-0.5 rounded">{selectedNote.workpaperRef}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATE_PILL(selectedNote).cls}`}>{STATE_PILL(selectedNote).label}</span>
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-[#122654]">{selectedNote.workpaperTitle || selectedNote.workpaperName}</h2>
                  {selectedNote.cellRef && <p className="text-xs text-[#4A5878] mt-0.5">On: {selectedNote.cellRef}</p>}
                </div>
                <Link href={`/engagements/${engagementId}/workpapers/${selectedNote.workpaperId}`} className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 text-sm font-semibold text-[#122654] border border-[#D3DCEE] hover:border-[#122654] rounded-lg ${focus}`}>
                  Open working paper <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </div>

              {/* Point and replies, as a conversation */}
              <ol className="p-5 space-y-4" aria-label="Conversation">
                {[{ id: selectedNote.id, author: selectedNote.author, createdAt: selectedNote.createdAt, content: selectedNote.content || selectedNote.text, first: true }, ...(selectedNote.replies ?? []).map((r) => ({ id: r.id, author: r.author, createdAt: r.createdAt, content: r.content || r.text, first: false }))].map((m) => (
                  <li key={m.id} className="flex gap-3">
                    <Avatar name={authorName(m.author)} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#4A5878]">
                        <strong className="text-[#122654]">{authorName(m.author)}</strong> {m.first ? 'raised this point' : 'replied'} · {m.createdAt}
                      </p>
                      <p className={`mt-1 text-sm text-[#122654] leading-relaxed rounded-xl px-3.5 py-2.5 ${m.first ? 'bg-[#F5F8FD] border border-[#E3E7EF]' : 'bg-[#EEF2F9]'}`}>{m.content}</p>
                    </div>
                  </li>
                ))}
                {(selectedNote.replies?.length ?? 0) === 0 && <li className="text-xs text-[#7E8DA6] pl-11">No replies yet.</li>}
              </ol>

              {/* Reply */}
              {!isResolved(selectedNote) ? (
                <div className="p-5 pt-0 space-y-2.5">
                  <label htmlFor="review-reply-input" className="block text-sm font-semibold text-[#122654]">Your reply</label>
                  <textarea
                    id="review-reply-input"
                    rows={3}
                    value={replyInput}
                    onChange={(e) => setReplyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendReply();
                    }}
                    placeholder="Explain what you did, point to the evidence, or ask a question"
                    className={`w-full p-3 text-sm border border-[#D3DCEE] rounded-lg bg-white text-[#122654] ${focus}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => handleSendReply()} disabled={!replyInput.trim()} className={`inline-flex items-center gap-1.5 min-h-[38px] px-4 bg-[#122654] hover:bg-[#0B1A3B] text-white text-sm font-semibold rounded-lg cursor-pointer disabled:opacity-50 ${focus}`}>
                      <Send className="w-4 h-4" aria-hidden="true" /> Reply
                    </button>
                    {canResolve ? (
                      <>
                        <button type="button" onClick={() => handleSendReply(true)} className={`inline-flex items-center gap-1.5 min-h-[38px] px-4 bg-[#0B6B52] hover:bg-[#095742] text-white text-sm font-semibold rounded-lg cursor-pointer ${focus}`}>
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {replyInput.trim() ? 'Reply and resolve' : 'Resolve'}
                        </button>
                      </>
                    ) : (
                      <p className="text-xs text-[#4A5878]">A reviewer resolves the point once you have replied.</p>
                    )}
                    <span className="ml-auto text-xs text-[#7E8DA6] hidden sm:inline">Ctrl + Enter to send</span>
                  </div>
                </div>
              ) : (
                <p className="mx-5 mb-5 p-3 rounded-lg bg-[#E6F4EF] text-sm font-semibold text-[#0B6B52] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Resolved. This point no longer blocks sign-off.
                </p>
              )}
            </section>
          ) : (
            <div className="lg:col-span-7 bg-white border border-dashed border-[#D3DCEE] rounded-xl p-10 text-center text-sm text-[#4A5878]">
              Choose a review point to read and reply.
            </div>
          )}
        </div>
      )}

      {showUnlockModal && (
        <div className="fixed inset-0 z-50 bg-[#0B1A3B]/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl border border-[#E3E7EF]">
            <h3 id="unlock-title" className="text-lg font-bold text-[#122654] mb-1">Unlock the year</h3>
            <p className="text-sm text-[#4A5878] mb-3">Unlocking clears the approval and lets people change the file again. Say why; it is kept in the history.</p>
            <label htmlFor="unlock-reason" className="block text-sm font-semibold text-[#122654] mb-1">Reason (at least 10 characters)</label>
            <textarea id="unlock-reason" value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} rows={3} className={`w-full text-sm p-2.5 border border-[#D3DCEE] rounded-lg mb-4 ${focus}`} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowUnlockModal(false)} className={`min-h-[38px] px-3 text-sm font-semibold text-[#4A5878] cursor-pointer ${focus}`}>Cancel</button>
              <button type="button" onClick={handleUnlockEngagement} className={`min-h-[38px] px-4 bg-[#B8432F] text-white text-sm font-bold rounded-lg cursor-pointer ${focus}`}>Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

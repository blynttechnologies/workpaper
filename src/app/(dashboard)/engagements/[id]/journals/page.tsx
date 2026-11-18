'use client';

import { ask } from '@/components/ui/ask';
import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { AlertCircle, Calendar, Check, CheckCheck, ChevronDown, ChevronRight, Clock, ExternalLink, FileText, MoreHorizontal, Paperclip, Plus, RotateCcw, Search, Send, Trash2, Undo2, X } from 'lucide-react';
import { db } from '@/lib/server/db';
import { formatPence, toPence } from '@/lib/money';
import { TEMPLATES } from '@/lib/workpapers/templates';
import { inLead } from '@/lib/workpapers/common';
import { getActor } from '@/lib/session';
import { Adjustment } from '@/lib/types/models';
import { registerTotals } from '@/lib/workpapers/engine';
import { ukDate } from '@/lib/dates';
import { PreviewModal } from '@/components/workpaper/parts';
import type { Attachment } from '@/lib/types/models';

/**
 * Journals (JNL-01, JNL-02, JNL-04): the register of every journal, its effect on profit and net
 * assets, approval in bulk, reversal, and new journals with evidence. All changes go through the
 * server, which checks balancing, the period, roles and the activity log.
 */

const TYPES: [NonNullable<Adjustment['type']>, string][] = [
  ['adjusting', 'Adjusting'],
  ['reclassification', 'Reclassification'],
  ['client_posted', 'Client-posted'],
  ['proposed_by_ai', 'Proposed by AI'],
];
const STATUS_LABEL: Record<Adjustment['status'], string> = {
  proposed: 'Draft',
  accepted: 'Accepted',
  approved: 'Approved',
  posted: 'Posted',
  reversed: 'Reversed',
  rejected: 'Rejected',
  in_ledger: 'In Xero',
};
const STATUS_STYLE: Record<Adjustment['status'], string> = {
  proposed: 'bg-[#FFF4DB] text-[#6B4700]',
  accepted: 'bg-[#E6F4EF] text-[#0B6B52]',
  approved: 'bg-[#E6F4EF] text-[#0B6B52]',
  posted: 'bg-[#E6F4EF] text-[#0B6B52]',
  reversed: 'bg-[#EAF5FC] text-[#1D4E89]',
  rejected: 'bg-[#F5F8FD] text-[#4A5878]',
  in_ledger: 'bg-[#0B6B52] text-white',
};
const TABS: ['all' | Adjustment['status'], string][] = [
  ['all', 'All'],
  ['proposed', 'Drafts'],
  ['accepted', 'Accepted'],
  ['approved', 'Approved'],
  ['posted', 'Posted'],
  ['in_ledger', 'In Xero'],
  ['reversed', 'Reversed'],
  ['rejected', 'Rejected'],
];
const REVIEWER_UP = ['reviewer', 'manager', 'partner', 'admin'];

interface Line {
  blynt_code: string;
  debit: string;
  credit: string;
  narrative: string;
}
const blankLine = (): Line => ({ blynt_code: '', debit: '', credit: '', narrative: '' });
const pence = (s: string) => {
  try {
    return s.trim() ? toPence(s) : 0n;
  } catch {
    return 0n;
  }
};
const total = (j: Adjustment) => j.lines.reduce((a, l) => a + BigInt(l.debit_p), 0n);
const dateOf = (j: Adjustment) => j.date ?? j.created_at.slice(0, 10);

/** The schedules whose lead codes a journal touches, e.g. "K-20, P-10". */
const schedulesTouched = (codes: string[]) =>
  TEMPLATES.filter((t) => t.leads.some((l) => codes.some((c) => inLead(c, l.code)))).map((t) => t.ref);

const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', csv: 'text/csv', txt: 'text/plain' };
/** Journal evidence as a file the shared preview can show. */
const evidenceFile = (e: { file_key: string; filename: string }) =>
  ({ id: e.file_key, engagement_id: '', workpaper_id: null, file_key: e.file_key, filename: e.filename, mime: MIME[e.filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream', size: 0, sha256: '', category: 'Other', is_permanent: false }) as Attachment;

export default function JournalsPage() {
  const params = useParams();
  const search = useSearchParams();
  const engagementId = params?.id as string;
  const engagement = db.engagements.find((e) => e.id === engagementId);
  const actor = getActor();
  const canApprove = REVIEWER_UP.includes(actor.role);
  // Sole practitioners: the practice may let a partner or admin approve their own journal, with a reason
  const firmId = db.memberships.find((m) => m.user_id === actor.id)?.firm_id;
  const canSelfApprove = !!db.firms.find((f) => f.id === firmId)?.settings?.defaults?.self_approve_journals && ['partner', 'admin'].includes(actor.role);
  const selfApprove = async (j: Adjustment) => {
    const reason = await ask.text({ title: `Approve your own journal ${j.ref}?`, text: 'Say why you are approving it yourself. The reason is kept on the journal and in the activity log.', label: 'Reason (at least 10 characters)', action: 'Approve', minLength: 10 });
    if (reason) act(j, 'approve', reason);
  };

  const [rev, setRev] = useState(0);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [tab, setTab] = useState<'all' | Adjustment['status']>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // A schedule's "Propose journal" link opens the form for a proposal from that schedule
  const [form, setForm] = useState<null | { source?: string }>(() => (search.get('propose') ? { source: search.get('propose')! } : null));
  const [sending, setSending] = useState<Adjustment | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [day, setDay] = useState('');
  // The row "…" menu, placed fixed at its button so the table's scroll box doesn't clip it
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const accounts = db.accountsFor(engagementId);

  const journals = useMemo(
    () => db.adjustments.filter((a) => a.engagement_id === engagementId).sort((a, b) => a.ref.localeCompare(b.ref)),
    [engagementId, rev] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const q = query.trim().toLowerCase();
  const shown = journals.filter(
    (j) => (tab === 'all' || j.status === tab) && (!day || dateOf(j) === day) && (!q || `${j.ref} ${j.narrative} ${j.source_schedule ?? ''}`.toLowerCase().includes(q))
  );
  const dates = [...new Set(journals.map(dateOf))].sort();
  const totals = useMemo(() => {
    const t = registerTotals(engagementId);
    return { profit: t.profit_p, netAssets: t.net_assets_p };
  }, [engagementId, journals]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'That didn’t work. Try again.');
    return out;
  };

  const act = async (j: Adjustment, action: string, reason?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await call(`/api/v1/adjustments/${encodeURIComponent(j.id)}`, 'POST', { action, reason });
      setNotice({ ok: true, text: `${j.ref} ${action === 'approve' ? 'approved' : action === 'reverse' ? 'reversed' : action === 'accept' ? 'accepted: the trial balance and schedules are updated' : 'rejected'}.` });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setRev((r) => r + 1);
    }
  };

  const remove = async (j: Adjustment) => {
    if (!(await ask.confirm({ title: `Delete ${j.ref}?`, text: 'The deletion is recorded in the activity log.', action: 'Delete', danger: true }))) return;
    setBusy(true);
    try {
      await call(`/api/v1/adjustments/${encodeURIComponent(j.id)}`, 'DELETE');
      setNotice({ ok: true, text: `${j.ref} deleted.` });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setRev((r) => r + 1);
    }
  };

  const approveSelected = async () => {
    setBusy(true);
    const failed: string[] = [];
    for (const id of selected) {
      const j = journals.find((x) => x.id === id);
      if (!j) continue;
      try {
        await call(`/api/v1/adjustments/${encodeURIComponent(id)}`, 'POST', { action: 'approve' });
      } catch (e) {
        failed.push(`${j.ref}: ${(e as Error).message}`);
      }
    }
    setSelected(new Set());
    setNotice(failed.length ? { ok: false, text: `Some journals were not approved. ${failed.join(' ')}` } : { ok: true, text: 'Selected journals approved.' });
    setBusy(false);
    setRev((r) => r + 1);
  };

  const reverse = async (j: Adjustment) => {
    if (await ask.confirm({ title: `Reverse ${j.ref}?`, text: `A new journal with the opposite entries cancels it out. ${j.ref} stays on record.`, action: 'Reverse' })) act(j, 'reverse');
  };

  const reject = async (j: Adjustment) => {
    const reason = await ask.text({ title: `Reject ${j.ref}?`, text: 'Say why. The reason helps improve future proposals.', label: 'Reason', action: 'Reject', danger: true });
    if (reason) act(j, 'reject', reason);
  };

  if (!engagement) return <p className="text-sm text-[#4A5878]">Engagement not found.</p>;
  const locked = engagement.status === 'locked';
  const count = (k: 'all' | Adjustment['status']) => (k === 'all' ? journals.length : journals.filter((j) => j.status === k).length);
  const drafts = count('proposed');
  const toApprove = count('accepted');
  // The select column only shows when there is something this user can bulk-approve
  const anySelectable = canApprove && journals.some((j) => (j.status === 'proposed' || j.status === 'accepted') && j.proposed_by !== actor.id);

  /** What this user can do to a journal: the first "main" one is the row's button, the rest go in its "…" menu. */
  const actionsFor = (j: Adjustment) => {
    if (locked) return [];
    const waiting = j.status === 'proposed' || j.status === 'accepted';
    const done = j.status === 'approved' || j.status === 'posted';
    return [
      canApprove && waiting && j.proposed_by !== actor.id && { label: 'Approve', icon: Check, run: () => act(j, 'approve'), main: true },
      canSelfApprove && waiting && j.proposed_by === actor.id && { label: 'Approve my own…', icon: Check, run: () => selfApprove(j), main: true, title: 'You proposed this journal. Approving it yourself needs a reason.' },
      canApprove && done && (!j.ledger || ['DELETED', 'VOIDED'].includes(j.ledger.status)) && { label: 'Send to Xero', icon: Send, run: () => setSending(j), main: true },
      j.status === 'proposed' && { label: 'Accept', icon: CheckCheck, run: () => act(j, 'accept'), main: true },
      j.status === 'proposed' && { label: 'Reject', icon: X, run: () => reject(j) },
      done && { label: 'Reverse', icon: RotateCcw, run: () => reverse(j), title: 'Cancel this journal with an opposite entry' },
      ['proposed', 'accepted', 'rejected'].includes(j.status) && { label: 'Delete', icon: Trash2, run: () => remove(j), danger: true },
    ].filter((a) => !!a) as { label: string; icon: typeof Check; run: () => void; main?: boolean; danger?: boolean; title?: string }[];
  };
  const menuJournal = menu && journals.find((j) => j.id === menu.id);
  const menuItems = menuJournal ? actionsFor(menuJournal).filter((a, i) => !(i === 0 && a.main)) : [];

  const cards = [
    { label: 'Drafts', value: drafts, icon: FileText, tone: 'bg-[#FFF4DB] text-[#8A5A00]' },
    { label: 'To approve', value: toApprove, icon: Clock, tone: 'bg-[#FDECEA] text-[#B8432F]' },
    { label: 'Approved', value: count('approved') + count('posted') + count('in_ledger'), icon: Check, tone: 'bg-[#E6F4EF] text-[#0B6B52]' },
    { label: 'Reversed', value: count('reversed'), icon: Undo2, tone: 'bg-[#EAF5FC] text-[#1D4E89]' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PreviewModal file={preview} onClose={() => setPreview(null)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#122654]">Journals</h1>
          <p className="text-xs text-[#4A5878] mt-0.5">Create, review and approve journal adjustments.</p>
          <p className="text-[11px] text-[#4A5878] mt-0.5">
            Effect on profit <span className={`font-mono font-semibold ${totals.profit < 0n ? 'text-[#B8432F]' : 'text-[#122654]'}`}>{formatPence(totals.profit)}</span>
            {' · '}net assets <span className={`font-mono font-semibold ${totals.netAssets < 0n ? 'text-[#B8432F]' : 'text-[#122654]'}`}>{formatPence(totals.netAssets)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {canApprove && selected.size > 0 && (
            <button type="button" disabled={busy} onClick={approveSelected} className="inline-flex items-center gap-1.5 min-h-[36px] px-4 bg-[#0B6B52] text-white text-xs font-bold rounded-[8px] cursor-pointer disabled:opacity-60">
              <Check className="w-3.5 h-3.5" /> Approve selected ({selected.size})
            </button>
          )}
          {!locked && (
            <button type="button" onClick={() => setForm({})} className="inline-flex items-center gap-1.5 min-h-[36px] px-4 bg-[#122654] text-white text-xs font-bold rounded-[8px] cursor-pointer hover:bg-[#1D4E89]">
              <Plus className="w-3.5 h-3.5" /> New journal
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="flex items-center gap-3 bg-white border border-[#E3E7EF] rounded-[12px] p-3">
            <span className={`flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0 ${c.tone}`}>
              <c.icon className="w-4 h-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-[#122654]">{c.label}</p>
              <p className="text-lg font-bold text-[#122654] leading-tight">{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`p-3 rounded-[10px] text-xs font-medium flex items-start gap-2 ${notice.ok ? 'bg-[#E6F4EF] text-[#0B6B52]' : 'bg-[#FFF4DB] text-[#6B4700]'}`}>
          {!notice.ok && <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />} {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2 mr-auto" role="tablist" aria-label="Status">
          {/* Only statuses that have journals, so the filter isn't a row of zeros */}
          {TABS.filter(([k]) => k === 'all' || k === tab || count(k) > 0).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-1 text-xs font-semibold rounded-full cursor-pointer ${tab === k ? 'bg-[#122654] text-white' : 'bg-white border border-[#D3DCEE] text-[#122654] hover:border-[#1D4E89]/40'}`}>
              {label} ({count(k)})
            </button>
          ))}
        </div>
        <label className="relative flex-1 min-w-[200px] max-w-sm">
          <span className="sr-only">Search journals</span>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#4A5878]" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search journals…" className="w-full min-h-[32px] pl-8 pr-3 text-xs bg-white border border-[#D3DCEE] rounded-[8px] text-[#122654] placeholder:text-[#4A5878]" />
        </label>
        <label className="relative">
          <span className="sr-only">Date</span>
          <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#4A5878]" />
          <select value={day} onChange={(e) => setDay(e.target.value)} className="min-h-[32px] pl-8 pr-3 text-xs bg-white border border-[#D3DCEE] rounded-[8px] text-[#122654] cursor-pointer">
            <option value="">All dates</option>
            {dates.map((d) => (
              <option key={d} value={d}>{ukDate(d)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-white border border-[#E3E7EF] rounded-[12px] overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F5F8FD] text-[11px] font-semibold text-[#4A5878]">
            <tr>
              {anySelectable && <th className="py-2 px-3 w-8"><span className="sr-only">Select</span></th>}
              <th className="py-2 px-4">Ref</th>
              <th className="py-2 px-3">Date</th>
              <th className="py-2 px-3">Description</th>
              <th className="py-2 px-3 text-right">Amount</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF] text-[#122654]">
            {!shown.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[#4A5878]">
                  {journals.length ? 'No journals match.' : locked ? 'No journals in this file.' : 'No journals yet. Use New journal to add an adjustment.'}
                </td>
              </tr>
            )}
            {shown.map((j) => {
              const approvable = canApprove && (j.status === 'proposed' || j.status === 'accepted') && j.proposed_by !== actor.id;
              const ownWaiting = (j.status === 'proposed' || j.status === 'accepted') && j.proposed_by === actor.id;
              const actions = actionsFor(j);
              const primary = actions[0]?.main ? actions[0] : null;
              const more = actions.length - (primary ? 1 : 0);
              const open = openId === j.id;
              return (
                <Fragment key={j.id}>
                <tr className={`align-top ${open ? '' : 'hover:bg-[#FAFBFD]'}`}>
                  {anySelectable && <td className="py-2.5 px-3">
                    {approvable && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${j.ref}`}
                        checked={selected.has(j.id)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(j.id)) next.delete(j.id);
                          else next.add(j.id);
                          setSelected(next);
                        }}
                      />
                    )}
                  </td>}
                  <td className="py-2.5 px-4">
                    <button type="button" onClick={() => setOpenId(open ? null : j.id)} aria-expanded={open} title={open ? 'Hide the entries' : 'Show the debits and credits'} className="inline-flex items-center gap-1.5 font-bold whitespace-nowrap cursor-pointer hover:text-[#1D4E89]">
                      {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} {j.ref}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{ukDate(dateOf(j))}</td>
                  <td className="py-2.5 px-3 max-w-[420px] break-words">
                    <span className="block line-clamp-2 font-medium" title={j.narrative}>{j.narrative}</span>
                    {/* One short line here; the calculation and the reasons are in the opened row */}
                    <span className="block text-[11px] text-[#4A5878] mt-0.5">
                      {[j.source_schedule && `From ${j.source_schedule}`, j.reject_reason && 'Rejected', j.self_approval_reason && 'Self-approved', j.auto_reverse && 'Auto-reverses', ownWaiting && !canSelfApprove && 'Needs another approver'].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">{formatPence(total(j))}</td>
                  <td className="py-2.5 px-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[6px] whitespace-nowrap ${STATUS_STYLE[j.status]}`}>{STATUS_LABEL[j.status]}</span>
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {primary && (
                        <button type="button" disabled={busy} onClick={primary.run} title={primary.title} className="inline-flex items-center gap-1 min-h-[30px] px-3 bg-[#122654] text-white text-xs font-semibold rounded-[8px] whitespace-nowrap cursor-pointer hover:bg-[#1D4E89] disabled:opacity-60">
                          <primary.icon className="w-3.5 h-3.5" /> {primary.label}
                        </button>
                      )}
                      {more > 0 && (
                        <button
                          type="button"
                          aria-label={`More actions for ${j.ref}`}
                          aria-haspopup="menu"
                          aria-expanded={menu?.id === j.id}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setMenu(menu?.id === j.id ? null : { id: j.id, top: r.bottom + 4, right: window.innerWidth - r.right });
                          }}
                          className="flex items-center justify-center w-8 h-8 border border-[#D3DCEE] rounded-[8px] text-[#122654] cursor-pointer hover:bg-[#F5F8FD]"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3 pt-0">
                      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] bg-[#F5F8FD] border border-[#E3E7EF] rounded-[10px] p-3 text-xs">
                        <div className="space-y-1 break-words text-[#4A5878] md:pr-5 md:border-r md:border-[#D3DCEE]">
                          <p className="font-bold text-[#122654]">Narrative</p>
                          <p className="text-[#122654]">{j.narrative}</p>
                          {j.calculation && <p className="text-xs">Calculation: {j.calculation}</p>}
                          {j.reject_reason && <p className="text-xs">Rejected: {j.reject_reason}</p>}
                          {j.self_approval_reason && <p className="text-xs text-[#8A5A00]">Self-approved. Reason: “{j.self_approval_reason}”</p>}
                          {j.auto_reverse && <p className="text-xs">Reverses itself on the first day of the next period.</p>}
                          <p className="text-[11px] pt-1">
                            {TYPES.find((t) => t[0] === j.type)?.[1] ?? 'Adjusting'} · Prepared by {j.proposed_by_name}
                            {j.approved_by_name && ` · Approved by ${j.approved_by_name}`}
                          </p>
                          {ownWaiting && !canSelfApprove && (
                            <p className="text-xs text-[#6B4700]">
                              You proposed this, so another reviewer must approve it.
                              {['partner', 'admin'].includes(actor.role) && (
                                <>
                                  {' '}Working alone? Turn on{' '}
                                  <Link href="/settings" className="underline font-semibold">
                                    approving your own journals
                                  </Link>{' '}
                                  in Settings.
                                </>
                              )}
                            </p>
                          )}
                          {(j.evidence ?? []).map((e) => (
                            <button key={e.file_key} type="button" onClick={() => setPreview(evidenceFile(e))} className="flex items-center gap-1 text-xs text-[#1D4E89] hover:underline cursor-pointer">
                              <Paperclip className="w-3 h-3" /> {e.filename}
                            </button>
                          ))}
                        </div>
                        <div>
                          <p className="font-bold text-[#122654] mb-2">Accounts ({j.lines.length})</p>
                          <ul className="divide-y divide-[#E3E7EF] bg-white rounded-[8px]">
                            {j.lines.map((l) => {
                              const dr = BigInt(l.debit_p);
                              return (
                                <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                                  <span className="font-mono font-semibold w-12 shrink-0">{l.blynt_code}</span>
                                  <span className="flex-1 min-w-0">
                                    {accounts.find((a) => a.code === l.blynt_code)?.name}
                                    {l.narrative && <span className="block text-xs text-[#4A5878] truncate" title={l.narrative}>{l.narrative}</span>}
                                  </span>
                                  <span className="font-mono">{formatPence(dr || BigInt(l.credit_p))}</span>
                                  <span className="w-12 text-center text-[11px] font-semibold px-1.5 py-0.5 rounded-[6px] bg-[#E3E7EF] text-[#4A5878]">{dr ? 'Debit' : 'Credit'}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        {j.ledger && (
                          <div className="md:pl-2 space-y-1">
                            <a href={j.ledger.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-[#1D4E89] hover:underline">
                              <ExternalLink className="w-3.5 h-3.5" /> View in Xero
                            </a>
                            <p className="text-xs text-[#4A5878] max-w-[200px]">
                              {j.status === 'in_ledger'
                                ? 'In Xero and the trial balance.'
                                : j.ledger.status === 'DRAFT'
                                  ? 'Draft in Xero: approve it there.'
                                  : j.ledger.status === 'POSTED'
                                    ? 'Posted in Xero: in the trial balance from the next pull.'
                                    : `Xero says ${j.ledger.status.toLowerCase()}: send it again if needed.`}
                            </p>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-2.5 border-t border-[#E3E7EF] text-[11px] text-[#4A5878]">
          Showing {shown.length} of {journals.length} journal{journals.length === 1 ? '' : 's'}
        </p>
      </div>

      {menu && menuJournal && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onWheel={() => setMenu(null)} aria-hidden="true" />
          <div role="menu" style={{ top: menu.top, right: menu.right }} className="fixed z-50 min-w-[170px] bg-white border border-[#E3E7EF] rounded-[10px] shadow-lg py-1 text-xs">
            {menuItems.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                disabled={busy}
                title={a.title}
                onClick={() => {
                  setMenu(null);
                  a.run();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-[#F5F8FD] disabled:opacity-60 ${a.danger ? 'text-[#B8432F]' : 'text-[#122654]'}`}
              >
                <a.icon className="w-3.5 h-3.5" /> {a.label}
              </button>
            ))}
          </div>
        </>
      )}

      {sending && (
        <SendToXero
          journal={sending}
          onClose={() => setSending(null)}
          onSent={(text) => {
            setSending(null);
            setNotice({ ok: true, text });
            setRev((r) => r + 1);
          }}
        />
      )}

      {form && (
        <JournalForm
          engagementId={engagementId}
          periodStart={engagement.period_start}
          periodEnd={engagement.period_end}
          source={form.source}
          onClose={() => setForm(null)}
          onSaved={(text) => {
            setForm(null);
            setNotice({ ok: true, text });
            setRev((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}

function JournalForm({ engagementId, periodStart, periodEnd, source, onClose, onSaved }: { engagementId: string; periodStart: string; periodEnd: string; source?: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [type, setType] = useState<NonNullable<Adjustment['type']>>('adjusting');
  const [date, setDate] = useState(periodEnd);
  const [narrative, setNarrative] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [autoReverse, setAutoReverse] = useState(false);
  const [evidence, setEvidence] = useState<{ file_key: string; filename: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accounts = db.accountsFor(engagementId);

  const dr = lines.reduce((a, l) => a + pence(l.debit), 0n);
  const cr = lines.reduce((a, l) => a + pence(l.credit), 0n);
  const balanced = dr === cr && dr > 0n && lines.every((l) => l.blynt_code) && narrative.trim().length > 0;
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const upload = async (file: File) => {
    setError('');
    const res = await fetch('/api/v1/files', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) }, body: file });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return setError(out.error || 'Could not upload the file.');
    setEvidence([...evidence, { file_key: out.file_key, filename: out.filename }]);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(engagementId)}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          date,
          narrative,
          auto_reverse: autoReverse,
          evidence,
          source_schedule: source,
          lines: lines.map((l) => ({ blynt_code: l.blynt_code, debit_p: l.debit || '0', credit_p: l.credit || '0', narrative: l.narrative })),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return setError(out.error || 'Could not save the journal.');
      const touched = schedulesTouched(lines.map((l) => l.blynt_code));
      onSaved(
        out.status === 'proposed'
          ? `${out.ref} saved as a draft proposal. It changes nothing until it is accepted.`
          : `${out.ref} saved. Updated: adjusted trial balance${touched.length ? `, ${touched.join(', ')}` : ''}.`
      );
    } finally {
      setBusy(false);
    }
  };

  const input = 'min-h-[36px] px-2.5 text-xs bg-white border border-[#D3DCEE] rounded-[8px] text-[#122654]';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="New journal">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl p-5 space-y-4 text-xs text-[#122654]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{source ? `Propose a journal from ${source}` : 'New journal'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-[#4A5878] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="font-semibold">
            Type
            <select className={`${input} mt-1 w-full`} value={type} onChange={(e) => setType(e.target.value as NonNullable<Adjustment['type']>)}>
              {TYPES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </label>
          <label className="font-semibold">
            Date
            <input type="date" className={`${input} mt-1 w-full`} value={date} min={periodStart} max={periodEnd} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="font-semibold sm:col-span-3">
            Narrative
            <input className={`${input} mt-1 w-full`} value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="e.g. Accrue September rent not yet invoiced" />
          </label>
        </div>

        <table className="w-full">
          <thead className="text-[10px] uppercase text-[#4A5878]">
            <tr>
              <th className="text-left pb-1">Account</th>
              <th className="text-left pb-1">Description</th>
              <th className="text-right pb-1">Debit £</th>
              <th className="text-right pb-1">Credit £</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="pr-2 pb-1.5">
                  <select aria-label={`Line ${i + 1} account`} className={`${input} w-full`} value={l.blynt_code} onChange={(e) => setLine(i, { blynt_code: e.target.value })}>
                    <option value="">Choose account…</option>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>{a.code} {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="pr-2 pb-1.5"><input aria-label={`Line ${i + 1} description`} className={`${input} w-full`} value={l.narrative} onChange={(e) => setLine(i, { narrative: e.target.value })} /></td>
                <td className="pr-2 pb-1.5"><input aria-label={`Line ${i + 1} debit`} className={`${input} w-24 text-right font-mono`} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td className="pr-2 pb-1.5"><input aria-label={`Line ${i + 1} credit`} className={`${input} w-24 text-right font-mono`} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td className="pb-1.5">
                  {lines.length > 2 && (
                    <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))} className="p-1 text-[#4A5878] cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-[#E3E7EF] font-bold">
              <td className="pt-2">
                <button type="button" onClick={() => setLines([...lines, blankLine()])} className="inline-flex items-center gap-1 text-[#1D4E89] font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>
              </td>
              <td className={`pt-2 ${dr === cr ? 'text-[#0B6B52]' : 'text-[#B8432F]'}`}>{dr === cr ? 'Balanced' : `Out by ${formatPence(dr > cr ? dr - cr : cr - dr)}`}</td>
              <td className="pt-2 text-right font-mono">{formatPence(dr)}</td>
              <td className="pt-2 text-right font-mono">{formatPence(cr)}</td>
              <td />
            </tr>
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#1D4E89] font-semibold">
            <Paperclip className="w-3.5 h-3.5" /> Attach evidence
            <input type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {evidence.map((e) => (
            <span key={e.file_key} className="text-[11px] bg-[#F5F8FD] px-2 py-0.5 rounded">{e.filename}</span>
          ))}
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={autoReverse} onChange={(e) => setAutoReverse(e.target.checked)} />
            Auto-reverse on the first day of the next period (accruals and prepayments)
          </label>
        </div>

        {error && (
          <p role="alert" className="text-[11px] font-medium text-[#B42318] flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[36px] px-4 border border-[#D3DCEE] rounded-[8px] font-bold cursor-pointer">Cancel</button>
          <button type="button" onClick={save} disabled={!balanced || busy} className="min-h-[36px] px-4 bg-[#122654] text-white rounded-[8px] font-bold cursor-pointer disabled:opacity-50">
            {busy ? 'Saving…' : 'Save journal'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface XeroAccountOption {
  code: string;
  name: string;
  type: string;
}

/**
 * Sends an approved journal to the client's Xero: each line on the Xero account picked for it (suggested from
 * the mapping), as a draft for someone to approve in Xero unless "post now" is ticked.
 */
function SendToXero({ journal, onClose, onSent }: { journal: Adjustment; onClose: () => void; onSent: (text: string) => void }) {
  const [data, setData] = useState<{ organisation: string; accounts: XeroAccountOption[] } | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [post, setPost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lines = journal.lines.filter((l) => BigInt(l.debit_p) !== BigInt(l.credit_p));
  const url = `/api/v1/adjustments/${encodeURIComponent(journal.id)}/xero`;

  useEffect(() => {
    fetch(url)
      .then(async (r) => {
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || 'Could not read the Xero accounts.');
        setData({ organisation: out.organisation, accounts: out.accounts });
        setChosen(Object.fromEntries(Object.entries(out.suggested ?? {}).filter(([, v]) => v)) as Record<string, string>);
      })
      .catch((e) => setError((e as Error).message));
  }, [url]);

  const ready = !!data && lines.every((l) => chosen[l.id]);
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: chosen, post }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'The journal could not be sent.');
      onSent(post ? `${journal.ref} is posted in Xero. The next pull brings it into the trial balance.` : `${journal.ref} is a draft in Xero. Approve it there, and the next pull brings it in.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={`Send ${journal.ref} to Xero`}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl p-5 space-y-4 text-xs text-[#122654]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Send {journal.ref} to Xero{data ? `: ${data.organisation}` : ''}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-[#4A5878] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[#4A5878]">{journal.narrative}. Choose the client&apos;s Xero account for each line. Each one starts on the account it is mapped from.</p>
        {!data && !error && <p className="text-[#4A5878]">Reading the Xero accounts…</p>}
        {data && (
          <table className="w-full">
            <thead className="text-[10px] uppercase tracking-wider text-[#4A5878] text-left">
              <tr>
                <th className="py-1.5">Blynt account</th>
                <th className="py-1.5 text-right">Debit</th>
                <th className="py-1.5 text-right">Credit</th>
                <th className="py-1.5 pl-3">Xero account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">
                    <span className="font-mono mr-1.5">{l.blynt_code}</span>
                    {db.blynt_accounts.find((a) => a.code === l.blynt_code)?.name}
                  </td>
                  <td className="py-2 text-right font-mono">{BigInt(l.debit_p) ? formatPence(BigInt(l.debit_p), { symbol: '' }) : ''}</td>
                  <td className="py-2 text-right font-mono">{BigInt(l.credit_p) ? formatPence(BigInt(l.credit_p), { symbol: '' }) : ''}</td>
                  <td className="py-2 pl-3">
                    <select
                      aria-label={`Xero account for ${l.blynt_code}`}
                      value={chosen[l.id] ?? ''}
                      onChange={(e) => setChosen({ ...chosen, [l.id]: e.target.value })}
                      className={`w-full min-h-[32px] px-2 border rounded-[8px] bg-white ${chosen[l.id] ? 'border-[#D3DCEE]' : 'border-[#B8432F]'}`}
                    >
                      <option value="">Choose an account…</option>
                      {data.accounts.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} className="mt-0.5" />
            <span>
              Post it in Xero now
              <span className="block text-[#4A5878]">Left unticked, it goes in as a draft for someone to approve in Xero first.</span>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-[#B42318] flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[36px] px-4 border border-[#D3DCEE] rounded-[10px] font-semibold cursor-pointer">
            Cancel
          </button>
          <button type="button" disabled={!ready || busy} onClick={send} className="inline-flex items-center gap-1.5 min-h-[36px] px-4 bg-[#122654] text-white font-bold rounded-[10px] cursor-pointer disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : post ? 'Post in Xero' : 'Send as a draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

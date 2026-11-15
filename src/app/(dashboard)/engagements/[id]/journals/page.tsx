'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { AlertCircle, Check, ExternalLink, Paperclip, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react';
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
  accepted: 'bg-[#EAF5FC] text-[#1D4E89]',
  approved: 'bg-[#E6F4EF] text-[#0B6B52]',
  posted: 'bg-[#E6F4EF] text-[#0B6B52]',
  reversed: 'bg-[#F5F8FD] text-[#4A5878]',
  rejected: 'bg-[#F5F8FD] text-[#4A5878]',
  in_ledger: 'bg-[#0B6B52] text-white',
};
const TABS: ['all' | Adjustment['status'], string][] = [
  ['all', 'All'],
  ['proposed', 'Draft'],
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
  const selfApprove = (j: Adjustment) => {
    const reason = window.prompt(`You proposed ${j.ref}. Why are you approving it yourself? (at least 10 characters; kept on the journal and in the activity log)`);
    if (reason && reason.trim().length >= 10) act(j, 'approve', reason.trim());
    else if (reason !== null) setNotice({ ok: false, text: 'Give a reason of at least 10 characters to approve your own journal.' });
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

  const journals = useMemo(
    () => db.adjustments.filter((a) => a.engagement_id === engagementId).sort((a, b) => a.ref.localeCompare(b.ref)),
    [engagementId, rev] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shown = journals.filter((j) => tab === 'all' || j.status === tab);
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
    if (!window.confirm(`Delete ${j.ref}? This is recorded in the activity log.`)) return;
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

  const reject = (j: Adjustment) => {
    const reason = window.prompt(`Why reject ${j.ref}? The reason helps improve future proposals.`);
    if (reason?.trim()) act(j, 'reject', reason.trim());
  };

  if (!engagement) return <p className="text-sm text-[#4A5878]">Engagement not found.</p>;
  const locked = engagement.status === 'locked';

  return (
    <div className="flex flex-col gap-5">
      <PreviewModal file={preview} onClose={() => setPreview(null)} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#122654]">Journals</h1>
          <p className="text-xs text-[#4A5878] mt-1">Every adjustment in this file. Accepted, approved and posted journals are in the adjusted trial balance.</p>
        </div>
        <div className="flex gap-2">
          {canApprove && selected.size > 0 && (
            <button type="button" disabled={busy} onClick={approveSelected} className="inline-flex items-center gap-1.5 min-h-[38px] px-4 bg-[#0B6B52] text-white text-xs font-bold rounded-[10px] cursor-pointer disabled:opacity-60">
              <Check className="w-3.5 h-3.5" /> Approve selected ({selected.size})
            </button>
          )}
          {!locked && (
            <button type="button" onClick={() => setForm({})} className="inline-flex items-center gap-1.5 min-h-[38px] px-4 bg-[#122654] text-white text-xs font-bold rounded-[10px] cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> New journal
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ['Effect on profit', totals.profit],
          ['Effect on net assets', totals.netAssets],
        ].map(([label, v]) => (
          <div key={label as string} className="bg-white border border-[#E3E7EF] rounded-[12px] p-4">
            <p className="text-[11px] font-semibold text-[#4A5878]">{label as string}</p>
            <p className={`text-lg font-bold font-mono ${(v as bigint) < 0n ? 'text-[#B8432F]' : 'text-[#122654]'}`}>{formatPence(v as bigint)}</p>
          </div>
        ))}
        <div className="bg-white border border-[#E3E7EF] rounded-[12px] p-4">
          <p className="text-[11px] font-semibold text-[#4A5878]">Waiting</p>
          <p className="text-sm text-[#122654]">
            {journals.filter((j) => j.status === 'proposed').length} draft · {journals.filter((j) => j.status === 'accepted').length} to approve
          </p>
        </div>
      </div>

      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`p-3 rounded-[10px] text-xs font-medium flex items-start gap-2 ${notice.ok ? 'bg-[#E6F4EF] text-[#0B6B52]' : 'bg-[#FFF4DB] text-[#6B4700]'}`}>
          {!notice.ok && <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />} {notice.text}
        </div>
      )}

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-xs font-semibold rounded-full cursor-pointer ${tab === k ? 'bg-[#122654] text-white' : 'bg-white border border-[#D3DCEE] text-[#122654]'}`}>
            {label} ({k === 'all' ? journals.length : journals.filter((j) => j.status === k).length})
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#E3E7EF] rounded-[12px] overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F5F8FD] text-[10px] uppercase tracking-wider text-[#4A5878]">
            <tr>
              <th className="py-2.5 px-3 w-8"><span className="sr-only">Select</span></th>
              <th className="py-2.5 px-3">Ref</th>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Narrative</th>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Preparer</th>
              <th className="py-2.5 px-3">Approver</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF] text-[#122654]">
            {!shown.length && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-[#4A5878]">No journals here yet.</td>
              </tr>
            )}
            {shown.map((j) => {
              const approvable = canApprove && (j.status === 'proposed' || j.status === 'accepted') && j.proposed_by !== actor.id;
              const ownApprovable = canSelfApprove && (j.status === 'proposed' || j.status === 'accepted') && j.proposed_by === actor.id;
              return (
                <tr key={j.id} className="align-top">
                  <td className="py-2.5 px-3">
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
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold">{j.ref}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{ukDate(j.date ?? j.created_at.slice(0, 10))}</td>
                  <td className="py-2.5 px-3">{TYPES.find((t) => t[0] === j.type)?.[1] ?? 'Adjusting'}</td>
                  <td className="py-2.5 px-3 max-w-[280px]">
                    <span className="block">{j.narrative}</span>
                    {j.source_schedule && <span className="block text-[11px] text-[#4A5878]">From {j.source_schedule}{j.calculation ? `: ${j.calculation}` : ''}</span>}
                    {j.reverses_id && <span className="block text-[11px] text-[#4A5878]">Reverses {db.adjustments.find((a) => a.id === j.reverses_id)?.ref ?? 'a prior journal'}</span>}
                    {j.reject_reason && <span className="block text-[11px] text-[#4A5878]">Rejected: {j.reject_reason}</span>}
                    {j.self_approval_reason && <span className="block text-[11px] text-[#8A5A00]">Approved by the person who proposed it: {j.self_approval_reason}</span>}
                    {j.auto_reverse && <span className="block text-[11px] text-[#1D4E89]">Auto-reverses next period</span>}
                    {j.ledger && (
                      <a href={j.ledger.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#1D4E89] hover:underline">
                        <ExternalLink className="w-3 h-3" />
                        {j.status === 'in_ledger'
                          ? 'Posted in Xero and in the trial balance'
                          : j.ledger.status === 'DRAFT'
                            ? 'Draft in Xero: approve it there'
                            : j.ledger.status === 'POSTED'
                              ? 'Posted in Xero: in the trial balance from the next pull'
                              : `Xero says ${j.ledger.status.toLowerCase()}: send it again if needed`}
                      </a>
                    )}
                    {(j.evidence ?? []).map((e) => (
                      <button key={e.file_key} type="button" onClick={() => setPreview(evidenceFile(e))} className="inline-flex items-center gap-1 text-[11px] text-[#1D4E89] hover:underline mr-2">
                        <Paperclip className="w-3 h-3" /> {e.filename}
                      </button>
                    ))}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[j.status]}`}>{STATUS_LABEL[j.status]}</span>
                  </td>
                  <td className="py-2.5 px-3">{j.proposed_by_name}</td>
                  <td className="py-2.5 px-3">{j.approved_by_name ?? '—'}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{formatPence(total(j))}</td>
                  <td className="py-2.5 px-3">
                    {!locked && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {j.status === 'proposed' && (
                          <>
                            <button type="button" disabled={busy} onClick={() => act(j, 'accept')} className="px-2 py-1 rounded bg-[#EAF5FC] text-[#1D4E89] font-semibold cursor-pointer">Accept</button>
                            <button type="button" disabled={busy} onClick={() => reject(j)} className="px-2 py-1 rounded bg-[#F5F8FD] text-[#4A5878] font-semibold cursor-pointer">Reject</button>
                          </>
                        )}
                        {approvable && (
                          <button type="button" disabled={busy} onClick={() => act(j, 'approve')} className="px-2 py-1 rounded bg-[#E6F4EF] text-[#0B6B52] font-semibold cursor-pointer">Approve</button>
                        )}
                        {ownApprovable && (
                          <button type="button" disabled={busy} onClick={() => selfApprove(j)} title="You proposed this journal. Approving it yourself needs a reason." className="px-2 py-1 rounded bg-[#E6F4EF] text-[#0B6B52] font-semibold cursor-pointer">
                            Approve my own…
                          </button>
                        )}
                        {/* Your own journal and no way to approve it: say why, and what to do */}
                        {!ownApprovable && (j.status === 'proposed' || j.status === 'accepted') && j.proposed_by === actor.id && (
                          <span className="max-w-[220px] text-right text-[10px] text-[#6B4700]">
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
                          </span>
                        )}
                        {canApprove && (j.status === 'approved' || j.status === 'posted') && (!j.ledger || ['DELETED', 'VOIDED'].includes(j.ledger.status)) && (
                          <button type="button" disabled={busy} onClick={() => setSending(j)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#122654] text-white font-semibold cursor-pointer">
                            <Send className="w-3 h-3" /> Send to Xero
                          </button>
                        )}
                        {(j.status === 'approved' || j.status === 'posted') && (
                          <button type="button" disabled={busy} onClick={() => act(j, 'reverse')} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#F5F8FD] text-[#122654] font-semibold cursor-pointer">
                            <RotateCcw className="w-3 h-3" /> Reverse
                          </button>
                        )}
                        {['proposed', 'accepted', 'rejected'].includes(j.status) && (
                          <button type="button" disabled={busy} onClick={() => remove(j)} aria-label={`Delete ${j.ref}`} className="p-1 rounded text-[#4A5878] hover:text-[#B8432F] cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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

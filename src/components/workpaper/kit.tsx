'use client';

import { Notice } from '@/components/ui/Notice';
import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { formatPence, formatPenceInput } from '@/lib/money';
import { chartName, journalInLedger, journalSig, journalWhere, type JLine } from '@/lib/workpapers/common';
import { paperContext, type PaperResult } from '@/lib/workpapers/engine';
import { db } from '@/lib/server/db';
import { SCHEDULE_DECISIONS, type ScheduleGate, type ScheduleOutputType } from '@/lib/types/models';

/* Shared building blocks for the redesigned papers. */

export const th = 'p-2 text-[10px] font-bold uppercase tracking-wider text-[#4A5878] whitespace-nowrap';
export const btnPrimary = 'px-2.5 py-1 text-[11px] font-bold rounded-[6px] bg-[#122654] hover:bg-[#1D4E89] text-white disabled:opacity-50';
export const btnSecondary = 'px-2.5 py-1 text-[11px] font-bold rounded-[6px] border border-[#D3DCEE] bg-white text-[#122654] hover:border-[#122654]';
export const btnAdd =
  'inline-flex items-center gap-1 min-h-[32px] px-3 text-xs font-bold text-[#122654] bg-white border border-[#D3DCEE] hover:border-[#122654] rounded-[8px] disabled:opacity-40';
export const card = 'p-3 bg-white border border-[#E3E7EF] rounded-[12px] text-xs text-[#122654]';
export const money = (p: bigint) => (p === 0n ? '–' : formatPence(p, { symbol: '', accountingFormat: true }));
export const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export type Tone = 'good' | 'bad' | 'warn' | 'plain';
const toneText: Record<Tone, string> = { good: 'text-[#0B6B52]', bad: 'text-[#B42318]', warn: 'text-[#B8432F]', plain: 'text-[#122654]' };

export function Tiles({ items }: { items: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }[] }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${items.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {items.map((t) => (
        <div key={t.label} className={`p-3 border rounded-[12px] min-w-0 ${t.tone === 'bad' ? 'bg-[#FFF5F3] border-[#F5C6BC]' : 'bg-white border-[#E3E7EF]'}`}>
          <div className="text-xs text-[#4A5878]">{t.label}</div>
          <div className={`mt-0.5 text-lg font-bold ${toneText[t.tone ?? 'plain']}`}>{t.value}</div>
          {t.sub !== undefined && <div className="mt-0.5 text-[11px] text-[#4A5878]">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

const pillTone: Record<string, string> = {
  good: 'bg-[#E6F4EF] text-[#0B6B52]',
  bad: 'bg-[#FFF1EE] text-[#B42318]',
  warn: 'bg-[#FFF4DB] text-[#8A5A00]',
  info: 'bg-[#E8F0FC] text-[#1D4E89]',
  plain: 'bg-[#EEF1F6] text-[#4A5878]',
};
export const Pill = ({ tone, children }: { tone: keyof typeof pillTone; children: React.ReactNode }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${pillTone[tone]}`}>{children}</span>
);

// The gate's three bands, named as on the mapping page
const GATE: Record<ScheduleGate['gate'], [keyof typeof pillTone, string]> = { ready: ['good', 'Ready'], check: ['warn', 'Check'], exception: ['bad', 'Exception'] };

/** A schedule line's suggested decision after the learned rules and the confidence gate: what it is, where it came from, and whether it is ready or needs a check. The person still decides. */
export function Suggested({ type, ai }: { type: ScheduleOutputType; ai?: Partial<ScheduleGate> }) {
  if (!ai?.classification || !ai.gate) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] text-[#4A5878]">
      Suggested: <strong className="text-[#122654]">{SCHEDULE_DECISIONS[type][ai.classification] ?? ai.classification}</strong>
      {ai.source === 'rule' ? '· learned rule' : `· AI ${ai.confidence}% sure`}
      <Pill tone={GATE[ai.gate][0]}>{GATE[ai.gate][1]}</Pill>
    </span>
  );
}

/** The "N suggestions ready" banner: a rule-based summary with one button to accept them all. */
export function SuggestBanner({
  count,
  text,
  onAccept,
  locked,
  decided = 0,
  onUndo,
}: {
  count: number;
  text: React.ReactNode;
  onAccept?: () => void;
  locked: boolean;
  /** Suggestions already decided; with onUndo the banner stays to offer putting them back */
  decided?: number;
  onUndo?: () => void;
}) {
  const canUndo = !locked && !!onUndo && decided > 0;
  if (!count && !canUndo) return null;
  return (
    <div className="p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-[12px] flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 text-xs text-[#122654]">
        <div className="font-bold flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#B8432F]" /> {count ? `${count} suggestion${count === 1 ? '' : 's'} ready` : `${decided} suggestion${decided === 1 ? '' : 's'} decided`}
        </div>
        <div className="text-[11px] text-[#4A5878] mt-0.5">
          {count ? <>{text} Accepting builds the journal below; you can still undo each one.</> : 'Undo puts them back to decide again. What you entered on each line is kept.'}
        </div>
      </div>
      {canUndo && (
        <button type="button" onClick={onUndo} className="shrink-0 min-h-[32px] px-3 text-xs font-bold text-[#122654] bg-white border border-[#D3DCEE] hover:border-[#122654] rounded-[8px]">
          Undo {decided} decided
        </button>
      )}
      {!locked && onAccept && count > 0 && (
        <button type="button" onClick={onAccept} className="shrink-0 min-h-[32px] px-3 text-xs font-bold text-white bg-[#122654] hover:bg-[#1D4E89] rounded-[8px]">
          Accept all suggestions
        </button>
      )}
    </div>
  );
}

/** A suggestion under a row: why, and the buttons that decide it. */
export function SuggestionRow({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="px-3 py-2 rounded-[8px] bg-[#FFF8E6] border border-[#F0D48A] text-[11px] text-[#5C4100] flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex-1 flex items-start gap-1.5">
        <Sparkles className="w-3.5 h-3.5 mt-px shrink-0 text-[#B8432F]" />
        <span>{children}</span>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

export function FilterChips<K extends string>({ options, value, onChange }: { options: { key: K; label: string; count: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1 rounded-full text-xs font-semibold border ${value === o.key ? 'bg-[#122654] text-white border-[#122654]' : 'bg-white text-[#122654] border-[#D3DCEE] hover:border-[#122654]'}`}
        >
          {o.label} ({o.count})
        </button>
      ))}
    </div>
  );
}

export function ExpandButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${label}`} onClick={onClick} className="p-1 rounded border border-[#D3DCEE] text-[#4A5878] hover:text-[#122654]">
      {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    </button>
  );
}

export function useOpen() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return { isOpen: (id: string) => !!open[id], toggle: (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] })), show: (id: string) => setOpen((o) => ({ ...o, [id]: true })) };
}

export function CheckChips({ checks }: { checks: PaperResult['checks'] }) {
  return (
    <div className="p-3 bg-white border border-[#E3E7EF] rounded-[12px] text-[#122654] flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold">Checks</span>
        <span className="text-[10px] text-[#4A5878]">Ticked automatically from the work above. No separate procedures list.</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checks.map((c) => (
          <span
            key={c.id}
            title={c.detail}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-semibold ${c.passed ? 'bg-[#E6F4EF] text-[#0B6B52]' : c.explanation ? 'bg-[#EEF1F6] text-[#4A5878]' : 'bg-[#FFF4DB] text-[#5C4100]'}`}
          >
            {c.passed ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5 text-[#8A5A00]" />} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A two-column "how it shows in the accounts" table. */
export function AccountsPreview({ title = 'How it shows in the accounts', rows, note }: { title?: string; rows: { label: string; amount: bigint | null; strong?: boolean; prior?: bigint | null }[]; note?: string }) {
  const hasPrior = rows.some((r) => r.prior !== undefined);
  return (
    <div className={card}>
      <div className="text-sm font-bold mb-2">{title}</div>
      <table className="w-full text-xs">
        {hasPrior && (
          <thead>
            <tr className="text-[#4A5878]">
              <th />
              <th className="px-2 pb-1 text-right font-semibold">This year</th>
              <th className="px-2 pb-1 text-right font-semibold">Last year</th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.strong ? 'font-bold bg-[#F5F8FD]' : 'border-b border-[#EEF1F6]'}>
              <td className="py-1.5 px-2">{r.label}</td>
              <td className="py-1.5 px-2 text-right font-mono">{r.amount === null ? '–' : money(r.amount)}</td>
              {hasPrior && <td className="py-1.5 px-2 text-right font-mono">{r.prior == null ? '–' : money(r.prior)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div className="mt-2 text-[10px] text-[#4A5878]">{note}</div>}
    </div>
  );
}

/** The other papers this one feeds, each linked, with the figure it passes them. Papers not in the file show unlinked. */
export function FlowsTo({ engagementId, rows }: { engagementId: string; rows: { ref: string; label: string; detail: string; amount: bigint | null }[] }) {
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-bold">Where this flows</span>
        <span className="text-[11px] text-[#4A5878]">Updates the linked schedules</span>
      </div>
      <ul className="flex flex-col divide-y divide-[#EEF1F6] text-xs">
        {rows.map((r) => {
          const wp = db.workpapers.find((w) => w.engagement_id === engagementId && w.ref === r.ref);
          return (
            <li key={`${r.ref}:${r.label}`} className="py-1.5 flex items-start gap-2">
              <span className="flex-1 min-w-0">
                {wp ? (
                  <a href={`/engagements/${engagementId}/workpapers/${wp.id}`} className="font-semibold text-[#1D4E89] underline">
                    {r.label}
                  </a>
                ) : (
                  <span className="font-semibold">{r.label}</span>
                )}
                <span className="block text-[11px] text-[#4A5878]">{r.detail}</span>
              </span>
              <span className="font-mono">{r.amount === null || r.amount === 0n ? '–' : money(r.amount)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The journal built from a paper's decisions, and the button that sends it to the journal
 * register as a proposal. What was sent is saved on the paper, so the check can tell when the
 * decisions change afterwards.
 */
export function JournalPanel({
  engagementId,
  date,
  lines,
  sent,
  narrative,
  source,
  autoReverse = false,
  locked,
  save,
  empty = 'No adjustments needed. Accept a suggestion and the journal appears here.',
  title = 'Adjustments',
  note,
}: {
  engagementId: string;
  date: string;
  lines: JLine[];
  sent?: { id?: string; ref: string; sig: string };
  narrative: string;
  source: string;
  autoReverse?: boolean;
  locked: boolean;
  save: (patch: Record<string, any>) => void;
  empty?: string;
  title?: string;
  note?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sig = journalSig(lines);
  // Once the journal is in Xero's trial balance the paper's figures include it, so it no longer has to match
  const current = sent && (sent.sig === sig || journalInLedger(sent.id));
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(engagementId)}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'adjusting',
          date,
          narrative,
          source_schedule: source,
          auto_reverse: autoReverse,
          lines: lines.map((l) => ({ blynt_code: l.code, debit_p: l.debit ? formatPenceInput(l.debit) : '0', credit_p: l.credit ? formatPenceInput(l.credit) : '0', narrative: l.narrative })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The journal could not be sent.');
      save({ journal: { id: body.id, ref: body.ref, sig } });
    } catch (err: any) {
      setError(err?.message || 'The journal could not be sent.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-sm font-bold">{title}</span>
        {autoReverse ? <Pill tone="info">Reverses on the first day of next year</Pill> : <span className="text-[10px] text-[#4A5878]">Built from your decisions</span>}
      </div>
      {lines.length === 0 ? (
        <div className="text-xs text-[#4A5878]">{empty}</div>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-[#EEF1F6]">
                <td className="py-1.5 w-7 text-[#4A5878]">{l.debit ? 'Dr' : 'Cr'}</td>
                <td className="py-1.5">
                  <span className="font-mono font-semibold mr-1.5">{l.code}</span>
                  {chartName(l.code)}
                  <div className="text-[11px] text-[#4A5878]">{l.narrative}</div>
                </td>
                <td className="py-1.5 text-right font-mono">{l.debit ? formatPence(l.debit, { symbol: '' }) : ''}</td>
                <td className="py-1.5 text-right font-mono">{l.credit ? formatPence(l.credit, { symbol: '' }) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <div className="mt-2 text-[10px] text-[#4A5878]">{note}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {current ? (
          <span className="text-[11px] text-[#0B6B52] font-semibold">✓ {journalWhere(sent!.id, sent!.ref)}</span>
        ) : (
          <>
            {sent && <span className="text-[11px] text-[#B8432F]">Changed since {sent.ref} was sent: remove {sent.ref} on the Journals page, then send again.</span>}
            {!locked && lines.length > 0 && (
              <button type="button" disabled={busy} onClick={send} className="min-h-[32px] px-3 text-xs font-bold text-white bg-[#122654] hover:bg-[#1D4E89] rounded-[8px] disabled:opacity-50">
                {busy ? 'Sending…' : autoReverse ? 'Send with auto-reversal' : 'Send to journals'}
              </button>
            )}
          </>
        )}
        {error && <Notice inline>{error}</Notice>}
      </div>
    </div>
  );
}

/** A select of chart codes. */
export function CodePicker({ value, codes, onChange, disabled, label }: { value: string | undefined; codes: { code: string; name: string }[]; onChange: (c: string) => void; disabled: boolean; label: string }) {
  return (
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="max-w-[220px] px-1.5 py-1 text-[11px] bg-white border border-[#D3DCEE] rounded-[6px] disabled:bg-[#F5F8FD]">
      <option value="">Choose account…</option>
      {codes.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} {c.name}
        </option>
      ))}
    </select>
  );
}

/** The review context for the paper on screen, for papers whose rows are worked out by their review. */
export function contextOf(result: PaperResult) {
  const wp = db.workpapers.find((w) => w.engagement_id === result.engagementId && w.ref === result.template.ref);
  return wp ? paperContext(wp, { leads: result.leads, checks: [], anchors: [], totals: {} }) : null;
}

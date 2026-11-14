'use client';

import React, { useEffect, useState } from 'react';
import type { Comment, CommentKeep } from '@/lib/types/models';

/**
 * Comments pinned anywhere on a paper, shown as speech bubbles where they were left. A pin on a
 * table row keeps to that row (found again by its first cells' text) at the same spot inside it;
 * anywhere else it keeps its place on the paper.
 */

export interface PinAnchor {
  kind: 'pin';
  /** First cells' text of the table row the pin is on */
  row?: string;
  /** Where in the row (or across the paper), 0 to 1 */
  x: number;
  y: number;
  /** Pixels from the top of the paper, for a pin not on a row */
  top?: number;
  /** The paper's tabs that were open when it was left (a director, a view); it shows only on those */
  view?: string[];
  label: string;
}

export type CommentType = Comment['type'];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 80);
export const rowKey = (tr: HTMLTableRowElement) => norm(Array.from(tr.cells).slice(0, 2).map((c) => c.textContent ?? '').join(' '));
/** The tabs open on the paper now. */
export const openTabs = (paper: HTMLElement) => Array.from(paper.querySelectorAll('[role="tab"][aria-selected="true"]')).map((t) => norm(t.textContent ?? '')).filter(Boolean);

export const isPin = (a: unknown): a is PinAnchor => !!a && (a as PinAnchor).kind === 'pin' && typeof (a as PinAnchor).x === 'number';

/** The anchor for a click on the paper. */
export function anchorAt(paper: HTMLElement, target: HTMLElement, clientX: number, clientY: number): PinAnchor {
  const tabs = openTabs(paper);
  const view = tabs.length ? { view: tabs } : {};
  const on = (label: string) => (tabs.length ? `${label} · ${tabs.join(' · ')}` : label);
  const tr = target.closest('tr');
  if (tr && paper.contains(tr) && rowKey(tr)) {
    const r = tr.getBoundingClientRect();
    return { kind: 'pin', row: rowKey(tr), x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height, ...view, label: on(rowKey(tr)) };
  }
  const p = paper.getBoundingClientRect();
  const heading = target.closest('section, fieldset, [class*="rounded"]')?.querySelector('h2, h3, legend, .font-bold')?.textContent;
  // shortcut: off a table row the pin keeps its distance from the top of the paper, so it drifts if something above it grows; anchor to sections if that matters
  return { kind: 'pin', x: (clientX - p.left) / p.width, y: 0, top: clientY - p.top, ...view, label: on(heading ? norm(heading) : 'On the paper') };
}

/** Where a pin sits on the paper now, or null when its row has gone. */
export function placeOf(paper: HTMLElement, a: PinAnchor): { left: number; top: number } | null {
  // Left on another tab of the paper: hidden until that tab is open again
  if (a.view?.length) {
    const open = openTabs(paper);
    if (!a.view.every((v) => open.includes(v))) return null;
  }
  const p = paper.getBoundingClientRect();
  if (a.row) {
    const tr = Array.from(paper.querySelectorAll('tr')).find((t) => rowKey(t) === a.row);
    if (!tr) return null;
    const r = tr.getBoundingClientRect();
    return { left: r.left - p.left + a.x * r.width, top: r.top - p.top + a.y * r.height };
  }
  return { left: a.x * p.width, top: a.top ?? 0 };
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export const TYPE_TONE: Record<CommentType, { bg: string; chip: string; label: string }> = {
  comment: { bg: 'bg-[#122654]', chip: 'bg-[#EEF1F6] text-[#122654]', label: 'Comment' },
  review_note: { bg: 'bg-[#C58B00]', chip: 'bg-[#FFF4DB] text-[#8A5A00]', label: 'Review note' },
  client_query: { bg: 'bg-[#1D4E89]', chip: 'bg-[#EAF5FC] text-[#1D4E89]', label: 'Client query' },
};

export const KEEP_LABEL: Record<CommentKeep, string> = { this_year: 'This year only', next_year: 'Also next year', every_year: 'Every year' };

/** Editing a comment or reply in place. */
export function EditBox({ value, onChange, onSave, onCancel }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <textarea
        autoFocus
        aria-label="Edit"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave();
        }}
        className="w-full p-2 border border-[#D3DCEE] rounded-[8px] outline-none focus:border-[#FF7A66]"
      />
      <div className="flex justify-end gap-2 text-[11px]">
        <button type="button" onClick={onCancel} className="px-2 font-bold text-[#4A5878]">
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={!value.trim()} className="px-3 py-1 font-bold rounded-[8px] bg-[#122654] text-white disabled:opacity-40">
          Save
        </button>
      </div>
    </div>
  );
}

export function Avatar({ name, type, small }: { name: string; type: CommentType; small?: boolean }) {
  return (
    <span aria-hidden className={`${TYPE_TONE[type].bg} ${small ? 'w-5 h-5 text-[8px]' : 'w-7 h-7 text-[10px]'} shrink-0 inline-flex items-center justify-center rounded-full font-bold text-white`}>
      {initials(name)}
    </span>
  );
}

export function CommentPins({
  paper,
  comments,
  activeId,
  placing,
  canPost,
  onOpen,
  onPost,
  onStopPlacing,
}: {
  paper: React.RefObject<HTMLDivElement | null>;
  comments: Comment[];
  activeId: string | null;
  placing: boolean;
  canPost: boolean;
  onOpen: (id: string) => void;
  onPost: (anchor: PinAnchor, type: CommentType, body: string, keep: CommentKeep) => void;
  onStopPlacing: () => void;
}) {
  const pinned = comments.filter((c) => c.status === 'open' && isPin(c.anchor_json));
  const [places, setPlaces] = useState<Record<string, { left: number; top: number } | null>>({});
  const [draft, setDraft] = useState<{ anchor: PinAnchor; left: number; top: number; type: CommentType; body: string; keep: CommentKeep } | null>(null);
  const [, setTick] = useState(0);

  // Follow the paper as it lays out, grows or is resized
  useEffect(() => {
    const el = paper.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [paper]);
  useEffect(() => {
    const el = paper.current;
    if (!el) return;
    const next = Object.fromEntries(pinned.map((c) => [c.id, placeOf(el, c.anchor_json as unknown as PinAnchor)]));
    if (JSON.stringify(next) !== JSON.stringify(places)) setPlaces(next);
  });

  // While placing, a click anywhere on the paper opens a box to write the comment there
  useEffect(() => {
    const el = paper.current;
    if (!el || !placing) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-pin-ui]')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-pin-ui]')) return;
      e.preventDefault();
      e.stopPropagation();
      const anchor = anchorAt(el, target, e.clientX, e.clientY);
      const p = el.getBoundingClientRect();
      setDraft({ anchor, left: e.clientX - p.left, top: e.clientY - p.top, type: 'comment', body: '', keep: 'this_year' });
      onStopPlacing();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onStopPlacing();
    el.addEventListener('mousedown', onDown, true);
    el.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      el.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [paper, placing, onStopPlacing]);

  const width = paper.current?.clientWidth ?? 0;
  const post = () => {
    if (!draft?.body.trim()) return;
    onPost(draft.anchor, draft.type, draft.body.trim(), draft.keep);
    setDraft(null);
  };

  return (
    <>
      {placing && (
        <div data-pin-ui className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#122654] text-white text-xs font-bold shadow-lg" role="status">
          Click anywhere on the paper to comment · Esc to cancel
        </div>
      )}
      {pinned.map((c) => {
        const at = places[c.id];
        if (!at) return null;
        const replies = c.replies?.length ?? 0;
        return (
          <button
            key={c.id}
            id={`pin-${c.id}`}
            data-pin-ui
            type="button"
            onClick={() => onOpen(c.id)}
            title={`${c.created_by_name}: ${c.body}`}
            aria-label={`${TYPE_TONE[c.type].label} from ${c.created_by_name}: ${c.body}`}
            style={{ left: at.left, top: at.top }}
            className={`absolute z-20 -translate-y-full flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-[14px] rounded-bl-[3px] text-white text-[10px] font-bold shadow-[0_4px_12px_rgba(11,26,59,0.25)] hover:scale-110 transition-transform ${TYPE_TONE[c.type].bg} ${activeId === c.id ? 'ring-2 ring-offset-1 ring-[#FF7A66]' : ''}`}
          >
            <span className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-white/20">{initials(c.created_by_name)}</span>
            {replies > 0 && <span>{replies + 1}</span>}
          </button>
        );
      })}
      {draft && canPost && (
        <div
          data-pin-ui
          style={{ left: Math.max(0, Math.min(draft.left, width - 290)), top: draft.top + 8 }}
          className="absolute z-30 w-[280px] p-3 bg-white border border-[#D3DCEE] rounded-[12px] shadow-[0_12px_32px_rgba(11,26,59,0.2)] text-xs text-[#122654]"
        >
          <div className="text-[10px] text-[#4A5878] truncate mb-1.5">On {draft.anchor.label}</div>
          <div className="flex gap-1 mb-2" role="radiogroup" aria-label="Kind of comment">
            {(Object.keys(TYPE_TONE) as CommentType[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={draft.type === t} onClick={() => setDraft({ ...draft, type: t })} className={`px-2 py-1 rounded-full text-[10px] font-bold border ${draft.type === t ? `${TYPE_TONE[t].chip} border-transparent` : 'border-[#E3E7EF] text-[#4A5878]'}`}>
                {TYPE_TONE[t].label}
              </button>
            ))}
          </div>
          <textarea
            autoFocus
            aria-label="Comment"
            rows={3}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDraft(null);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
            }}
            placeholder="Write a comment… @name to tag"
            className="w-full p-2 border border-[#D3DCEE] rounded-[8px] outline-none focus:border-[#FF7A66]"
          />
          <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#4A5878]">
            Keep
            <select aria-label="How long to keep this comment" value={draft.keep} onChange={(e) => setDraft({ ...draft, keep: e.target.value as CommentKeep })} className="flex-1 px-1.5 py-1 border border-[#D3DCEE] rounded-[6px] bg-white">
              {(Object.keys(KEEP_LABEL) as CommentKeep[]).map((k) => (
                <option key={k} value={k}>
                  {KEEP_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {draft.type === 'review_note' && <div className="mt-1 text-[10px] text-[#8A5A00]">A review note blocks sign-off until it is resolved.</div>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="px-2.5 py-1 font-bold text-[#4A5878]">
              Cancel
            </button>
            <button type="button" onClick={post} disabled={!draft.body.trim()} className="px-3 py-1 font-bold rounded-[8px] bg-[#FF7A66] text-[#0B1A3B] disabled:opacity-40">
              Post
            </button>
          </div>
        </div>
      )}
    </>
  );
}

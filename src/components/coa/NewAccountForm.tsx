'use client';

import { useEffect, useId, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { STANDARD_CHART } from '@/lib/standard-chart';
import { db } from '@/lib/server/db';
import { BlyntAccount } from '@/lib/types/models';
import { CATEGORIES, CoaCategory, accountsForClient, accountsIn, categoryOf, newAccount, newAccountBase, nextCode, similarAccounts } from '@/lib/coa';
import { papersForCode } from '@/lib/workpapers/common';
import { matchBlyntAccount } from '@/lib/mapping/auto-mapper';

const field = 'w-full py-1.5 px-2 border border-[#D3DCEE] rounded-lg bg-white text-xs text-[#122654]';

// The working papers a category's accounts are worked on, in chart order, and the accounts on each
const NO_PAPER = '';
const refsOf = (code: string) => papersForCode(code).map((t) => t.ref);
function papersIn(cat: CoaCategory) {
  const found = new Map<string, string>();
  let none = false;
  for (const a of accountsIn(cat)) {
    const papers = papersForCode(a.code);
    if (!papers.length) none = true;
    for (const t of papers) if (!found.has(t.ref)) found.set(t.ref, `${t.ref} ${t.title}`);
  }
  return [...[...found].map(([ref, label]) => ({ ref, label })), ...(none ? [{ ref: NO_PAPER, label: 'None: shows in the accounts only' }] : [])];
}
const accountsOnPaper = (cat: CoaCategory, ref: string) => accountsIn(cat).filter((a) => (ref === NO_PAPER ? !refsOf(a.code).length : refsOf(a.code).includes(ref)));
// Every working paper any account is worked on, for choosing one outside the category
const ALL_PAPERS = [...new Map(CATEGORIES.flatMap(papersIn).map((p) => [p.ref, p])).values()].sort((a, b) => (a.ref === NO_PAPER ? 1 : b.ref === NO_PAPER ? -1 : a.ref.localeCompare(b.ref)));

/**
 * Creates a practice account: the name recommends a category, the code is the next free number
 * in that category's range and cannot leave it. Nothing is created until the user approves it.
 */
export function NewAccountForm({ firmId, clientId, initialName = '', initialBase, onCreated, onCancel, onUseExisting }: { firmId: string; clientId?: string; initialName?: string; initialBase?: string; onCreated: (acc: BlyntAccount) => void; onCancel: () => void; onUseExisting?: (code: string) => void }) {
  const recommend = (n: string) => {
    const rec = newAccountBase(n) ?? (n.trim() ? matchBlyntAccount(n)?.blynt_code : null);
    const cat = (rec && categoryOf(rec)) || CATEGORIES.find((c) => c.other === '4990')!;
    return { cat: CATEGORIES.indexOf(cat), base: rec && categoryOf(rec) ? rec : cat.other };
  };
  // A suggested "works like" account (from the AI) is the starting point; otherwise the name decides
  const given = initialBase ? categoryOf(initialBase) : undefined;
  const first = given ? { cat: CATEGORIES.indexOf(given), base: initialBase! } : recommend(initialName);
  const [name, setName] = useState(initialName);
  const [catIdx, setCatIdx] = useState(first.cat);
  const [base, setBase] = useState(first.base);
  const [paper, setPaper] = useState(refsOf(first.base)[0] ?? NO_PAPER);
  const [suggestion, setSuggestion] = useState<'loading' | 'none' | { base: string; reason: string; ai: boolean } | null>(null);
  const [code, setCode] = useState(nextCode(db.blynt_accounts, CATEGORIES[first.cat], first.base) ?? '');
  const [touched, setTouched] = useState(!!given);
  const [error, setError] = useState('');
  const cat = CATEGORIES[catIdx];
  const paperOptions = papersIn(cat);
  const sameKind = accountsOnPaper(cat, paper);
  const baseAccount = db.blynt_accounts.find((a) => a.code === base);
  const paperId = useId();
  const similar = similarAccounts(accountsForClient(db.blynt_accounts, db.clients.find((c) => c.id === clientId)), name);

  // The working paper follows the account it is treated like, unless a paper was chosen that the account is also on
  const choose = (idx: number, b: string, ref?: string) => {
    setCatIdx(idx);
    setBase(b);
    setPaper(ref ?? refsOf(b)[0] ?? NO_PAPER);
    setCode(nextCode(db.blynt_accounts, CATEGORIES[idx], b) ?? '');
    setError('');
  };
  // Picking a paper treats the account like the category's general account when that is on it, else the paper's first
  // A paper from another category moves the account to the category of that paper's first account, so its code range fits
  const choosePaper = (ref: string) => {
    setTouched(true);
    const onIt = accountsOnPaper(cat, ref);
    const b = onIt.find((a) => a.code === base) ?? onIt.find((a) => a.code === cat.other) ?? onIt[0];
    if (b) return choose(catIdx, b.code, ref);
    for (const [i, c] of CATEGORIES.entries()) {
      const there = accountsOnPaper(c, ref);
      const pick = there.find((a) => a.code === c.other) ?? there[0];
      if (pick) return choose(i, pick.code, ref);
    }
  };
  // Ask once the name settles. A suggested practice account stands for the standard account it works like.
  useEffect(() => {
    const n = name.trim();
    if (!n) return setSuggestion(null);
    let stale = false;
    setSuggestion('loading');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/ai/suggest-mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n, all: true }) });
        const body = await res.json();
        if (stale) return;
        const code: string | null = body.suggested_blynt_code ?? body.new_account?.parent_code ?? null;
        const std = code ? (db.blynt_accounts.find((a) => a.code === code)?.parent_code ?? code) : null;
        setSuggestion(res.ok && std && categoryOf(std) && STANDARD_CHART.some((a) => a.code === std) ? { base: std, reason: String(body.reason ?? ''), ai: body.source === 'ai' } : 'none');
      } catch {
        if (!stale) setSuggestion('none');
      }
    }, 600);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [name]);
  const useSuggestion = () => {
    if (!suggestion || typeof suggestion === 'string') return;
    setTouched(true);
    choose(CATEGORIES.indexOf(categoryOf(suggestion.base)!), suggestion.base);
  };

  const onName = (n: string) => {
    setName(n);
    if (!touched) {
      const r = recommend(n);
      choose(r.cat, r.base);
    }
  };
  const save = () => {
    if (Number(code) < cat.from || Number(code) > cat.to) return setError(`Use a code from ${cat.from} to ${cat.to} for ${cat.name}.`);
    const acc = newAccount(db.blynt_accounts, code, name, firmId, base, clientId);
    if (typeof acc === 'string') return setError(acc);
    db.blynt_accounts.push(acc);
    onCreated(acc);
  };

  return (
    <div className="p-3 border border-[#D3DCEE] rounded-xl bg-[#F5F8FD] space-y-2 text-[11px] text-[#4A5878]">
      <label className="block space-y-1">
        <span className="font-semibold">Account name</span>
        <input autoFocus value={name} onChange={(e) => onName(e.target.value)} placeholder="e.g. Website hosting" className={field} />
      </label>
      {similar.length > 0 && (
        <div role="status" className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[#122654] space-y-1">
          <p className="font-semibold">Similar accounts already exist. Check before adding another:</p>
          {similar.map((a) => (
            <div key={a.code} className="flex items-center justify-between gap-2">
              <span>{a.code} {a.name}</span>
              {onUseExisting && <button type="button" onClick={() => onUseExisting(a.code)} aria-label={`Use ${a.code} ${a.name}`} className="font-bold text-[#B8432F] hover:underline shrink-0">Use</button>}
            </div>
          ))}
        </div>
      )}
      <label className="block space-y-1">
        <span className="font-semibold">Category {!touched && name.trim() && <span className="text-[#0B6B52]">(recommended)</span>}</span>
        <select value={catIdx} onChange={(e) => { setTouched(true); choose(Number(e.target.value), CATEGORIES[Number(e.target.value)].other); }} className={field}>
          {CATEGORIES.map((c, i) => (
            <option key={c.name} value={i}>{c.from}–{c.to} {c.name}</option>
          ))}
        </select>
      </label>
      <div className="space-y-1">
        <label htmlFor={paperId} className="block font-semibold">Working paper</label>
        <select id={paperId} value={paper} onChange={(e) => choosePaper(e.target.value)} className={field}>
          <optgroup label={`For ${cat.name}`}>
            {paperOptions.map((p) => (
              <option key={p.ref || 'none'} value={p.ref}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="Other working papers (moves the category)">
            {ALL_PAPERS.filter((p) => !paperOptions.some((o) => o.ref === p.ref)).map((p) => (
              <option key={p.ref || 'none'} value={p.ref}>{p.label}</option>
            ))}
          </optgroup>
        </select>
      </div>
      {/* The account it is treated like sets debit or credit, the line in the accounts and the tax treatment */}
      <label className="block space-y-1">
        <span className="font-semibold">Treated like</span>
        <select
          aria-label="Treated like"
          value={base}
          onChange={(e) => {
            setTouched(true);
            choose(catIdx, e.target.value, paper);
          }}
          className={field}
        >
          {/* The current one stays listed even when it isn't on the paper, so the box never shows a different account */}
          {[...(sameKind.some((a) => a.code === base) || !baseAccount ? [] : [baseAccount]), ...sameKind].map((a) => (
            <option key={a.code} value={a.code}>{a.code} {a.name}</option>
          ))}
        </select>
        <span className="block">Sets debit or credit, where it shows in the accounts, and its tax treatment.</span>
      </label>
      {/* AI (or, without it, the mapping rules) on where an account with this name belongs; nothing changes until Use */}
      {name.trim() && (
        <div role="status" aria-live="polite" className="p-2 rounded-lg bg-[#FFF8F6] border border-[#FF7A66]/30 text-[#122654]">
          {suggestion === 'loading' ? (
            <span className="flex items-center gap-1.5 text-[#4A5878]">
              <Sparkles className="w-3.5 h-3.5 text-[#B8432F] animate-pulse" aria-hidden="true" /> Asking the AI where this account belongs…
            </span>
          ) : suggestion && suggestion !== 'none' ? (
            <div className="flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#B8432F]" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold">{suggestion.ai ? 'AI suggests' : 'Suggested'}:</span> treat it like{' '}
                <span className="font-semibold">
                  {suggestion.base} {db.blynt_accounts.find((a) => a.code === suggestion.base)?.name}
                </span>
                {' '}on {papersForCode(suggestion.base)[0] ? `${papersForCode(suggestion.base)[0].ref} ${papersForCode(suggestion.base)[0].title}` : 'no working paper'}.
                {suggestion.reason && <span className="block text-[#4A5878] mt-0.5">{suggestion.reason}</span>}
              </div>
              {suggestion.base === base ? (
                <span className="shrink-0 font-semibold text-[#0B6B52]">In use</span>
              ) : (
                <button type="button" onClick={useSuggestion} className="shrink-0 font-bold text-[#B8432F] hover:underline">
                  Use this
                </button>
              )}
            </div>
          ) : (
            <span className="text-[#4A5878]">No suggestion for this name. Choose the working paper yourself.</span>
          )}
        </div>
      )}
      <label className="block space-y-1">
        <span className="font-semibold">Code (next free, {cat.from}–{cat.to})</span>
        <input type="number" min={cat.from} max={cat.to} value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} className={field} />
      </label>
      {error && <p role="alert" className="text-[#B8432F]">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="font-semibold">Cancel</button>
        <button type="button" onClick={save} disabled={!code || !name.trim()} className="px-3 py-1 rounded-lg bg-[#122654] text-white font-semibold disabled:opacity-50">Approve and create</button>
      </div>
    </div>
  );
}

'use client';

import { useId, useState } from 'react';
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
  const [changingBase, setChangingBase] = useState(false);
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
  const choosePaper = (ref: string) => {
    setTouched(true);
    const onIt = accountsOnPaper(cat, ref);
    const b = onIt.find((a) => a.code === base) ?? onIt.find((a) => a.code === cat.other) ?? onIt[0];
    if (b) choose(catIdx, b.code, ref);
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
        {paperOptions.length > 1 ? (
          <select id={paperId} value={paper} onChange={(e) => choosePaper(e.target.value)} className={field}>
            {paperOptions.map((p) => (
              <option key={p.ref || 'none'} value={p.ref}>{p.label}</option>
            ))}
          </select>
        ) : (
          <div id={paperId} className={`${field} bg-[#EEF1F6]`}>
            {paperOptions[0]?.label ?? 'None: shows in the accounts only'}
          </div>
        )}
        {/* The account it is treated like sets debit or credit, the line in the accounts and the tax treatment */}
        <div className="flex flex-wrap items-baseline gap-x-1.5" title="Sets debit or credit, where it shows in the accounts, and its tax treatment">
          <span>Treated like</span>
          <span className="font-semibold text-[#122654]">{base} {baseAccount?.name}</span>
          {sameKind.length > 1 && !changingBase && (
            <button type="button" onClick={() => setChangingBase(true)} className="font-semibold text-[#1D4E89] hover:underline">
              change
            </button>
          )}
        </div>
        {changingBase && sameKind.length > 1 && (
          <select
            aria-label="Treated like"
            value={base}
            onChange={(e) => {
              setTouched(true);
              choose(catIdx, e.target.value, paper);
            }}
            className={field}
          >
            {sameKind.map((a) => (
              <option key={a.code} value={a.code}>{a.code} {a.name}</option>
            ))}
          </select>
        )}
      </div>
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

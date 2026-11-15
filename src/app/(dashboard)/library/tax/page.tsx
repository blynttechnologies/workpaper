'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, ExternalLink, Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { ukDate } from '@/lib/dates';
import { BUILT_IN_TAX, TAX_KEYS, inForce, practiceTax, type TaxEntry, type TaxGroup } from '@/lib/tax';
import type { TaxWatch } from '@/lib/server/tax-watch';

const GROUPS: TaxGroup[] = ['VAT rates', 'VAT thresholds', 'VAT schemes', 'Flat rate percentages'];
const MANAGER_UP = ['manager', 'partner', 'admin'];
const today = () => new Date().toISOString().slice(0, 10);
const show = (t: TaxEntry) => (t.unit === '%' ? `${t.value}%` : `£${t.value.toLocaleString('en-GB')}`);
const dates = (t: TaxEntry) => (t.from && t.to ? `${ukDate(t.from)} to ${ukDate(t.to)}` : t.from ? `From ${ukDate(t.from)}` : t.to ? `To ${ukDate(t.to)}` : 'No end date');
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// The figures people reach for most, shown as tiles
const HEADLINE = ['vat.rate.standard', 'vat.rate.reduced', 'vat.threshold.registration', 'vat.threshold.deregistration'];
const govSlug = (source: string) => (source.startsWith('https://www.gov.uk/') ? new URL(source).pathname.split('/')[1] : '');

/**
 * Tax library (VAT first): the dated UK rates, thresholds and flat rate percentages Blynt and its AI read,
 * each with its source. Managers add the practice's own dated changes, which win for their dates. The GOV.UK
 * pages cited are checked every weekend; a changed page is flagged for a person to review.
 */
export default function TaxLibraryPage() {
  const actor = getActor();
  const canEdit = MANAGER_UP.includes(actor.role);
  const firmId = db.memberships.find((m) => m.user_id === actor.id)?.firm_id;
  const [rev, setRev] = useState(0);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<TaxGroup | 'all'>('all');
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [watch, setWatch] = useState<TaxWatch | null>(() => db.firms.find((f) => f.id === firmId)?.settings?.tax_watch ?? null);
  const own = useMemo(() => practiceTax(firmId), [firmId, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = today();
  const q = search.trim().toLowerCase();
  const isCurrent = (t: TaxEntry) => inForce(t.key, now, firmId)?.id === t.id;
  const all = [...own, ...BUILT_IN_TAX];
  const matching = all.filter((t) => (!q || t.label.toLowerCase().includes(q)) && (history || isCurrent(t) || (t.from ?? '') > now));
  const changedPages = watch ? Object.entries(watch.pages).filter(([, p]) => p.changed) : [];
  const changedSlugs = new Set(changedPages.flatMap(([slug, p]) => [slug, ...(p.cited ?? [])]));

  const remove = async (t: TaxEntry) => {
    if (!window.confirm(`Remove the practice entry for ${t.label} (${show(t)}, ${dates(t)})?`)) return;
    const res = await fetch(`/api/v1/tax-library?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not remove it.');
    setRev((r) => r + 1);
  };

  const watchCall = async (method: 'POST' | 'PATCH', body?: unknown) => {
    setError('');
    if (method === 'POST') setChecking(true);
    try {
      const res = await fetch('/api/v1/tax-library/watch', { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return setError(out.error || 'Could not reach GOV.UK. Try again.');
      setWatch(out.watch);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#122654]">Tax library</h1>
          <p className="text-xs text-[#4A5878] mt-1 max-w-2xl">
            UK VAT rates, thresholds and flat rate percentages, each dated with its source. Blynt uses what applied at a client&apos;s period end; a change is added as a new dated entry.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold rounded-lg cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add a dated change
          </button>
        )}
      </div>

      {/* Weekly GOV.UK check */}
      <section aria-label="GOV.UK check" className={`rounded-xl border p-3.5 ${changedPages.length ? 'bg-[#FFF8E6] border-[#E8C26A]' : 'bg-white border-[#E3E7EF]'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${changedPages.length ? 'bg-[#FFF1D6] text-[#8A5A00]' : 'bg-[#E6F4EF] text-[#0B6B52]'}`}>
            {changedPages.length ? <AlertTriangle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-[200px]">
            <p className="text-xs font-bold text-[#122654]">
              {changedPages.length
                ? `GOV.UK changed ${changedPages.length} source page${changedPages.length === 1 ? '' : 's'}: check the figures`
                : watch
                  ? `Up to date with GOV.UK · ${Object.keys(watch.pages).length} source pages unchanged`
                  : 'Checked against GOV.UK every weekend'}
            </p>
            <p className="text-[11px] text-[#4A5878]">
              {watch ? `Last checked ${when(watch.checked_at)} · checked again every weekend` : 'Not checked yet: the first weekend run records where each page stands.'}
              {watch?.failed?.length ? ` · could not reach ${watch.failed.join(', ')}` : ''}
            </p>
          </div>
          {canEdit && (
            <button type="button" onClick={() => watchCall('POST')} disabled={checking} className="inline-flex items-center gap-1.5 min-h-[32px] px-3 bg-white border border-[#D3DCEE] hover:border-[#122654] rounded-lg text-[11px] font-bold text-[#122654] cursor-pointer disabled:opacity-60">
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Check now
            </button>
          )}
        </div>
        {changedPages.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {changedPages.map(([slug, p]) => (
              <li key={slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-white border border-[#F0DDB0] text-xs">
                <span className="flex-1 min-w-0 text-[#122654]">
                  <strong>{p.title}</strong> <span className="text-[#4A5878]">updated on GOV.UK {ukDate(p.gov_updated_at.slice(0, 10))}</span>
                </span>
                <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#1D4E89] hover:underline">
                  Open page <ExternalLink className="w-3 h-3" />
                </a>
                {canEdit && (
                  <button type="button" onClick={() => watchCall('PATCH', { slug })} className="font-semibold text-[#0B6B52] hover:underline cursor-pointer">
                    Mark as checked
                  </button>
                )}
              </li>
            ))}
            <li className="text-[11px] text-[#6B4700]">If a figure moved, use Add a dated change. Nothing changes until someone adds it.</li>
          </ul>
        )}
      </section>

      {/* In force today */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {HEADLINE.map((key) => {
          const t = inForce(key, now, firmId);
          if (!t) return null;
          return (
            <div key={key} className="bg-white border border-[#E3E7EF] rounded-xl px-4 py-3">
              <p className="text-[10px] text-[#4A5878] truncate">{t.label.replace(/ \(.*\)$/, '')}</p>
              <p className="text-xl font-extrabold text-[#122654] font-mono-numbers">{show(t)}</p>
              <p className="text-[10px] text-[#0B6B52] font-semibold">In force · {t.from ? `since ${ukDate(t.from)}` : 'no end date'}</p>
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-xs text-[#B42318] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {adding && <AddEntry onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRev((r) => r + 1); }} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Tax groups" className="flex flex-wrap gap-1.5">
          {(['all', ...GROUPS] as const).map((g) => {
            const n = matching.filter((t) => g === 'all' || t.group === g).length;
            return (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={group === g}
                onClick={() => setGroup(g)}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold cursor-pointer ${group === g ? 'bg-[#122654] border-[#122654] text-white' : 'bg-white border-[#D3DCEE] text-[#4A5878] hover:border-[#122654]'}`}
              >
                {g === 'all' ? 'All' : g} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#4A5878] cursor-pointer">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="accent-[#122654]" /> Show past rates
        </label>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#7E8DA6] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, e.g. catering, threshold" aria-label="Search the tax library" className="min-h-[32px] pl-8 pr-3 text-xs bg-white border border-[#D3DCEE] rounded-lg w-60 max-w-full" />
        </div>
      </div>

      {/* Tables */}
      {GROUPS.filter((g) => group === 'all' || group === g).map((g) => {
        const list = matching.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={g} className="bg-white border border-[#E3E7EF] rounded-xl overflow-x-auto">
            <h2 className="px-4 pt-3 pb-2 text-sm font-bold text-[#122654]">
              {g} <span className="text-[11px] font-semibold text-[#7E8DA6]">{list.length}</span>
            </h2>
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F5F8FD] text-[10px] uppercase tracking-wider text-[#4A5878]">
                <tr>
                  <th className="py-1.5 px-4">Item</th>
                  <th className="py-1.5 px-3 text-right">Rate or limit</th>
                  <th className="py-1.5 px-3">Applies</th>
                  <th className="py-1.5 px-3">Source</th>
                  <th className="py-1.5 px-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F9] text-[#122654]">
                {list.map((t) => {
                  const current = isCurrent(t);
                  const future = (t.from ?? '') > now;
                  const flagged = changedSlugs.has(govSlug(t.source));
                  return (
                    <tr key={t.id} className={current || future ? '' : 'text-[#7E8DA6]'}>
                      <td className="py-1.5 px-4">
                        {t.label}
                        {t.added_by && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EAF5FC] text-[#1D4E89]">Practice: {t.added_by}</span>}
                        {flagged && current && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FFF1D6] text-[#8A5A00]">Source changed: check</span>}
                        {t.note && <span className="block text-[10px] text-[#8A5A00]">{t.note}</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono font-bold">{show(t)}</td>
                      <td className="py-1.5 px-3 whitespace-nowrap">
                        {dates(t)}
                        {current && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#E6F4EF] text-[#0B6B52]">In force</span>}
                        {future && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EAF0FB] text-[#1D4E89]">Upcoming</span>}
                      </td>
                      <td className="py-1.5 px-3">
                        {t.source.startsWith('http') ? (
                          <a href={t.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1D4E89] hover:underline">
                            GOV.UK <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          t.source
                        )}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {canEdit && t.added_by && (
                          <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t.label} from ${dates(t)}`} className="p-1 text-[#4A5878] hover:text-[#B8432F] cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      {!matching.length && <p className="text-xs text-[#4A5878]">Nothing matches. Try another word, or tick Show past rates.</p>}
    </div>
  );
}

function AddEntry({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ key: '', value: '', from: today(), to: '', source: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = TAX_KEYS.find((t) => t.key === f.key);
  const input = 'min-h-[34px] px-2 text-xs bg-white border border-[#D3DCEE] rounded-[8px] w-full mt-1';
  const save = async () => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/v1/tax-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, value: Number(f.value), to: f.to || undefined }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || 'Could not save it.');
    onSaved();
  };
  return (
    <div className="bg-white border border-[#D3DCEE] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[#122654]">
      <label className="font-semibold sm:col-span-2">
        What changes
        <select aria-label="What changes" className={input} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}>
          <option value="">Choose…</option>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {TAX_KEYS.filter((t) => t.group === g).map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="font-semibold">
        New {base?.unit === '£' ? 'amount (£)' : 'rate (%)'}
        <input aria-label="New value" inputMode="decimal" className={input} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </label>
      <label className="font-semibold">
        Applies from
        <input type="date" aria-label="Applies from" className={input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
      </label>
      <label className="font-semibold">
        Applies to (optional)
        <input type="date" aria-label="Applies to" className={input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </label>
      <label className="font-semibold">
        Source
        <input aria-label="Source" placeholder="e.g. HMRC VAT Notice 733, or the GOV.UK link" className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
      </label>
      <label className="font-semibold sm:col-span-2">
        Note (optional)
        <input aria-label="Note" className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      {error && <p role="alert" className="sm:col-span-2 text-[#B42318]">{error}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-[34px] px-3 border border-[#D3DCEE] rounded-[8px] font-semibold cursor-pointer">Cancel</button>
        <button type="button" disabled={busy || !f.key || !f.value || !f.source.trim()} onClick={save} className="min-h-[34px] px-3 bg-[#122654] text-white rounded-[8px] font-bold cursor-pointer disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

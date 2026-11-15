'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { ukDate } from '@/lib/dates';
import { BUILT_IN_TAX, TAX_KEYS, inForce, practiceTax, type TaxEntry, type TaxGroup } from '@/lib/tax';

const GROUPS: TaxGroup[] = ['VAT rates', 'VAT thresholds', 'VAT schemes', 'Flat rate percentages'];
const MANAGER_UP = ['manager', 'partner', 'admin'];
const today = () => new Date().toISOString().slice(0, 10);
const show = (t: TaxEntry) => (t.unit === '%' ? `${t.value}%` : `£${t.value.toLocaleString('en-GB')}`);
const dates = (t: TaxEntry) => (t.from && t.to ? `${ukDate(t.from)} to ${ukDate(t.to)}` : t.from ? `From ${ukDate(t.from)}` : t.to ? `To ${ukDate(t.to)}` : 'No end date');

/**
 * Tax library (VAT first): the dated UK rates, thresholds and flat rate percentages Blynt and its AI read,
 * each with its source. Managers add the practice's own dated changes, which win for their dates.
 */
export default function TaxLibraryPage() {
  const actor = getActor();
  const canEdit = MANAGER_UP.includes(actor.role);
  const firmId = db.memberships.find((m) => m.user_id === actor.id)?.firm_id;
  const [rev, setRev] = useState(0);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const own = useMemo(() => practiceTax(firmId), [firmId, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = today();
  const q = search.trim().toLowerCase();
  const rows = [...own, ...BUILT_IN_TAX].filter((t) => !q || t.label.toLowerCase().includes(q));

  const remove = async (t: TaxEntry) => {
    if (!window.confirm(`Remove the practice entry for ${t.label} (${show(t)}, ${dates(t)})?`)) return;
    const res = await fetch(`/api/v1/tax-library?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not remove it.');
    setRev((r) => r + 1);
  };

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#122654]">Tax library</h1>
          <p className="text-xs text-[#4A5878] mt-1 max-w-2xl">
            UK VAT rates, thresholds and flat rate percentages, each dated and with its source. Blynt and its AI look up what applied at a client&apos;s period end, so a change is added as a new dated entry, never by editing the old one.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 min-h-[38px] px-4 bg-[#122654] text-white text-xs font-bold rounded-[10px] cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add a dated change
          </button>
        )}
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, e.g. catering, threshold, reduced" aria-label="Search the tax library" className="min-h-[38px] px-3 text-xs bg-white border border-[#D3DCEE] rounded-xl w-80 max-w-full" />
      {error && (
        <p role="alert" className="text-xs text-[#B42318] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {adding && <AddEntry onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRev((r) => r + 1); }} />}
      {GROUPS.map((g) => {
        const list = rows.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="bg-white border border-[#E3E7EF] rounded-[12px] overflow-x-auto">
            <h2 className="px-4 pt-3 pb-2 text-sm font-bold text-[#122654]">{g}</h2>
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F5F8FD] text-[10px] uppercase tracking-wider text-[#4A5878]">
                <tr>
                  <th className="py-2 px-4">Item</th>
                  <th className="py-2 px-3 text-right">Rate or limit</th>
                  <th className="py-2 px-3">Applies</th>
                  <th className="py-2 px-3">Source</th>
                  <th className="py-2 px-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E7EF] text-[#122654]">
                {list.map((t) => {
                  const current = inForce(t.key, now, firmId)?.id === t.id;
                  return (
                    <tr key={t.id} className={current ? '' : 'text-[#7E8DA6]'}>
                      <td className="py-2 px-4">
                        {t.label}
                        {t.added_by && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EAF5FC] text-[#1D4E89]">Practice: {t.added_by}</span>}
                        {t.note && <span className="block text-[10px] text-[#8A5A00]">{t.note}</span>}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold">{show(t)}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {dates(t)}
                        {current && <span className="ml-1.5 text-[10px] font-bold text-[#0B6B52]">in force</span>}
                      </td>
                      <td className="py-2 px-3">
                        {t.source.startsWith('http') ? (
                          <a href={t.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1D4E89] hover:underline">
                            GOV.UK <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          t.source
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
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
    <div className="bg-white border border-[#D3DCEE] rounded-[12px] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[#122654]">
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

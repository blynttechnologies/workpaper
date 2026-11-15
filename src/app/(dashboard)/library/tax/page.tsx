'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BadgePercent,
  Check,
  CloudDownload,
  ExternalLink,
  Gauge,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Trash2,
} from 'lucide-react';
import { db } from '@/lib/server/db';
import { getActor } from '@/lib/session';
import { ukDate } from '@/lib/dates';
import { BUILT_IN_TAX, TAX_KEYS, inForce, practiceTax, type TaxEntry, type TaxGroup } from '@/lib/tax';
import type { TaxWatch } from '@/lib/server/tax-watch';
import type { PulledFigure } from '@/lib/server/tax-pull';

const MANAGER_UP = ['manager', 'partner', 'admin'];
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (unit: '%' | '£', v: number) => (unit === '%' ? `${v}%` : `£${v.toLocaleString('en-GB')}`);
const show = (t: TaxEntry) => fmt(t.unit, t.value);
const dates = (t: TaxEntry) => (t.from && t.to ? `${ukDate(t.from)} to ${ukDate(t.to)}` : t.from ? `From ${ukDate(t.from)}` : t.to ? `To ${ukDate(t.to)}` : 'No end date');
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const HEADLINE = ['vat.rate.standard', 'vat.rate.reduced', 'vat.threshold.registration', 'vat.threshold.deregistration'];
const govSlug = (source: string) => (source.startsWith('https://www.gov.uk/') ? new URL(source).pathname.split('/')[1] : '');
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A66] focus-visible:ring-offset-1';

const CATEGORIES: { group: TaxGroup; icon: typeof Gauge; blurb: string }[] = [
  { group: 'VAT rates', icon: BadgePercent, blurb: 'Standard, reduced and zero rate' },
  { group: 'VAT thresholds', icon: Gauge, blurb: 'When to register or deregister' },
  { group: 'VAT schemes', icon: Layers, blurb: 'Flat rate, cash and annual limits' },
  { group: 'Flat rate percentages', icon: Store, blurb: 'The rate for each type of business' },
];

// Business types by sector, so 54 flat rates read as a few short lists (display only, not tax data)
const SECTORS: [string, string[]][] = [
  ['Professional and financial', ['accountancy', 'legal', 'management_consultancy', 'financial_services', 'architect_engineer_surveyor', 'secretarial', 'business_services', 'advertising']],
  ['IT, media and creative', ['it_consultancy', 'computer_repair', 'entertainment_journalism', 'film_tv_production', 'photography', 'publishing', 'printing']],
  ['Construction and property', ['general_building', 'labour_only_building', 'estate_agency', 'real_estate', 'hiring_goods']],
  ['Retail and wholesale', ['retail_food', 'retail_pharmacy', 'retail_other', 'retail_vehicles_fuel', 'wholesale_agricultural', 'wholesale_food', 'wholesale_other', 'post_offices']],
  ['Food, hospitality and leisure', ['catering', 'hotel_accommodation', 'pubs', 'sport_recreation', 'travel_agency', 'cultural']],
  ['Manufacturing and production', ['manufacturing_metal', 'manufacturing_food', 'manufacturing_other', 'manufacturing_textiles', 'packaging', 'mining_quarrying']],
  ['Farming and animals', ['agricultural_services', 'farming', 'forestry_fishing', 'animal_care', 'veterinary']],
  ['Personal and other services', ['hairdressing_beauty', 'laundry', 'repairing_personal_goods', 'repairing_vehicles', 'transport_storage', 'social_work', 'membership_organisation', 'investigation_security', 'other_activity']],
];
const sectorOf = (key: string) => SECTORS.find(([, keys]) => keys.includes(key.replace('vat.frs.', '')))?.[0] ?? 'Personal and other services';

/**
 * Tax library (VAT first): the dated UK rates, thresholds and flat rate percentages Blynt and its AI read, each
 * with its source, sorted into categories. Managers add the practice's own dated changes, which win for their
 * dates. The GOV.UK pages cited are checked every weekend, and Pull from GOV.UK sets today's GOV.UK figures beside
 * the library's so a person can add any that moved.
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
  const [pulling, setPulling] = useState(false);
  const [pull, setPull] = useState<{ pulled_at: string; figures: PulledFigure[]; hand_check: string[] } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const own = useMemo(() => practiceTax(firmId), [firmId, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = today();
  const q = search.trim().toLowerCase();
  const isCurrent = (t: TaxEntry) => inForce(t.key, now, firmId)?.id === t.id;
  const all = [...own, ...BUILT_IN_TAX];
  const visible = (t: TaxEntry) => history || isCurrent(t) || (t.from ?? '') > now;
  const matching = all.filter((t) => (!q || t.label.toLowerCase().includes(q)) && visible(t));
  const changedPages = watch ? Object.entries(watch.pages).filter(([, p]) => p.changed) : [];
  const changedSlugs = new Set(changedPages.flatMap(([slug, p]) => [slug, ...(p.cited ?? [])]));

  const remove = async (t: TaxEntry) => {
    if (!window.confirm(`Remove the practice entry for ${t.label} (${show(t)}, ${dates(t)})?`)) return;
    const res = await fetch(`/api/v1/tax-library?id=${encodeURIComponent(t.id)}`, { method: 'DELETE' });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not remove it.');
    setRev((r) => r + 1);
  };

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not reach GOV.UK. Try again.');
    return out;
  };

  const watchCall = async (method: 'POST' | 'PATCH', body?: unknown) => {
    setError('');
    if (method === 'POST') setChecking(true);
    try {
      setWatch((await call('/api/v1/tax-library/watch', method, body)).watch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const pullFromGov = async () => {
    setError('');
    setPulling(true);
    try {
      setPull(await call('/api/v1/tax-library/pull', 'POST'));
      setAdded([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPulling(false);
    }
  };

  // A figure GOV.UK states differently becomes a dated practice entry from today, through the audited route
  const addFromGov = async (f: PulledFigure) => {
    setError('');
    try {
      await call('/api/v1/tax-library', 'POST', { key: f.key, value: f.gov, from: now, source: f.source, note: `Pulled from GOV.UK on ${ukDate(now)}` });
      setAdded((a) => [...a, f.key]);
      setRev((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const differs = pull?.figures.filter((f) => f.status === 'differs') ?? [];

  return (
    <div className="flex flex-col gap-5 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#122654]">Tax library</h1>
          <p className="text-sm text-[#4A5878] mt-1 max-w-2xl">
            UK VAT rates, thresholds, scheme limits and flat rate percentages. Each figure is dated with its source, and Blynt uses the one that applied at a client&apos;s period end.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={pullFromGov} disabled={pulling} className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 bg-white border border-[#122654] text-[#122654] text-sm font-bold rounded-lg cursor-pointer hover:bg-[#F5F8FD] disabled:opacity-60 ${focus}`}>
              {pulling ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CloudDownload className="w-4 h-4" aria-hidden="true" />}
              {pulling ? 'Pulling from GOV.UK…' : 'Pull from GOV.UK'}
            </button>
            <button type="button" onClick={() => setAdding(true)} className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 bg-[#122654] hover:bg-[#0B1A3B] text-white text-sm font-bold rounded-lg cursor-pointer ${focus}`}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Add a dated change
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-[#B42318] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4" aria-hidden="true" /> {error}
        </p>
      )}

      {/* Pull from GOV.UK: today's figures beside the library's */}
      {pull && (
        <section aria-labelledby="pull-heading" className="bg-white border border-[#E3E7EF] rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <h2 id="pull-heading" className="text-base font-bold text-[#122654]">GOV.UK figures, {when(pull.pulled_at)}</h2>
              <p className="text-sm text-[#4A5878]" role="status">
                {pull.figures.length} figures read ·{' '}
                {differs.length ? <strong className="text-[#8A5A00]">{differs.length} differ from the library</strong> : <strong className="text-[#0B6B52]">all match the library</strong>}
                {pull.figures.some((f) => f.status === 'unread') && ` · ${pull.figures.filter((f) => f.status === 'unread').length} could not be read`}
              </p>
            </div>
            <button type="button" onClick={() => setPull(null)} className={`text-sm font-semibold text-[#4A5878] hover:text-[#122654] cursor-pointer ${focus}`}>Close</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">GOV.UK figures compared with the tax library</caption>
              <thead className="bg-[#F5F8FD] text-xs text-[#4A5878]">
                <tr>
                  <th scope="col" className="py-2 px-3 font-semibold">Figure</th>
                  <th scope="col" className="py-2 px-3 font-semibold text-right">In the library</th>
                  <th scope="col" className="py-2 px-3 font-semibold text-right">On GOV.UK</th>
                  <th scope="col" className="py-2 px-3 font-semibold">Result</th>
                  <th scope="col" className="py-2 px-3"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F9] text-[#122654]">
                {pull.figures.map((f) => (
                  <tr key={f.key}>
                    <th scope="row" className="py-2 px-3 font-medium">
                      <a href={f.source} target="_blank" rel="noreferrer" className={`hover:underline ${focus}`}>{f.label}<span className="sr-only"> (opens GOV.UK)</span></a>
                    </th>
                    <td className="py-2 px-3 text-right font-mono">{f.library === null ? '—' : fmt(f.unit, f.library)}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold">{f.gov === null ? '—' : fmt(f.unit, f.gov)}</td>
                    <td className="py-2 px-3">
                      {f.status === 'match' && <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-[#E6F4EF] text-[#0B6B52]"><Check className="w-3 h-3" aria-hidden="true" /> Matches</span>}
                      {f.status === 'differs' && <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-[#FFF1D6] text-[#8A5A00]"><AlertTriangle className="w-3 h-3" aria-hidden="true" /> Differs</span>}
                      {f.status === 'unread' && <span className="text-xs font-semibold text-[#4A5878]">Couldn&apos;t read: check the page</span>}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {f.status === 'differs' &&
                        (added.includes(f.key) ? (
                          <span className="text-xs font-bold text-[#0B6B52]">Added from today</span>
                        ) : (
                          <button type="button" onClick={() => addFromGov(f)} className={`text-xs font-bold px-2.5 py-1 rounded-md bg-[#122654] text-white cursor-pointer hover:bg-[#0B1A3B] ${focus}`}>
                            Add as dated change
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[#4A5878]">
            Check by hand (not on GOV.UK in a readable form): {pull.hand_check.join(' · ')}. Adding a figure creates a dated entry from today; nothing changes until someone adds it.
          </p>
        </section>
      )}

      {/* Weekly GOV.UK check */}
      <section aria-label="GOV.UK check" className={`rounded-xl border p-4 ${changedPages.length ? 'bg-[#FFF8E6] border-[#E8C26A]' : 'bg-white border-[#E3E7EF]'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${changedPages.length ? 'bg-[#FFF1D6] text-[#8A5A00]' : 'bg-[#E6F4EF] text-[#0B6B52]'}`} aria-hidden="true">
            {changedPages.length ? <AlertTriangle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          </span>
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-[#122654]">
              {changedPages.length
                ? `GOV.UK changed ${changedPages.length} source page${changedPages.length === 1 ? '' : 's'}: check the figures`
                : watch
                  ? `Up to date with GOV.UK · ${Object.keys(watch.pages).length} source pages unchanged`
                  : 'Checked against GOV.UK every weekend'}
            </p>
            <p className="text-xs text-[#4A5878]">
              {watch ? `Last checked ${when(watch.checked_at)} · checked again every weekend` : 'Not checked yet: the first weekend run records where each page stands.'}
              {watch?.failed?.length ? ` · could not reach ${watch.failed.join(', ')}` : ''}
            </p>
          </div>
          {canEdit && (
            <button type="button" onClick={() => watchCall('POST')} disabled={checking} className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 bg-white border border-[#D3DCEE] hover:border-[#122654] rounded-lg text-xs font-bold text-[#122654] cursor-pointer disabled:opacity-60 ${focus}`}>
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />} Check pages now
            </button>
          )}
        </div>
        {changedPages.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {changedPages.map(([slug, p]) => (
              <li key={slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-white border border-[#F0DDB0] text-sm">
                <span className="flex-1 min-w-0 text-[#122654]">
                  <strong>{p.title}</strong> <span className="text-[#4A5878]">updated on GOV.UK {ukDate(p.gov_updated_at.slice(0, 10))}</span>
                </span>
                <a href={p.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-semibold text-[#1D4E89] hover:underline ${focus}`}>
                  Open page <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
                {canEdit && (
                  <button type="button" onClick={() => watchCall('PATCH', { slug })} className={`font-semibold text-[#0B6B52] hover:underline cursor-pointer ${focus}`}>
                    Mark as checked
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* In force today */}
      <section aria-label="In force today" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {HEADLINE.map((key) => {
          const t = inForce(key, now, firmId);
          if (!t) return null;
          return (
            <div key={key} className="bg-white border border-[#E3E7EF] rounded-xl px-4 py-3">
              <p className="text-xs text-[#4A5878] truncate">{t.label.replace(/ \(.*\)$/, '')}</p>
              <p className="text-2xl font-extrabold text-[#122654] font-mono-numbers">{show(t)}</p>
              <p className="text-xs text-[#0B6B52] font-semibold">In force · {t.from ? `since ${ukDate(t.from)}` : 'no end date'}</p>
            </div>
          );
        })}
      </section>

      {adding && <AddEntry onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setRev((r) => r + 1); }} />}

      {/* Categories */}
      <nav aria-label="Tax categories" className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <button
          type="button"
          aria-pressed={group === 'all'}
          onClick={() => setGroup('all')}
          className={`text-left p-3 rounded-xl border cursor-pointer ${focus} ${group === 'all' ? 'bg-[#122654] border-[#122654] text-white' : 'bg-white border-[#E3E7EF] text-[#122654] hover:border-[#122654]'}`}
        >
          <span className="block text-sm font-bold">All categories</span>
          <span className={`block text-xs ${group === 'all' ? 'text-white/75' : 'text-[#4A5878]'}`}>{matching.length} figures</span>
        </button>
        {CATEGORIES.map(({ group: g, icon: Icon, blurb }) => {
          const n = matching.filter((t) => t.group === g).length;
          const on = group === g;
          return (
            <button
              key={g}
              type="button"
              aria-pressed={on}
              onClick={() => setGroup(g)}
              className={`text-left p-3 rounded-xl border cursor-pointer ${focus} ${on ? 'bg-[#122654] border-[#122654] text-white' : 'bg-white border-[#E3E7EF] text-[#122654] hover:border-[#122654]'}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> {g}
                <span className={`ml-auto text-xs font-semibold ${on ? 'text-white/75' : 'text-[#7E8DA6]'}`}>{n}</span>
              </span>
              <span className={`block text-xs mt-0.5 ${on ? 'text-white/75' : 'text-[#4A5878]'}`}>{blurb}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-[#7E8DA6] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, e.g. catering, threshold" aria-label="Search the tax library" className={`w-full min-h-[40px] pl-9 pr-3 text-sm bg-white border border-[#D3DCEE] rounded-lg ${focus}`} />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-[#4A5878] cursor-pointer">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="w-4 h-4 accent-[#122654]" /> Show past rates
        </label>
      </div>

      {/* Tables by category; flat rates split by sector */}
      {CATEGORIES.filter(({ group: g }) => group === 'all' || group === g).map(({ group: g, icon: Icon }) => {
        const list = matching.filter((t) => t.group === g);
        if (!list.length) return null;
        const blocks = g === 'Flat rate percentages' ? SECTORS.map(([s]) => [s, list.filter((t) => sectorOf(t.key) === s)] as const).filter(([, l]) => l.length) : [[null, list] as const];
        return (
          <section key={g} aria-labelledby={`cat-${g.replace(/\W+/g, '-')}`} className="bg-white border border-[#E3E7EF] rounded-xl overflow-hidden">
            <h2 id={`cat-${g.replace(/\W+/g, '-')}`} className="flex items-center gap-2 px-4 pt-4 pb-2 text-base font-bold text-[#122654]">
              <Icon className="w-4 h-4 text-[#1D4E89]" aria-hidden="true" /> {g} <span className="text-xs font-semibold text-[#7E8DA6]">{list.length}</span>
            </h2>
            {blocks.map(([sector, rows]) => (
              <div key={sector ?? g} className="overflow-x-auto">
                {sector && <h3 className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[#4A5878]">{sector}</h3>}
                <table className="w-full text-sm text-left">
                  <caption className="sr-only">{sector ? `${g}: ${sector}` : g}</caption>
                  <thead className="bg-[#F5F8FD] text-xs text-[#4A5878]">
                    <tr>
                      <th scope="col" className="py-2 px-4 font-semibold">Item</th>
                      <th scope="col" className="py-2 px-3 font-semibold text-right">Rate or limit</th>
                      <th scope="col" className="py-2 px-3 font-semibold">Applies</th>
                      <th scope="col" className="py-2 px-3 font-semibold">Source</th>
                      <th scope="col" className="py-2 px-3"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F9] text-[#122654]">
                    {rows.map((t) => {
                      const current = isCurrent(t);
                      const future = (t.from ?? '') > now;
                      const flagged = changedSlugs.has(govSlug(t.source));
                      return (
                        <tr key={t.id} className={current || future ? '' : 'text-[#4A5878]'}>
                          <th scope="row" className="py-2 px-4 font-normal">
                            {t.label}
                            {t.added_by && <span className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded-full bg-[#EAF5FC] text-[#1D4E89]">Practice: {t.added_by}</span>}
                            {flagged && current && <span className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded-full bg-[#FFF1D6] text-[#8A5A00]">Source changed: check</span>}
                            {t.note && <span className="block text-xs text-[#8A5A00]">{t.note}</span>}
                          </th>
                          <td className="py-2 px-3 text-right font-mono font-bold">{show(t)}</td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {dates(t)}
                            {current && <span className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full bg-[#E6F4EF] text-[#0B6B52]">In force</span>}
                            {future && <span className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full bg-[#EAF0FB] text-[#1D4E89]">Upcoming</span>}
                            {!current && !future && <span className="ml-1.5 text-xs font-semibold text-[#4A5878]">Past</span>}
                          </td>
                          <td className="py-2 px-3">
                            {t.source.startsWith('http') ? (
                              <a href={t.source} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-[#1D4E89] hover:underline ${focus}`}>
                                GOV.UK <ExternalLink className="w-3 h-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                              </a>
                            ) : (
                              t.source
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {canEdit && t.added_by && (
                              <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t.label} from ${dates(t)}`} className={`p-1 text-[#4A5878] hover:text-[#B8432F] cursor-pointer ${focus}`}>
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        );
      })}
      {!matching.length && <p className="text-sm text-[#4A5878]">Nothing matches. Try another word, or tick Show past rates.</p>}
    </div>
  );
}

function AddEntry({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ key: '', value: '', from: today(), to: '', source: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = TAX_KEYS.find((t) => t.key === f.key);
  const input = `min-h-[38px] px-2.5 text-sm bg-white border border-[#D3DCEE] rounded-lg w-full mt-1 ${focus}`;
  const save = async () => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/v1/tax-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, value: Number(f.value), to: f.to || undefined }) });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || 'Could not save it.');
    onSaved();
  };
  return (
    <section aria-label="Add a dated change" className="bg-white border border-[#D3DCEE] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-[#122654]">
      <label className="font-semibold sm:col-span-2">
        What changes
        <select className={input} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}>
          <option value="">Choose…</option>
          {CATEGORIES.map(({ group: g }) => (
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
        <input inputMode="decimal" className={input} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </label>
      <label className="font-semibold">
        Applies from
        <input type="date" className={input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
      </label>
      <label className="font-semibold">
        Applies to (optional)
        <input type="date" className={input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </label>
      <label className="font-semibold">
        Source
        <input placeholder="e.g. HMRC VAT Notice 733, or the GOV.UK link" className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
      </label>
      <label className="font-semibold sm:col-span-2">
        Note (optional)
        <input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      {error && <p role="alert" className="sm:col-span-2 text-[#B42318]">{error}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`min-h-[38px] px-3 border border-[#D3DCEE] rounded-lg font-semibold cursor-pointer ${focus}`}>Cancel</button>
        <button type="button" disabled={busy || !f.key || !f.value || !f.source.trim()} onClick={save} className={`min-h-[38px] px-4 bg-[#122654] text-white rounded-lg font-bold cursor-pointer disabled:opacity-50 ${focus}`}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

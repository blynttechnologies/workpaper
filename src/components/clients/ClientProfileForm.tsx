'use client';

import { Notice } from '@/components/ui/Notice';
import { useState } from 'react';
import { Check, CheckCircle2, Loader2, Save } from 'lucide-react';
import { db } from '@/lib/server/db';
import { useCompany } from '@/context/CompanyContext';
import { packForClient } from '@/lib/workpapers/templates';
import { Client, CompanyType } from '@/lib/types/models';
import { FLAT_RATE_CATEGORIES } from '@/lib/tax';

const COMPANY_TYPES: CompanyType[] = [
  'Sole trader',
  'Partnership',
  'LLP (FRS 102 + LLP SORP)',
  'Micro-entity (FRS 105)',
  'Small company (FRS 102 1A)',
  'Medium/large (FRS 102)',
  'IFRS company/group',
  'Charity (SORP)',
  'Academy trust',
];
const VAT_SCHEMES: [NonNullable<Client['vat_scheme']>, string][] = [
  ['standard', 'Standard'],
  ['flat_rate', 'Flat rate'],
  ['cash', 'Cash accounting'],
  ['annual', 'Annual accounting'],
];
const SERVICES: [NonNullable<Client['services']>[number], string][] = [
  ['year_end', 'Year-end accounts'],
  ['management', 'Management accounts'],
  ['vat', 'VAT returns'],
  ['payroll', 'Payroll'],
  ['quarterly', 'Quarterly insight packs'],
  ['corporation_tax', 'Corporation tax'],
];
const SIGNOFF: [string, string][] = [
  ['', 'Practice default'],
  ['1', 'Preparer only'],
  ['2', 'Preparer and reviewer'],
  ['3', 'Plus partner approval'],
];

const labelCls = 'text-[11px] font-semibold text-[#4A5878]';
const inputCls = 'min-h-[34px] px-2.5 text-xs bg-white border border-[#D3DCEE] rounded-lg text-[#122654] outline-none focus:border-[#1D4E89]';
const pill = (on: boolean) =>
  `inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
    on ? 'bg-[#122654] border-[#122654] text-white' : 'bg-white border-[#D3DCEE] text-[#4A5878] hover:border-[#122654] hover:text-[#122654]'
  }`;
// Two-option toggle: one bordered strip with the chosen side filled
const segment = 'inline-flex p-0.5 rounded-lg border border-[#D3DCEE] bg-[#F5F8FD]';
const segBtn = (on: boolean) =>
  `min-h-[30px] px-3 text-[11px] font-semibold rounded-md cursor-pointer transition-colors ${on ? 'bg-[#122654] text-white' : 'text-[#4A5878] hover:text-[#122654]'}`;

interface PaperChanges {
  engagement_id: string;
  added: string[];
  removed: string[];
  kept: string[];
}

/**
 * Client profile (Build Order step 2): entity type, company number, year end, VAT, payroll,
 * services, sign-off and team. Saving it decides which working papers the client's open
 * engagements carry; papers someone has started are never removed.
 */
export function ClientProfileForm({ client }: { client: Client }) {
  const { refreshCompanyData } = useCompany();
  const [f, setF] = useState({
    company_type: (client.company_type ?? 'Small company (FRS 102 1A)') as CompanyType,
    company_no: client.company_no ?? '',
    year_end: client.year_end ?? '',
    vat_registered: client.vat_registered ?? true,
    vat_scheme: client.vat_scheme ?? 'standard',
    vat_flat_rate_category: client.vat_flat_rate_category ?? '',
    vat_registered_on: client.vat_registered_on ?? '',
    payroll: client.payroll ?? true,
    services: client.services ?? ['year_end'],
    signoff_levels: client.signoff_levels ? String(client.signoff_levels) : '',
    team_user_ids: client.team_user_ids ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PaperChanges[] | null>(null);

  const team = db.users.filter((u) => db.memberships.some((m) => m.user_id === u.id && m.firm_id === client.firm_id));
  const roleOf = (userId: string) => db.memberships.find((m) => m.user_id === userId)?.role;
  const paperCount = packForClient(f).length;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`/api/v1/clients/${encodeURIComponent(client.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, signoff_levels: f.signoff_levels ? Number(f.signoff_levels) : null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not save the profile. Try again.');
        return;
      }
      setResult(body.papers ?? []);
      refreshCompanyData();
    } catch {
      setError('Could not reach Blynt. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const changed = result?.filter((p) => p.added.length || p.removed.length || p.kept.length) ?? [];

  return (
    <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-xs p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[#122654]">Client profile</h2>
          <p className="text-[11px] text-[#4A5878]">Your answers decide which working papers this client gets.</p>
        </div>
        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EAF0FB] text-[#1D4E89]">{paperCount} papers</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className={labelCls}>
          Entity type and standard
          <select className={`${inputCls} w-full mt-1`} value={f.company_type} onChange={(e) => setF({ ...f, company_type: e.target.value as CompanyType })}>
            {COMPANY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Company number
          <input className={`${inputCls} w-full mt-1`} value={f.company_no} onChange={(e) => setF({ ...f, company_no: e.target.value })} placeholder="e.g. 01234567" />
        </label>
        <label className={labelCls}>
          Year end
          {/* A date picker for a plain date; an older free-text value stays editable as text */}
          <input
            type={!f.year_end || /^\d{4}-\d{2}-\d{2}$/.test(f.year_end) ? 'date' : 'text'}
            className={`${inputCls} w-full mt-1`}
            value={f.year_end}
            onChange={(e) => setF({ ...f, year_end: e.target.value })}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <p className={labelCls}>VAT</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className={segment} role="radiogroup" aria-label="VAT registered">
              <button type="button" role="radio" aria-checked={f.vat_registered} className={segBtn(f.vat_registered)} onClick={() => setF({ ...f, vat_registered: true })}>Registered</button>
              <button type="button" role="radio" aria-checked={!f.vat_registered} className={segBtn(!f.vat_registered)} onClick={() => setF({ ...f, vat_registered: false })}>Not registered</button>
            </div>
            {f.vat_registered && (
              <>
                <select aria-label="VAT scheme" className={inputCls} value={f.vat_scheme} onChange={(e) => setF({ ...f, vat_scheme: e.target.value as Client['vat_scheme'] & string })}>
                  {VAT_SCHEMES.map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-[11px] text-[#4A5878]">
                  since
                  <input type="date" aria-label="VAT registered on" className={inputCls} value={f.vat_registered_on} onChange={(e) => setF({ ...f, vat_registered_on: e.target.value })} />
                </label>
              </>
            )}
          </div>
          {f.vat_registered && f.vat_scheme === 'flat_rate' && (
            <select aria-label="Flat rate business type" className={`${inputCls} w-full max-w-[420px]`} value={f.vat_flat_rate_category} onChange={(e) => setF({ ...f, vat_flat_rate_category: e.target.value })}>
              <option value="">Flat rate business type…</option>
              {FLAT_RATE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          )}
        </div>
        <div className="space-y-1.5">
          <p className={labelCls}>Payroll</p>
          <div className={segment} role="radiogroup" aria-label="Runs payroll">
            <button type="button" role="radio" aria-checked={f.payroll} className={segBtn(f.payroll)} onClick={() => setF({ ...f, payroll: true })}>Runs payroll</button>
            <button type="button" role="radio" aria-checked={!f.payroll} className={segBtn(!f.payroll)} onClick={() => setF({ ...f, payroll: false })}>No payroll</button>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className={labelCls}>Services you provide</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Services">
          {SERVICES.map(([k, l]) => (
            <button key={k} type="button" role="checkbox" aria-checked={f.services.includes(k)} className={pill(f.services.includes(k))} onClick={() => setF({ ...f, services: toggle(f.services, k) })}>
              {f.services.includes(k) && <Check className="w-3 h-3" aria-hidden="true" />}
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className={labelCls}>
          Sign-off
          <select className={`${inputCls} w-full mt-1`} value={f.signoff_levels} onChange={(e) => setF({ ...f, signoff_levels: e.target.value })}>
            {SIGNOFF.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <p className={`${labelCls} mb-1`}>Team</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Team">
            {team.map((u) => (
              <button key={u.id} type="button" role="checkbox" aria-checked={f.team_user_ids.includes(u.id)} className={pill(f.team_user_ids.includes(u.id))} onClick={() => setF({ ...f, team_user_ids: toggle(f.team_user_ids, u.id) })}>
                {f.team_user_ids.includes(u.id) && <Check className="w-3 h-3" aria-hidden="true" />}
                {u.name} <span className="opacity-70 capitalize">· {roleOf(u.id)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[#E3E7EF]">
        <button
          type="button"
          onClick={save}
          disabled={busy || Boolean(client.archived_at)}
          className="inline-flex items-center gap-1.5 min-h-[34px] px-3.5 bg-[#122654] hover:bg-[#0B1A3B] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save profile
        </button>
        <span className="text-[10px] text-[#7E8DA6]">Open engagements update to match. Papers already started are kept.</span>
      </div>

      {error && <Notice inline>{error}</Notice>}
      {result && (
        <div role="status" className="p-3 rounded-[10px] bg-[#E6F4EF] border border-[#0B6B52]/20 text-xs text-[#122654] space-y-1">
          <p className="font-semibold text-[#0B6B52] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Profile saved.
            {!changed.length && ' The working papers already match.'}
          </p>
          {changed.map((p) => (
            <p key={p.engagement_id}>
              {p.engagement_id}: {p.added.length ? `added ${p.added.join(', ')}. ` : ''}
              {p.removed.length ? `removed ${p.removed.join(', ')}. ` : ''}
              {p.kept.length ? `kept ${p.kept.join(', ')} (work already started).` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

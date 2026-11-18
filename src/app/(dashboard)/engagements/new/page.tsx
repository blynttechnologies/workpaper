'use client';

import { Notice } from '@/components/ui/Notice';
import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Building2, Check, ChevronLeft } from 'lucide-react';
import { db } from '@/lib/server/db';
import { Client, CompanyType } from '@/lib/types/models';
import { packForClient } from '@/lib/workpapers/templates';
import { useCompany } from '@/context/CompanyContext';
import { companyNumberError, structureFields, structureForCompanyType, UK_POSTCODE, UK_VAT } from '@/lib/practice-structure';
import { Frequency, FREQUENCY_MONTHS, periodStart as startOf } from '@/lib/periods';
import { TeamManager } from '@/components/settings/TeamManager';
import { ukDate } from '@/lib/dates';

/**
 * New engagement wizard (ENG-01), in the same adaptive style as practice set-up: each answer
 * shows what it changes. Client details (which decide the working papers), the period, the
 * team, then the data source; choosing Xero or QuickBooks connects straight after creating.
 */

const STEPS = ['Client details', 'Period', 'Team', 'Data source'];

type Source = 'xero' | 'quickbooks' | 'csv';
const SOURCES: [Source, string, string][] = [
  ['xero', 'Xero', 'Connect now and pull the trial balance straight from Xero'],
  ['quickbooks', 'QuickBooks Online', 'Connect now and pull the trial balance from QuickBooks'],
  ['csv', 'Manual upload', 'Upload a trial balance as CSV or Excel after set-up'],
];

const COMPANY_TYPES: [CompanyType, string, string][] = [
  ['Small company (FRS 102 1A)', 'FRS 102 Section 1A', 'Small UK limited companies'],
  ['Micro-entity (FRS 105)', 'FRS 105', 'Micro-entities, minimal disclosures'],
  ['Medium/large (FRS 102)', 'FRS 102 Full', 'Medium and large companies'],
  ['Sole trader', 'UK GAAP (Cash/Accruals)', 'Self-employed individuals'],
  ['Partnership', 'UK GAAP', 'Partnerships and profit shares'],
  ['LLP (FRS 102 + LLP SORP)', 'FRS 102 + LLP SORP', 'Limited liability partnerships'],
  ['IFRS company/group', 'UK-adopted IFRS', 'Groups and listed companies'],
  ['Charity (SORP)', 'Charities SORP (FRS 102)', 'Charities and funds'],
  ['Academy trust', 'Academies Accounts Direction', 'Academy trusts'],
];

const NEW_CLIENT = '__new__';
const BLANK = { trading_name: '', company_no: '', address_line: '', postcode: '', jurisdiction: 'england_wales', vat_number: '' };
const detailsOf = (c?: Client) => ({ ...BLANK, ...Object.fromEntries(Object.entries(c ?? {}).filter(([k, v]) => k in BLANK && typeof v === 'string')) }) as typeof BLANK;

const inputCls =
  'w-full min-h-[36px] px-3 text-xs bg-white border border-[#D3DCEE] rounded-lg text-[#122654] outline-none focus:border-[#FF7A66] focus:ring-2 focus:ring-[#FF7A66]/20 placeholder:text-[#9AA6BC]';

function Q({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] font-semibold text-[#4A5878] mt-4 mb-1">
      {children}
    </label>
  );
}

/** A short title, a one-line hint and an optional tag (the accounting standard) */
function Card({ on, title, sub, tag, onClick }: { on: boolean; title: string; sub: string; tag?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`relative text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
        on ? 'bg-[#EEF2F9] border-[#1D4E89] ring-1 ring-[#1D4E89]' : 'bg-white border-[#D3DCEE] hover:border-[#A6B4D0]'
      }`}
    >
      {on && (
        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-[#1D4E89] flex items-center justify-center">
          <Check className="w-2.5 h-2.5 text-white" />
        </span>
      )}
      <span className="block text-xs font-bold text-[#122654] pr-5 leading-snug">{title}</span>
      <span className="block text-[10px] text-[#4A5878] mt-0.5 leading-snug">{sub}</span>
      {tag && <span className="inline-block mt-1.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F5F8FD] border border-[#E3E7EF] text-[#4A5878]">{tag}</span>}
    </button>
  );
}

function YesNo({ value, yes, no, onChange, label }: { value: boolean; yes: string; no: string; onChange: (v: boolean) => void; label: string }) {
  const seg = (on: boolean) => `min-h-[30px] px-3 text-[11px] font-semibold rounded-md cursor-pointer transition-colors ${on ? 'bg-[#122654] text-white' : 'text-[#4A5878] hover:text-[#122654]'}`;
  return (
    <div className="inline-flex p-0.5 rounded-lg border border-[#D3DCEE] bg-[#F5F8FD]" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={value} className={seg(value)} onClick={() => onChange(true)}>{yes}</button>
      <button type="button" role="radio" aria-checked={!value} className={seg(!value)} onClick={() => onChange(false)}>{no}</button>
    </div>
  );
}

const FREQUENCIES: [Frequency, string, string][] = [
  ['year_end', 'Year-end', 'Annual accounts for the financial year'],
  ['quarterly', 'Quarterly', 'A file for each quarter'],
  ['monthly', 'Monthly', 'A file for each month'],
];
const END_LABEL: Record<Frequency, string> = { year_end: 'Year end', quarterly: 'Quarter end', monthly: 'Month end' };

// The ?client_id= link is read on the client, so it sits inside Suspense (see Next's useSearchParams docs)
export default function NewEngagementPage() {
  return (
    <Suspense fallback={null}>
      <NewEngagementWizard />
    </Suspense>
  );
}

function NewEngagementWizard() {
  const router = useRouter();
  const search = useSearchParams();
  const { setActiveCompanyId, refreshCompanyData } = useCompany();
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const activeClients = db.clients.filter((c) => !c.archived_at);
  // A new client unless opened from a client (a new year for them)
  const [clientId, setClientId] = useState(activeClients.find((c) => c.id === search.get('client_id'))?.id ?? NEW_CLIENT);
  const existing = activeClients.find((c) => c.id === clientId);
  const [name, setName] = useState('');
  const [type, setType] = useState<CompanyType>(existing?.company_type ?? 'Small company (FRS 102 1A)');
  const [vat, setVat] = useState(existing?.vat_registered ?? true);
  const [payroll, setPayroll] = useState(existing?.payroll ?? true);
  const [details, setDetails] = useState(detailsOf(existing));
  const [yearEnd, setYearEnd] = useState('2026-03-31');
  const [frequency, setFrequency] = useState<Frequency>('year_end');
  const [periodStart, setPeriodStart] = useState(startOf('2026-03-31', 12));
  const [team, setTeam] = useState<string[]>(existing?.team_user_ids ?? []);
  // Invitations ticked for this client; null until the Team step has loaded them
  const [invited, setInvited] = useState<string[] | null>(null);
  const assigned = team.length + (invited?.length ?? 0);
  const [source, setSource] = useState<Source>('csv');

  const isNew = clientId === NEW_CLIENT;
  const clientName = isNew ? name.trim() : existing?.name ?? '';
  const framework = COMPANY_TYPES.find((t) => t[0] === type)?.[1] ?? '';
  const papers = packForClient({ company_type: type, vat_registered: vat, payroll });
  const prior = db.engagements.find((e) => e.client_id === clientId && e.status === 'locked');
  const sourceName = SOURCES.find((s) => s[0] === source)?.[1];
  const structure = structureForCompanyType(type);
  const sf = structureFields(structure);
  const crnError = sf.companyNumber && details.company_no.trim() ? companyNumberError(structure, details.company_no, details.jurisdiction) : '';
  const postcodeError = details.postcode.trim() && !UK_POSTCODE.test(details.postcode.trim().toUpperCase()) ? 'Enter a valid UK postcode.' : '';
  const vatError = vat && details.vat_number.trim() && !UK_VAT.test(details.vat_number.replace(/\s/g, '').toUpperCase()) ? 'Enter a valid UK VAT number.' : '';
  const setD = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDetails({ ...details, [k]: e.target.value });

  const pickClient = (id: string) => {
    setClientId(id);
    const c = activeClients.find((x) => x.id === id);
    setType(c?.company_type ?? 'Small company (FRS 102 1A)');
    setVat(c?.vat_registered ?? true);
    setPayroll(c?.payroll ?? true);
    setDetails(detailsOf(c));
    setTeam(c?.team_user_ids ?? []);
    setInvited(null);
  };
  const setEnd = (end: string, f = frequency) => {
    setYearEnd(end);
    if (end) setPeriodStart(startOf(end, FREQUENCY_MONTHS[f]));
  };

  // One short line per step saying what the answers lead to
  const hint = [
    `${papers.length} working papers will be created under ${framework}.`,
    periodStart && yearEnd
      ? `${ukDate(periodStart)} to ${ukDate(yearEnd)}. ${prior ? 'Last year’s closing balances roll forward.' : 'First year for this client.'}`
      : '',
    assigned ? `${assigned} ${assigned === 1 ? 'person' : 'people'} assigned. Partners and admins see every client.` : 'No one assigned yet. Partners and admins see every client.',
    source === 'csv' ? 'You’ll upload the trial balance after creating.' : `You’ll sign in to ${sourceName} after creating.`,
  ][step];

  const go = (i: number) => {
    setError('');
    setStep(i);
    setFurthest((f) => Math.max(f, i));
  };

  const api = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Could not save. Try again.');
    return out;
  };

  const create = async () => {
    let id = clientId;
    if (isNew) id = (await api('/api/v1/clients', 'POST', { name: clientName, company_no: '', company_type: type, year_end: yearEnd, data_source: 'csv' })).id;
    // The profile saves the details and decides the papers; the engagement is then created from it
    try {
      await api(`/api/v1/clients/${encodeURIComponent(id)}`, 'PATCH', { ...details, company_type: type, year_end: yearEnd, vat_registered: vat, payroll, team_user_ids: team, ...(invited ? { team_invite_ids: invited } : {}) });
    } catch (e) {
      // Don't leave a half-made client behind when its details are refused
      if (isNew) await api(`/api/v1/clients/${encodeURIComponent(id)}/archive`, 'POST', { archived: true, reason: 'Set-up cancelled' }).catch(() => {});
      throw e;
    }
    const eng = await api('/api/v1/engagements', 'POST', {
      client_id: id,
      period_start: periodStart,
      period_end: yearEnd,
      framework,
      template_pack_id: `pack_${type.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      prior_engagement_id: prior?.id,
      frequency,
    });
    refreshCompanyData();
    setActiveCompanyId(id);
    // Straight on to the ledger sign-in; the callback brings the user back to the client page
    if (source === 'csv') router.push(`/engagements/${eng.id}/import`);
    else window.location.assign(`/api/v1/integrations/${source}/connect?clientId=${encodeURIComponent(id)}`);
  };

  const next = async () => {
    setError('');
    if (step === 0 && !clientName) return setError('Enter the client’s name.');
    if (step === 0 && (crnError || postcodeError || vatError)) return setError(crnError || postcodeError || vatError);
    if (step === 1 && (!periodStart || !yearEnd || periodStart >= yearEnd)) return setError(`Set a period start before the ${END_LABEL[frequency].toLowerCase()}.`);
    if (step < STEPS.length - 1) return go(step + 1);
    setSaving(true);
    try {
      await create();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const section = 'mt-5 pt-4 border-t border-[#EEF2F9]';

  return (
    <div className="flex flex-col gap-3 max-w-6xl mx-auto pb-16">
      <Link href="/clients" className="inline-flex items-center gap-1 text-xs font-semibold text-[#4A5878] hover:text-[#122654] self-start">
        <ChevronLeft className="w-4 h-4" /> Back to clients
      </Link>

      <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-2xs">
        {/* Stepper */}
        <div className="px-5 pt-4 pb-3 border-b border-[#EEF2F9]">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h1 className="text-base font-extrabold text-[#122654]">New engagement</h1>
            <span className="text-[11px] font-semibold text-[#4A5878]">Step {step + 1} of {STEPS.length}</span>
          </div>
          <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
            {STEPS.map((s, i) => {
              const done = i < step;
              const on = i === step;
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={i > furthest}
                    onClick={() => go(i)}
                    aria-current={on ? 'step' : undefined}
                    className="w-full text-left cursor-pointer disabled:cursor-default group"
                  >
                    <span className={`block h-1 rounded-full ${on ? 'bg-[#FF7A66]' : done ? 'bg-[#122654]' : 'bg-[#E3E7EF]'}`} />
                    <span className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold ${on ? 'text-[#122654]' : done ? 'text-[#122654] group-hover:underline' : 'text-[#9AA6BC]'}`}>
                      {done ? <Check className="w-3 h-3 text-[#0B6B52]" /> : <span className="font-mono">{i + 1}</span>}
                      <span className="truncate">{s}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div>
          {/* Step body */}
          <main className="px-5 py-5 min-w-0 max-w-4xl">
            {step === 0 && (
              <>
                <h2 className="text-lg font-bold text-[#122654]">Client details</h2>
                <p className="text-xs text-[#4A5878]">Who the client is. These answers decide the working papers.</p>

                {!isNew && (
                  <div className="mt-4 flex items-center gap-3 p-3 rounded-lg bg-[#F5F8FD] border border-[#E3E7EF]">
                    <span className="w-8 h-8 rounded-lg bg-[#122654] flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-[#FF7A66]" aria-hidden="true" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[10px] text-[#7E8DA6]">New period for</span>
                      <span className="block text-sm font-bold text-[#122654] truncate">{clientName}</span>
                    </span>
                    <button type="button" onClick={() => pickClient(NEW_CLIENT)} className="text-[11px] font-semibold text-[#1D4E89] hover:underline cursor-pointer shrink-0">
                      New client instead
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                  {isNew && (
                    <div>
                      <Q htmlFor="name">{structure === 'sole' ? 'Full name' : sf.legalLabel}</Q>
                      <input id="name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={sf.legalPlaceholder} />
                    </div>
                  )}
                  <div>
                    <Q htmlFor="trading">{sf.tradingLabel}</Q>
                    <input id="trading" className={inputCls} value={details.trading_name} onChange={setD('trading_name')} placeholder="Optional" />
                  </div>
                </div>

                <div className={section}>
                  <p className="text-[11px] font-semibold text-[#4A5878] mb-1.5">What kind of entity is it?</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2" role="radiogroup" aria-label="Entity type">
                    {COMPANY_TYPES.map(([k, std, s]) => (
                      <Card key={k} on={type === k} title={k.replace(/ \(.*\)$/, '')} sub={s} tag={std} onClick={() => setType(k)} />
                    ))}
                  </div>
                </div>

                <div className={`${section} grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3`}>
                  {sf.companyNumber && (
                    <div className="sm:col-span-3 sm:w-1/2">
                      <Q htmlFor="crn">Companies House number</Q>
                      <input id="crn" className={inputCls} value={details.company_no} onChange={setD('company_no')} placeholder={sf.companyPlaceholder(details.jurisdiction)} aria-invalid={Boolean(crnError)} />
                      {crnError && <Notice inline className="mt-1">{crnError}</Notice>}
                    </div>
                  )}
                  <div className="sm:col-span-3">
                    <Q>{sf.addressLabel}</Q>
                  </div>
                  <input aria-label="Address" className={inputCls} value={details.address_line} onChange={setD('address_line')} placeholder="12 High Street, Leeds" />
                  <input aria-label="Postcode" className={`${inputCls} mt-2 sm:mt-0`} value={details.postcode} onChange={setD('postcode')} placeholder="LS1 4AB" aria-invalid={Boolean(postcodeError)} />
                  <select aria-label="Country" className={`${inputCls} mt-2 sm:mt-0`} value={details.jurisdiction} onChange={setD('jurisdiction')}>
                    <option value="england_wales">England and Wales</option>
                    <option value="scotland">Scotland</option>
                    <option value="northern_ireland">Northern Ireland</option>
                  </select>
                  {postcodeError && <Notice inline className="sm:col-span-3 mt-1">{postcodeError}</Notice>}
                </div>

                <div className={`${section} grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3`}>
                  <div>
                    <p className="text-[11px] font-semibold text-[#4A5878] mb-1">Is it VAT registered?</p>
                    <YesNo label="VAT registered" value={vat} yes="VAT registered" no="Not registered" onChange={setVat} />
                    {vat && (
                      <div className="mt-2 max-w-[220px]">
                        <input id="vat" aria-label="VAT number" className={inputCls} value={details.vat_number} onChange={setD('vat_number')} placeholder="VAT number, e.g. GB123456789" aria-invalid={Boolean(vatError)} />
                        {vatError && <Notice inline className="mt-1">{vatError}</Notice>}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#4A5878] mb-1">Does it run payroll?</p>
                    <YesNo label="Runs payroll" value={payroll} yes="Runs payroll" no="No payroll" onChange={setPayroll} />
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-lg font-bold text-[#122654]">Period</h2>
                <p className="text-xs text-[#4A5878]">How often you prepare a file for this client, and the period it covers.</p>
                <p className="text-[11px] font-semibold text-[#4A5878] mt-4 mb-1.5">How often?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Frequency">
                  {FREQUENCIES.map(([k, title, sub]) => (
                    <Card
                      key={k}
                      on={frequency === k}
                      title={title}
                      sub={sub}
                      onClick={() => {
                        setFrequency(k);
                        setEnd(yearEnd, k);
                      }}
                    />
                  ))}
                </div>
                <div className={`${section} grid grid-cols-1 sm:grid-cols-2 gap-x-3`}>
                  <div>
                    <Q htmlFor="year-end">{END_LABEL[frequency]}</Q>
                    <input id="year-end" type="date" className={inputCls} value={yearEnd} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                  <div>
                    <Q htmlFor="period-start">Period start</Q>
                    <input id="period-start" type="date" className={inputCls} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                    <p className="text-[10px] text-[#7E8DA6] mt-1">Change it for a short or long first period.</p>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-lg font-bold text-[#122654]">Team</h2>
                <p className="text-xs text-[#4A5878]">Tick who works on this client. Optional: you can change it later on the client page.</p>
                <TeamManager clientId={isNew ? undefined : clientId} clientName={clientName} team={team} setTeam={setTeam} invited={invited} setInvited={setInvited} />
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-lg font-bold text-[#122654]">Data source</h2>
                <p className="text-xs text-[#4A5878]">Where the client’s books are.</p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Data source">
                  {SOURCES.map(([k, title, sub]) => (
                    <Card key={k} on={source === k} title={title} sub={sub} onClick={() => setSource(k)} />
                  ))}
                </div>
              </>
            )}

            {hint && <p className="mt-5 text-[11px] text-[#4A5878]">{hint}</p>}

            {error && <Notice className="mt-5">{error}</Notice>}

            <div className="mt-6 pt-4 border-t border-[#EEF2F9] flex items-center justify-between gap-3">
              {step > 0 ? (
                <button type="button" onClick={() => go(step - 1)} className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 bg-white border border-[#D3DCEE] rounded-lg text-xs font-bold text-[#122654] hover:border-[#A6B4D0] cursor-pointer">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={next}
                disabled={saving}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-4 bg-[#122654] hover:bg-[#0B1A3B] text-white font-bold text-xs rounded-lg cursor-pointer disabled:opacity-60"
              >
                {saving ? 'Creating…' : step < STEPS.length - 1 ? 'Continue' : source === 'csv' ? 'Create engagement' : `Create and connect ${sourceName}`}
                {!saving && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { db } from '@/lib/server/db';
import { TextInput } from '../parts';
import type { ScheduleProps } from '../schedules';
import { btnAdd, card, contextOf, newId, Pill, SuggestionRow, th, Tiles } from '../kit';
import { fullName, mergeOfficers, statutoryReview, type Officer } from '@/lib/workpapers/statutory';

const COMPANY_FIELDS = [
  ['registered_office', 'Registered office'],
  ['incorporated', 'Incorporated'],
  ['sic', 'Nature of business (SIC code)'],
  ['last_cs', 'Last confirmation statement made up to'],
  ['next_cs', 'Next confirmation statement due by'],
] as const;

export function StatutoryInfoSchedule({ data, result, locked, save, live }: ScheduleProps) {
  const [ch, setCh] = useState<{ busy: boolean; note?: string; bad?: boolean }>({ busy: false });
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = statutoryReview(ctx);
  const pullCh = async () => {
    setCh({ busy: true });
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(ctx.engagementId)}/companies-house`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) return setCh({ busy: false, note: body.error ?? 'Companies House could not be read.', bad: true });
      const m = mergeOfficers(live().officers ?? [], body.people, () => newId('o'));
      const company = { ...(live().company ?? {}), ...Object.fromEntries(Object.entries(body.company).filter(([, v]) => v)) };
      save({ officers: m.officers, company, ch_pulled_at: new Date().toISOString() });
      const bands = (body.people as { first_name: string; surname: string; ownership?: string }[]).filter((p) => p.ownership).map((p) => `${p.first_name} ${p.surname} ${p.ownership}`);
      setCh({ busy: false, note: `From Companies House: ${m.added} added, ${m.updated} updated, company details filled.${bands.length ? ` Shareholdings on the PSC register: ${bands.join(', ')}. Enter the number of shares from the confirmation statement.` : ''}` });
    } catch {
      setCh({ busy: false, note: 'Companies House could not be reached.', bad: true });
    }
  };
  const eng = db.engagements.find((e) => e.id === result.engagementId);
  const client = db.clients.find((c) => c.id === eng?.client_id);
  const company: Record<string, string> = data.company ?? {};
  const update = (id: string, patch: Partial<Officer>) => save({ officers: (live().officers ?? []).map((o: Officer) => (o.id === id ? { ...o, ...patch } : o)) });
  const setSigner = (id: string) => save({ officers: (live().officers ?? []).map((o: Officer) => ({ ...o, signs: o.id === id })) });
  const dateField = 'w-[125px] px-1.5 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px] bg-white disabled:bg-[#F5F8FD]';
  const role = (o: Officer, key: 'is_director' | 'is_secretary' | 'is_shareholder' | 'psc', label: string, tone: string) => (
    <button
      type="button"
      disabled={locked}
      aria-pressed={!!o[key]}
      onClick={() => update(o.id, { [key]: !o[key] })}
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${o[key] ? tone : 'bg-white text-[#7E8DA6] border-dashed border-[#D3DCEE]'}`}
    >
      {label}
    </button>
  );
  const capitalOk = r.capitalShares !== null && r.shares === r.capitalShares;
  const missingPsc = r.people.filter((p) => p.significant && !p.o.psc);

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Directors in the year', value: String(r.served.length), sub: `${r.people.filter((p) => p.inOffice).length} in office at ${ukDate(ctx.periodEnd)}` },
          { label: 'Shareholders', value: String(r.holders.length), tone: capitalOk ? 'plain' : 'warn', sub: `${r.shares.toLocaleString('en-GB')} shares · ${capitalOk ? 'agrees to share capital' : r.capitalShares === null ? 'no share classes yet' : `share capital has ${r.capitalShares.toLocaleString('en-GB')}`}` },
          { label: 'People with significant control', value: String(r.people.filter((p) => p.o.psc).length), tone: missingPsc.length ? 'warn' : 'plain', sub: missingPsc.length ? `${missingPsc.length} holder over 25% not marked` : 'matches shareholdings' },
          { label: 'Signs the accounts', value: r.signer[0] ? fullName(r.signer[0].o) : 'Not chosen', tone: r.signer[0] ? 'plain' : 'warn', sub: 'a director in office at approval' },
          { label: 'Accounts due at Companies House', value: ukDate(r.due), sub: '9 months after the year end' },
        ]}
      />

      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold">Officers and shareholders</span>
          {!locked && (
            <span className="flex gap-2">
              <button type="button" className={btnAdd} disabled={ch.busy} onClick={() => void pullCh()}>
                <Download className="w-3.5 h-3.5" /> {ch.busy ? 'Reading Companies House…' : 'Pull from Companies House'}
              </button>
              <button type="button" className={btnAdd} onClick={() => save({ officers: [...(live().officers ?? []), { id: newId('o'), share_type: 'ORDINARY', is_director: true }] })}>
                <Plus className="w-3.5 h-3.5" /> Add person
              </button>
            </span>
          )}
        </div>
        {ch.note && <div className={`mb-2 text-[11px] ${ch.bad ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>{ch.note}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#F5F8FD]">
                <th className={`${th} text-left`}>Name</th>
                <th className={`${th} text-left`}>Roles</th>
                <th className={`${th} text-left`}>Appointed</th>
                <th className={`${th} text-left`}>Resigned</th>
                <th className={`${th} text-left`}>Shares held</th>
                <th className={`${th} text-left`}>Signs accounts</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {r.people.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-[#7E8DA6]">
                    No one added yet. Add every director who served in the year, the secretary if there is one, and each shareholder.
                  </td>
                </tr>
              )}
              {r.people.map((p) => {
                const o = p.o;
                const name = fullName(o) || 'New person';
                return (
                  <React.Fragment key={o.id}>
                    <tr className={o.is_director && !p.served ? 'opacity-60' : ''}>
                      <td className="p-1.5 align-top min-w-[220px]">
                        <div className="grid grid-cols-[56px_1fr_1fr] gap-1">
                          <TextInput label="Title" value={o.title} disabled={locked} placeholder="Title" onCommit={(v) => update(o.id, { title: v })} />
                          <TextInput label="First name" value={o.first_name} disabled={locked} placeholder="First name" onCommit={(v) => update(o.id, { first_name: v })} />
                          <TextInput label="Surname" value={o.surname} disabled={locked} placeholder="Surname" onCommit={(v) => update(o.id, { surname: v })} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[#1D4E89]">
                          {p.loan !== null && <span>Director&apos;s loan · {formatPence(p.loan)} at the year end</span>}
                          {p.dividend > 0n && <span>Dividends · {formatPence(p.dividend)} in the year</span>}
                        </div>
                      </td>
                      <td className="p-1.5 align-top">
                        <div className="flex flex-wrap gap-1">
                          {role(o, 'is_director', 'Director', 'bg-[#E8F0FC] text-[#1D4E89] border-[#E8F0FC]')}
                          {role(o, 'is_secretary', 'Secretary', 'bg-[#EEF1F6] text-[#4A5878] border-[#EEF1F6]')}
                          {role(o, 'is_shareholder', 'Shareholder', 'bg-[#F1E9FB] text-[#6B3FA0] border-[#F1E9FB]')}
                          {role(o, 'psc', 'PSC', 'bg-[#EEF1F6] text-[#122654] border-[#EEF1F6]')}
                        </div>
                        {p.significant && <div className="mt-1 text-[10px] text-[#4A5878]">Over 25% of the shares</div>}
                      </td>
                      <td className="p-1.5 align-top">{(o.is_director || o.is_secretary) && <input type="date" aria-label={`Appointed: ${name}`} className={dateField} value={o.appointed ?? ''} disabled={locked} onChange={(e) => update(o.id, { appointed: e.target.value })} />}</td>
                      <td className="p-1.5 align-top">{(o.is_director || o.is_secretary) && <input type="date" aria-label={`Resigned: ${name}`} className={dateField} value={o.resigned ?? ''} disabled={locked} onChange={(e) => update(o.id, { resigned: e.target.value })} />}</td>
                      <td className="p-1.5 align-top">
                        {o.is_shareholder && (
                          <div className="grid grid-cols-[1fr_80px] gap-1 w-48">
                            <TextInput label={`Type of shares: ${name}`} value={o.share_type} disabled={locked} onCommit={(v) => update(o.id, { share_type: v.toUpperCase() })} />
                            <TextInput label={`Number of shares: ${name}`} value={o.shares} disabled={locked} className="text-right font-mono" onCommit={(v) => update(o.id, { shares: v.replace(/[^\d]/g, '') })} />
                          </div>
                        )}
                        {o.is_shareholder && r.shares > 0n && <div className="text-[10px] text-[#4A5878]">{p.pct.toFixed(p.pct % 1 ? 2 : 0)}% of the company</div>}
                        {!o.is_shareholder && <span className="text-[#7E8DA6]">None</span>}
                      </td>
                      <td className="p-1.5 align-top">
                        {p.inOffice ? (
                          <label className="flex items-center gap-1">
                            <input type="radio" name="signs" checked={!!o.signs} disabled={locked} onChange={() => setSigner(o.id)} aria-label={`${name} signs the accounts`} />
                            {o.signs ? 'Signs' : 'Choose'}
                          </label>
                        ) : (
                          <span className="text-[#7E8DA6]">Not eligible</span>
                        )}
                      </td>
                      <td className="p-1.5 align-top">
                        {!locked && (
                          <button type="button" onClick={() => save({ officers: (live().officers ?? []).filter((x: Officer) => x.id !== o.id) })} aria-label={`Remove ${name}`} className="text-[#7E8DA6] hover:text-[#B42318]">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {p.significant && !o.psc && (
                      <tr>
                        <td colSpan={7} className="px-2 pb-2">
                          <SuggestionRow
                            actions={
                              !locked && (
                                <button type="button" className="px-2.5 py-1 text-[11px] font-bold rounded-[6px] bg-[#122654] text-white" onClick={() => update(o.id, { psc: true })}>
                                  Mark as PSC
                                </button>
                              )
                            }
                          >
                            {name} holds {p.pct.toFixed(0)}% of the shares, so they are a person with significant control.
                          </SuggestionRow>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!r.people.some((p) => p.o.is_secretary) && r.people.length > 0 && <div className="mt-2 text-[10px] text-[#4A5878]">No company secretary. A private company doesn&apos;t need one, so the accounts leave the line out.</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="font-bold mb-2">Company details</div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="py-1 text-[#4A5878] w-48">Company name</td>
                <td className="py-1">{client?.name ?? '–'}</td>
              </tr>
              <tr>
                <td className="py-1 text-[#4A5878]">Company number</td>
                <td className="py-1">{client?.company_no || <span className="text-[#B8432F]">Add it on the client profile</span>}</td>
              </tr>
              <tr>
                <td className="py-1 text-[#4A5878]">Company type</td>
                <td className="py-1">{client?.company_type ?? '–'}</td>
              </tr>
              <tr>
                <td className="py-1 text-[#4A5878]">Accounting reference date</td>
                <td className="py-1">{ukDate(ctx.periodEnd).replace(/\s?\d{4}$/, '')}</td>
              </tr>
              {COMPANY_FIELDS.map(([key, label]) => (
                <tr key={key}>
                  <td className="py-1 text-[#4A5878]">{label}</td>
                  <td className="py-1">
                    {key === 'incorporated' || key === 'last_cs' || key === 'next_cs' ? (
                      <input type="date" aria-label={label} value={company[key] ?? ''} disabled={locked} onChange={(e) => save({ company: { ...(live().company ?? {}), [key]: e.target.value } })} className={dateField} />
                    ) : (
                      <TextInput label={label} value={company[key]} disabled={locked} onCommit={(v) => save({ company: { ...(live().company ?? {}), [key]: v } })} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-[#4A5878]">Pulled from the Companies House register, or typed in; the accounts&apos; company information page uses them.</div>
        </div>
        <div className={card}>
          <div className="font-bold mb-2">Shares</div>
          <div className="flex justify-between text-[11px]">
            <span>Held by the shareholders above</span>
            <span className="font-mono">{r.shares.toLocaleString('en-GB')}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span>On the Share capital paper</span>
            <span className="font-mono">{r.capitalShares === null ? '–' : r.capitalShares.toLocaleString('en-GB')}</span>
          </div>
          <div className="mt-1">
            <Pill tone={capitalOk ? 'good' : 'warn'}>{capitalOk ? 'Agrees' : r.capitalShares === null ? 'Enter the share classes on Share capital' : 'Differs'}</Pill>
          </div>
          <div className="mt-3 font-bold mb-1">Where this is used</div>
          <ul className="text-[11px] text-[#4A5878] list-disc pl-4">
            <li>Accounts: company information page and balance sheet approval</li>
            <li>Director&apos;s loan account: one account for each director who served</li>
            <li>Share capital and dividends: holdings for the dividend vouchers</li>
            <li>Related parties: names used in the notes</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

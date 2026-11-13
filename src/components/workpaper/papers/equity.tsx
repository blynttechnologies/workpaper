'use client';

import React from 'react';
import Link from 'next/link';
import { db } from '@/lib/server/db';
import { Plus, Trash2 } from 'lucide-react';
import { formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, card, contextOf, money, newId, Pill, th, Tiles } from '../kit';
import { equityReview, type Dividend, type ShareClass } from '@/lib/workpapers/equity';

export function EquitySchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = equityReview(ctx);
  const setClass = (id: string, patch: Partial<ShareClass>) => save({ classes: (live().classes ?? []).map((c: ShareClass) => (c.id === id ? { ...c, ...patch } : c)) });
  const setDividend = (id: string, patch: Partial<Dividend>) => save({ dividends: (live().dividends ?? []).map((d: Dividend) => (d.id === id ? { ...d, ...patch } : d)) });
  const lowest = r.tested.reduce<(typeof r.tested)[number] | null>((lo, t) => (t.cover !== null && (lo === null || (lo.cover ?? Infinity) > t.cover) ? t : lo), null);
  const papers = r.tested.filter((t) => filesFor(t.d.id).length).length;
  const missing = r.tested.find((t) => !filesFor(t.d.id).length);
  const capitalOk = r.classes.length > 0 && r.capital === r.capitalTb;
  const unposted = r.taxPosted === 0n ? r.tax : 0n;

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Share capital', value: formatPence(r.capital), sub: capitalOk ? 'Agrees to TB 8500' : `TB ${formatPence(r.capitalTb)}`, tone: capitalOk ? 'plain' : 'bad' },
          { label: 'Dividends in the year', value: formatPence(r.total), sub: `${r.tested.length} dividend${r.tested.length === 1 ? '' : 's'}` },
          {
            label: 'Lowest reserves cover',
            value: lowest?.cover != null ? `${lowest.cover.toFixed(1)}×` : '–',
            tone: lowest ? (lowest.lawful ? 'good' : 'bad') : 'plain',
            sub: lowest ? `${ukDate(lowest.d.date)} · ${r.tested.every((t) => t.lawful) ? `all ${r.tested.length} lawful` : 'not all lawful'}` : 'no dividends',
          },
          { label: 'Minutes and vouchers', value: `${papers} of ${r.tested.length}`, tone: papers < r.tested.length ? 'warn' : 'plain', sub: missing ? `${ukDate(missing.d.date)} missing` : 'all on file' },
          { label: 'Profit and loss reserve', value: formatPence(r.cf), sub: `brought forward ${formatPence(r.bf)}` },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Share capital <Pill tone={capitalOk ? 'good' : 'bad'}>{capitalOk ? 'Agrees to TB 8500' : 'Differs from TB 8500'}</Pill>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Class</th>
                <th className={`${th} text-right`}>Shares</th>
                <th className={`${th} text-right`}>Nominal £</th>
                <th className={`${th} text-right`}>Paid up</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.classes.map((c) => (
                <tr key={c.id} className="border-t border-[#EEF1F6]">
                  <td className="p-1">
                    <TextInput label="Share class" value={c.name} disabled={locked} onCommit={(v) => setClass(c.id, { name: v })} />
                  </td>
                  <td className="p-1 w-24">
                    <TextInput label={`Shares in ${c.name}`} value={c.shares} disabled={locked} className="text-right font-mono" onCommit={(v) => setClass(c.id, { shares: v.replace(/[^\d]/g, '') })} />
                  </td>
                  <td className="p-1 w-24">
                    <MoneyInput label={`Nominal value of ${c.name}`} value={c.nominal_p} disabled={locked} allowNegative={false} onCommit={(p) => setClass(c.id, { nominal_p: p })} />
                  </td>
                  <td className="p-1 text-right font-mono">{money(BigInt(Math.round(Number(c.shares) || 0)) * BigInt(c.nominal_p || '0'))}</td>
                  <td className="p-1">
                    {!locked && (
                      <button type="button" aria-label={`Remove ${c.name}`} onClick={() => save({ classes: (live().classes ?? []).filter((x: ShareClass) => x.id !== c.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!locked && (
            <button type="button" className={`${btnAdd} mt-2`} onClick={() => save({ classes: [...(live().classes ?? []), { id: newId('cls'), name: 'Ordinary', shares: '100', nominal_p: '100' }] })}>
              <Plus className="w-3.5 h-3.5" /> Add class
            </button>
          )}
          <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[#4A5878]">Shareholders · from Statutory information</div>
          {r.holders.length === 0 && (
            <div className="text-[11px] text-[#7E8DA6]">
              None recorded yet.{' '}
              {(() => {
                const r20 = db.workpapers.find((w) => w.engagement_id === ctx.engagementId && w.ref === 'R-20');
                return r20 ? (
                  <Link href={`/engagements/${ctx.engagementId}/workpapers/${r20.id}`} className="text-[#1D4E89] underline">
                    Pull them from Companies House on Statutory information
                  </Link>
                ) : null;
              })()}
            </div>
          )}
          {r.holders.map((o: any) => (
            <div key={o.id} className="flex justify-between text-[11px] py-0.5">
              <span>
                {[o.first_name, o.surname].filter(Boolean).join(' ')}
                {o.is_director ? ' · director' : ''}
              </span>
              <span className="font-mono">
                {Number(o.shares || 0).toLocaleString('en-GB')} {r.shares ? `· ${((Number(o.shares || 0) / Number(r.shares)) * 100).toFixed(0)}%` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className={card}>
          <div className="flex items-center justify-between font-bold mb-2">
            Profit and loss reserve <Pill tone={r.cf === r.cfTb - unposted ? 'good' : 'bad'}>{r.cf === r.cfTb - unposted ? 'Reconciles to the TB' : 'Does not reconcile'}</Pill>
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="py-1">
                  At {ukDate(ctx.periodStart)} · from {r.bfSource}
                </td>
                <td className="py-1 w-28">
                  <MoneyInput label="Reserves brought forward" value={(data.bf_p ?? r.bf.toString()) as string} disabled={locked} onCommit={(p) => save({ bf_p: p })} />
                </td>
              </tr>
              <tr>
                <td className="py-1">Profit before tax (trial balance)</td>
                <td className="py-1 text-right font-mono">{money(r.pbt)}</td>
              </tr>
              <tr>
                <td className="py-1">
                  Tax {r.taxPosted ? '(charge in the TB)' : (
                    <>
                      estimate at{' '}
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        aria-label="Tax rate for the estimate"
                        disabled={locked}
                        defaultValue={r.rate}
                        onBlur={(e) => Number(e.target.value) !== r.rate && save({ tax_rate: Number(e.target.value) })}
                        className="w-14 px-1 border border-[#D3DCEE] rounded text-right"
                      />
                      %
                    </>
                  )}
                </td>
                <td className="py-1 text-right font-mono">({money(r.tax)})</td>
              </tr>
              <tr>
                <td className="py-1">Dividends (below)</td>
                <td className="py-1 text-right font-mono">({money(r.total)})</td>
              </tr>
              <tr className="font-bold border-t border-[#D3DCEE]">
                <td className="py-1">At {ukDate(ctx.periodEnd)}</td>
                <td className="py-1 text-right font-mono">{money(r.cf)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-[#4A5878]">Trial balance reserves {formatPence(r.cfTb)}{unposted ? `; the tax estimate of ${formatPence(unposted)} is not in it yet` : ''}. Profit updates if the trial balance changes, and so does every cover figure below.</div>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div>
            <div className="font-bold">Dividends and the reserves test</div>
            <div className="text-[10px] text-[#4A5878]">Each dividend is tested on the day it was paid: brought forward + profit to that date (after estimated tax) − dividends already paid.</div>
          </div>
          {!locked && (
            <button type="button" className={btnAdd} onClick={() => save({ dividends: [...(live().dividends ?? []), { id: newId('div'), date: ctx.periodEnd, type: 'interim', class_id: r.classes[0]?.id, amount_p: '0' }] })}>
              <Plus className="w-3.5 h-3.5" /> Add dividend
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Date</th>
                <th className={`${th} text-left`}>Type</th>
                <th className={`${th} text-right w-[110px]`}>Amount</th>
                <th className={`${th} text-right`}>Profit to date</th>
                <th className={`${th} text-right`}>Available</th>
                <th className={`${th} text-right`}>Cover</th>
                <th className={`${th} text-left`}>Lawful</th>
                <th className={`${th} text-left`}>Minutes and voucher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {r.tested.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-2 text-[#7E8DA6]">
                    No dividends in the year.
                  </td>
                </tr>
              )}
              {r.tested.map((t) => (
                <tr
                  key={t.d.id}
                  className={!t.lawful ? 'bg-[#FFF1EE]' : !filesFor(t.d.id).length ? 'bg-[#FFFBEF]' : ''}
                  onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = Array.from(e.dataTransfer.files ?? []);
                    if (f.length && !locked && dropFiles) dropFiles(f, t.d.id);
                  }}
                >
                  <td className="p-1">
                    <input type="date" aria-label="Date paid" value={t.d.date} disabled={locked} onChange={(e) => setDividend(t.d.id, { date: e.target.value })} className="px-1.5 py-1 border border-[#D3DCEE] rounded-[6px]" />
                  </td>
                  <td className="p-1">
                    <select aria-label="Type of dividend" value={t.d.type} disabled={locked} onChange={(e) => setDividend(t.d.id, { type: e.target.value as Dividend['type'] })} className="px-1.5 py-1 border border-[#D3DCEE] rounded-[6px]">
                      <option value="interim">Interim</option>
                      <option value="final">Final</option>
                    </select>
                    <div className="text-[10px] text-[#4A5878]">
                      {t.cls?.name ?? 'Ordinary'}
                      {t.perShare !== null ? ` · ${formatPence(t.perShare)} per share` : ''}
                    </div>
                  </td>
                  <td className="p-1">
                    <MoneyInput label={`Dividend paid ${t.d.date}`} value={t.d.amount_p} disabled={locked} allowNegative={false} onCommit={(p) => setDividend(t.d.id, { amount_p: p })} />
                  </td>
                  <td className="p-1 text-right font-mono" title={t.source === 'ledger' ? 'From the ledger to this date' : 'The year’s profit pro rata by days: the ledger has no P&L detail'}>
                    {money(t.profit)}
                    {t.source !== 'ledger' && <div className="text-[9px] text-[#7E8DA6]">pro rata</div>}
                  </td>
                  <td className="p-1 text-right font-mono">{money(t.available)}</td>
                  <td className="p-1 text-right font-mono font-bold">{t.cover === null ? '–' : `${t.cover.toFixed(1)}×`}</td>
                  <td className="p-1">{t.lawful ? <span className="text-[#0B6B52] font-bold">✓ Yes</span> : <span className="text-[#B42318] font-bold">No</span>}</td>
                  <td className="p-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {tickFor(t.d.id, `the dividend paid ${t.d.date}`)}
                      <RowFiles files={filesFor(t.d.id)} onPreview={preview} onAttach={() => attachTo(t.d.id)} disabled={locked} label={`board minutes and voucher for ${t.d.date}`} />
                      {!locked && (
                        <button type="button" aria-label={`Remove the dividend of ${t.d.date}`} onClick={() => save({ dividends: (live().dividends ?? []).filter((x: Dividend) => x.id !== t.d.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {r.tested.length > 0 && (
              <tfoot className="font-bold border-t-2 border-[#122654]/20">
                <tr>
                  <td className="p-1" colSpan={2}>
                    Total · {r.tested.length} dividends
                  </td>
                  <td className="p-1 text-right font-mono">{money(r.total)}</td>
                  <td colSpan={5} className="p-1 text-[10px] font-normal text-[#4A5878]">
                    Director&apos;s loan account credits: {formatPence(r.dla)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="mt-1 text-[10px] text-[#4A5878]">
          Profit to date is taken from the ledger up to each date{r.tested.some((t) => t.source !== 'ledger') ? ' (pro rata by days where the ledger has no P&L detail)' : ''}, with tax estimated at {r.rate}% as interim accounts allow.
        </div>
      </div>

      <AccountsPreview
        rows={[
          { label: 'Called up share capital', amount: r.capital },
          { label: 'Profit and loss reserve', amount: r.cf },
          { label: 'Capital and reserves', amount: r.capital + r.cf, strong: true },
        ]}
        note="Equals net assets on the balance sheet. Micro-entity accounts need no dividends note; this paper keeps the record for the file and the director's tax return."
      />
    </div>
  );
}

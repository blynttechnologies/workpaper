'use client';

import React, { useState } from 'react';
import { Download, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { AccountsPreview, btnAdd, btnPrimary, btnSecondary, card, contextOf, JournalPanel, money, newId, Pill, SuggestBanner, SuggestionRow, th, Tiles } from '../kit';
import { chartName } from '@/lib/workpapers/common';
import { ASSET_CLASSES, bringForward, findCapitalCosts, fromLedger, policyText, registerReview, salesFromRevenue, type Asset, type Candidate, type ClassCode } from '@/lib/workpapers/fixed-assets';

export function FixedAssetsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const [view, setView] = useState<'summary' | 'register'>('summary');
  const [note, setNote] = useState<string | null>(null);
  const ctx = contextOf(result);
  if (!ctx) return null;
  const r = registerReview(ctx);
  const tot = (k: string) => result.totals[k] ?? 0n;
  const threshold = asPence(data.cap_threshold_p ?? '100000');
  const sales = salesFromRevenue(ctx.engagementId).filter((s) => !r.rows.some((x) => x.a.from_tx === s.id));
  const nextRef = () => `FA${String((live().assets ?? []).length + 1).padStart(3, '0')}`;
  const setAsset = (id: string, patch: Partial<Asset>) => save({ assets: (live().assets ?? []).map((a: Asset) => (a.id === id ? { ...a, ...patch } : a)) });
  const setCandidate = (id: string, patch: Partial<Candidate>) => save({ candidates: (live().candidates ?? []).map((k: Candidate) => (k.id === id ? { ...k, ...patch } : k)) });
  const capitalise = (ks: Candidate[]) => {
    const assets: Asset[] = [...(live().assets ?? [])];
    for (const k of ks) assets.push({ id: newId('fa'), ref: `FA${String(assets.length + 1).padStart(3, '0')}`, desc: k.desc, class_code: k.class_code, acquired: k.date, cost_p: k.amount_p, dep_bf_p: '0', source: 'capitalised', from_tx: k.id });
    save({ candidates: (live().candidates ?? []).map((x: Candidate) => (ks.some((k) => k.id === x.id) ? { ...x, decision: 'capitalise' } : x)), assets });
  };
  const uncapitalise = (k: Candidate) => save({ candidates: (live().candidates ?? []).map((x: Candidate) => (x.id === k.id ? { ...x, decision: undefined } : x)), assets: (live().assets ?? []).filter((a: Asset) => a.from_tx !== k.id) });
  const search = () => {
    const found = findCapitalCosts(ctx, threshold, live().candidates ?? []);
    save({ candidates: found, searched_at: new Date().toISOString() });
    setNote(`${found.length} cost${found.length === 1 ? '' : 's'} over ${formatPence(threshold)} in the P&L read like assets.`);
  };
  const fromPrior = () => {
    const b = bringForward(ctx);
    if (!b.length) return setNote("No register on last year's paper to bring forward.");
    save({ assets: [...b, ...(live().assets ?? []).filter((a: Asset) => a.source !== 'opening')] });
    setNote(`${b.length} asset${b.length === 1 ? '' : 's'} brought forward from last year.`);
  };
  // Pull the register from Xero or QuickBooks; blank lines added by hand are replaced
  const pull = () => {
    const kept = (live().assets ?? []).filter((a: Asset) => a.desc.trim() || asPence(a.cost_p) !== 0n);
    const { assets, credits } = fromLedger(ctx, kept);
    const next = [...kept, ...assets.map((a, i) => ({ ...a, id: newId('fa'), ref: `FA${String(kept.length + i + 1).padStart(3, '0')}` }))];
    save({ assets: next });
    setNote(
      `${assets.length ? `${assets.length} line${assets.length === 1 ? '' : 's'} pulled from the ledger` : 'Nothing new in the ledger'}.` +
        (credits.length ? ` ${credits.length} credit${credits.length === 1 ? '' : 's'} to asset accounts (${credits.map((c) => `${c.desc} ${formatPence(c.amount)}`).join(', ')}) look like disposals: set the date sold on the asset.` : ''),
    );
  };
  const recordSale = (s: (typeof sales)[number], assetId: string) => setAsset(assetId, { disposed: s.date, proceeds_p: s.amount.toString(), from_tx: s.id });
  const exportCsv = () => {
    const head = ['Ref', 'Description', 'Class', 'Acquired', 'Cost', 'Method', 'Rate %', 'Depreciation b/f', 'Charge', 'Depreciation c/f', 'NBV', 'Status'];
    const body = r.rows.map((x) => {
      const p = r.classes.find((c) => c.code === x.a.class_code)!.policy;
      return [x.a.ref, x.a.desc, chartName(x.a.class_code), x.a.acquired, formatPence(x.cost, { symbol: '' }), p.method === 'sl' ? 'Straight line' : 'Reducing balance', p.rate, formatPence(x.bf, { symbol: '' }), formatPence(x.charge, { symbol: '' }), formatPence(x.cf, { symbol: '' }), formatPence(x.nbv, { symbol: '' }), x.status];
    });
    const csv = [head, ...body].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fixed-asset-register-${ctx.periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const pending = r.candidates.filter((k) => !k.decision);
  const costAgrees = result.checks.find((c) => c.id === 'cost_tb')?.passed;

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Net book value', value: formatPence(tot('nbv')), sub: `cost ${formatPence(tot('cost'))} · depreciation ${formatPence(tot('dep'))}` },
          { label: 'Register vs TB', value: r.rows.length ? (costAgrees ? 'Agrees' : 'Differs') : '–', tone: r.rows.length ? (costAgrees ? 'good' : 'bad') : 'plain', sub: `${r.rows.filter((x) => !x.gone).length} assets` },
          { label: 'Charge for the year', value: formatPence(tot('charge')), sub: `in the TB now ${formatPence(tot('charge_tb'))}` },
          { label: 'Additions', value: formatPence(tot('additions')), sub: `${r.rows.filter((x) => x.added).length} this year` },
          { label: 'Disposals', value: formatPence(tot('disposals')), sub: tot('disposals') ? `${tot('profit') >= 0n ? 'profit' : 'loss'} ${formatPence(tot('profit') < 0n ? -tot('profit') : tot('profit'))}` : 'none this year' },
        ]}
      />
      <SuggestBanner
        count={pending.length + sales.length}
        locked={locked}
        onAccept={pending.length ? () => capitalise(pending) : undefined}
        text={[...pending.map((k) => `${k.desc} (${formatPence(asPence(k.amount_p))}) was charged to ${chartName(k.code)} but is over the ${formatPence(threshold)} threshold`), ...sales.map((s) => `${s.desc} (${formatPence(s.amount)}) was taken out of turnover as an asset sale: pick the asset sold`)].join(' · ') + '.'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-[8px] border border-[#D3DCEE] overflow-hidden" role="tablist" aria-label="View">
          {(['summary', 'register'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 text-xs font-bold ${view === v ? 'bg-[#122654] text-white' : 'bg-white text-[#122654]'}`}>
              {v === 'summary' ? 'Summary by class' : 'Asset register'}
            </button>
          ))}
        </div>
        {!locked && (
          <div className="ml-auto flex flex-wrap gap-2">
            {ctx.priorId && (
              <button type="button" className={btnAdd} onClick={fromPrior}>
                <RefreshCw className="w-3.5 h-3.5" /> Bring forward last year&apos;s register
              </button>
            )}
            <button type="button" className={btnAdd} onClick={pull}>
              <RefreshCw className="w-3.5 h-3.5" /> Pull from the ledger
            </button>
            <button type="button" className={btnAdd} onClick={() => save({ assets: [...(live().assets ?? []), { id: newId('fa'), ref: nextRef(), desc: '', class_code: '6800', acquired: ctx.periodEnd, cost_p: '0', dep_bf_p: '0', source: 'manual' }] })}>
              <Plus className="w-3.5 h-3.5" /> Add asset
            </button>
            {r.rows.length > 0 && (
              <button type="button" className={btnAdd} onClick={exportCsv}>
                <Download className="w-3.5 h-3.5" /> Export register
              </button>
            )}
          </div>
        )}
      </div>
      {note && <div className="-mt-2 text-[11px] text-[#0B6B52]">{note}</div>}

      {view === 'summary' ? (
        <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
          <table className="w-full text-[11px] text-[#122654]">
            <thead className="bg-[#F5F8FD]">
              <tr>
                <th className={`${th} text-left`} rowSpan={2}>
                  Class
                </th>
                <th className={`${th} text-left`} rowSpan={2}>
                  Method and rate
                </th>
                <th className={`${th} text-center border-l border-[#E3E7EF]`} colSpan={4}>
                  Cost
                </th>
                <th className={`${th} text-center border-l border-[#E3E7EF]`} colSpan={4}>
                  Depreciation
                </th>
                <th className={`${th} text-right border-l border-[#E3E7EF]`} rowSpan={2}>
                  NBV
                </th>
                <th className={`${th} text-left`} rowSpan={2}>
                  Opening vs TB
                </th>
              </tr>
              <tr>
                {['Opening', 'Additions', 'Disposals', 'Closing', 'Opening', 'Charge', 'Disposals', 'Closing'].map((h, i) => (
                  <th key={i} className={`${th} text-right ${i % 4 === 0 ? 'border-l border-[#E3E7EF]' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {r.classes.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-3 text-[#7E8DA6]">
                    No fixed assets yet. Bring last year&apos;s register forward, build it from the trial balance, or add the assets.
                  </td>
                </tr>
              )}
              {r.classes.map((c) => {
                const ok = c.priorCost === null ? c.costOpen + c.additions === c.tbCost || c.costClose === c.tbCost : c.costOpen === c.priorCost;
                return (
                  <tr key={c.code}>
                    <td className="p-2 font-bold">
                      {c.name} <span className="font-normal font-mono text-[#7E8DA6]">{c.code}</span>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        <select
                          aria-label={`Depreciation method for ${c.name}`}
                          value={c.policy.method}
                          disabled={locked}
                          onChange={(e) => save({ policies: { ...(live().policies ?? {}), [c.code]: { ...c.policy, method: e.target.value } } })}
                          className="px-1 py-0.5 border border-[#D3DCEE] rounded"
                        >
                          <option value="sl">Straight line</option>
                          <option value="rb">Reducing balance</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`Depreciation rate for ${c.name}`}
                          defaultValue={c.policy.rate}
                          disabled={locked}
                          onBlur={(e) => e.target.value !== c.policy.rate && save({ policies: { ...(live().policies ?? {}), [c.code]: { ...c.policy, rate: e.target.value } } })}
                          className="w-14 px-1 py-0.5 border border-[#D3DCEE] rounded text-right"
                        />
                        %
                      </div>
                    </td>
                    {[c.costOpen, c.additions, -c.disposals, c.costClose, c.depOpen, c.charge, -c.depDisposals, c.depClose].map((v, i) => (
                      <td key={i} className={`p-2 text-right font-mono ${i === 3 || i === 7 ? 'font-bold' : ''} ${i % 4 === 0 ? 'border-l border-[#E3E7EF]' : ''}`}>
                        {money(v)}
                      </td>
                    ))}
                    <td className="p-2 text-right font-mono font-bold border-l border-[#E3E7EF]">{money(c.costClose - c.depClose)}</td>
                    <td className="p-2">
                      <Pill tone={ok ? 'good' : 'warn'}>{ok ? 'Agrees' : `TB ${formatPence(c.priorCost ?? c.tbCost)}`}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {r.classes.length > 0 && (
              <tfoot className="font-bold border-t-2 border-[#122654]/20">
                <tr>
                  <td className="p-2" colSpan={2}>
                    Total
                  </td>
                  {(['costOpen', 'additions', 'disposals', 'costClose', 'depOpen', 'charge', 'depDisposals', 'depClose'] as const).map((k, i) => (
                    <td key={k} className={`p-2 text-right font-mono ${i % 4 === 0 ? 'border-l border-[#E3E7EF]' : ''}`}>
                      {money((k === 'disposals' || k === 'depDisposals' ? -1n : 1n) * r.classes.reduce((a, c) => a + c[k], 0n))}
                    </td>
                  ))}
                  <td className="p-2 text-right font-mono border-l border-[#E3E7EF]">{money(tot('nbv'))}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
          <table className="w-full text-[11px] text-[#122654]">
            <thead className="bg-[#F5F8FD]">
              <tr>
                {['Ref', 'Description', 'Class', 'Acquired', 'Cost', 'Dep b/f', 'Charge', 'Dep c/f', 'NBV', 'Status', 'Evidence', ''].map((h, i) => (
                  <th key={i} className={`${th} ${i >= 4 && i <= 8 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {r.rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="p-3 text-[#7E8DA6]">
                    No assets in the register yet.
                  </td>
                </tr>
              )}
              {r.rows.map((x) => {
                const a = x.a;
                return (
                  <React.Fragment key={a.id}>
                    <tr
                      className={x.gone ? 'opacity-50' : ''}
                      onDragOver={(e) => !locked && dropFiles && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = Array.from(e.dataTransfer.files ?? []);
                        if (f.length && !locked && dropFiles) dropFiles(f, a.id);
                      }}
                    >
                      <td className="p-1.5 font-mono w-16">{a.ref}</td>
                      <td className="p-1.5 min-w-[180px]">
                        <TextInput label={`Description of ${a.ref}`} value={a.desc} disabled={locked} placeholder="e.g. Dell laptop" onCommit={(v) => setAsset(a.id, { desc: v })} />
                      </td>
                      <td className="p-1.5">
                        <select aria-label={`Class of ${a.ref}`} value={a.class_code} disabled={locked} onChange={(e) => setAsset(a.id, { class_code: e.target.value as ClassCode })} className="px-1 py-1 border border-[#D3DCEE] rounded-[6px]">
                          {ASSET_CLASSES.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1.5">
                        <input type="date" aria-label={`Date ${a.ref} was acquired`} value={a.acquired} disabled={locked} onChange={(e) => setAsset(a.id, { acquired: e.target.value })} className="w-[125px] px-1.5 py-1 border border-[#D3DCEE] rounded-[6px]" />
                      </td>
                      <td className="p-1.5 w-24">
                        <MoneyInput label={`Cost of ${a.ref}`} value={a.cost_p} disabled={locked} allowNegative={false} onCommit={(p) => setAsset(a.id, { cost_p: p })} />
                      </td>
                      <td className="p-1.5 w-24">{x.added ? <span className="block text-right font-mono">–</span> : <MoneyInput label={`Depreciation brought forward on ${a.ref}`} value={a.dep_bf_p} disabled={locked} allowNegative={false} onCommit={(p) => setAsset(a.id, { dep_bf_p: p })} />}</td>
                      <td className="p-1.5 text-right font-mono">{money(x.charge)}</td>
                      <td className="p-1.5 text-right font-mono">{money(x.cf)}</td>
                      <td className="p-1.5 text-right font-mono font-bold">{money(x.nbv)}</td>
                      <td className="p-1.5">
                        <Pill tone={x.disposed ? 'plain' : x.added ? 'info' : 'good'}>{x.status}</Pill>
                        {x.disposed && <div className="text-[10px] text-[#4A5878]">{ukDate(a.disposed!)} · {x.profit >= 0n ? 'profit' : 'loss'} {formatPence(x.profit < 0n ? -x.profit : x.profit)}</div>}
                      </td>
                      <td className="p-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tickFor(a.id, `${a.ref} ${a.desc}`)}
                          <RowFiles files={filesFor(a.id)} onPreview={preview} onAttach={() => attachTo(a.id)} disabled={locked} label={`${a.ref} ${a.desc}`} />
                        </div>
                      </td>
                      <td className="p-1.5">
                        {!locked && !a.from_tx && (
                          <button type="button" aria-label={`Remove ${a.ref}`} onClick={() => save({ assets: (live().assets ?? []).filter((y: Asset) => y.id !== a.id) })} className="text-[#7E8DA6] hover:text-[#B42318]">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {!x.gone && !locked && (
                      <tr className="bg-[#FAFBFD]">
                        <td />
                        <td colSpan={11} className="px-1.5 pb-1.5">
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#4A5878]">
                            Disposed on
                            <input type="date" aria-label={`Date ${a.ref} was disposed of`} value={a.disposed ?? ''} onChange={(e) => setAsset(a.id, { disposed: e.target.value || undefined })} className="px-1 py-0.5 border border-[#D3DCEE] rounded" />
                            {a.disposed && (
                              <>
                                for
                                <span className="w-24">
                                  <MoneyInput label={`Proceeds for ${a.ref}`} value={a.proceeds_p} disabled={locked} allowNegative={false} onCommit={(p) => setAsset(a.id, { proceeds_p: p })} />
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div>
            <div className="font-bold">Found in the ledger</div>
            <div className="text-[10px] text-[#4A5878]">Costs charged to the P&amp;L over the capitalisation threshold that read like assets, and asset sales moved out of turnover on the Revenue paper.</div>
          </div>
          {!locked && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px]">
                Capitalise over £
                <span className="w-24">
                  <MoneyInput label="Capitalisation threshold" value={threshold.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ cap_threshold_p: p })} />
                </span>
              </label>
              <button type="button" className={btnAdd} onClick={search}>
                <Search className="w-3.5 h-3.5" /> {data.searched_at ? 'Search again' : 'Search the ledger'}
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {r.candidates.length === 0 && sales.length === 0 && <div className="text-[11px] text-[#7E8DA6]">{data.searched_at ? 'Nothing found.' : 'Not searched yet.'}</div>}
          {r.candidates.map((k) =>
            !k.decision ? (
              <SuggestionRow
                key={k.id}
                actions={
                  !locked && (
                    <>
                      <select aria-label={`Class for ${k.desc}`} value={k.class_code} onChange={(e) => setCandidate(k.id, { class_code: e.target.value as ClassCode })} className="px-1 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px]">
                        {ASSET_CLASSES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={btnPrimary} onClick={() => capitalise([k])}>
                        Capitalise
                      </button>
                      <button type="button" className={btnSecondary} onClick={() => setCandidate(k.id, { decision: 'expense' })}>
                        Keep as a cost
                      </button>
                    </>
                  )
                }
              >
                {ukDate(k.date)} · {k.desc}: {formatPence(asPence(k.amount_p))} charged to {chartName(k.code)}, over the {formatPence(threshold)} threshold.
              </SuggestionRow>
            ) : (
              <div key={k.id} className="flex flex-wrap items-center gap-2 text-[11px] text-[#4A5878]">
                {k.desc} {formatPence(asPence(k.amount_p))}: {k.decision === 'capitalise' ? `capitalised to ${chartName(k.class_code)}` : 'kept as a cost'}
                {k.decision === 'expense' && (
                  <span className="w-64">
                    <TextInput label={`Why ${k.desc} stays a cost`} value={k.reason} disabled={locked} placeholder="Reason (required)" onCommit={(v) => setCandidate(k.id, { reason: v })} />
                  </span>
                )}
                {!locked && (
                  <button type="button" className="text-[#1D4E89] underline" onClick={() => (k.decision === 'capitalise' ? uncapitalise(k) : setCandidate(k.id, { decision: undefined }))}>
                    Undo
                  </button>
                )}
              </div>
            )
          )}
          {sales.map((s) => (
            <SuggestionRow
              key={s.id}
              actions={
                !locked && (
                  <select aria-label={`Asset sold for ${s.desc}`} value="" onChange={(e) => e.target.value && recordSale(s, e.target.value)} className="px-1 py-1 text-[11px] border border-[#D3DCEE] rounded-[6px]">
                    <option value="">Which asset was sold?</option>
                    {r.rows
                      .filter((x) => !x.gone && !x.disposed)
                      .map((x) => (
                        <option key={x.a.id} value={x.a.id}>
                          {x.a.ref} {x.a.desc}
                        </option>
                      ))}
                  </select>
                )
              }
            >
              {ukDate(s.date)} · {s.desc}: {formatPence(s.amount)} was moved out of turnover on the Revenue paper as an asset sale. Record which asset was sold to work out the profit or loss.
            </SuggestionRow>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <JournalPanel
          engagementId={result.engagementId}
          date={ctx.periodEnd}
          lines={r.lines}
          sent={data.journal}
          narrative="Fixed assets: depreciation, capitalised costs and disposals"
          source="F-10"
          locked={locked}
          save={save}
          title="Year-end journals"
          note="Sale proceeds stay where they were posted; an asset sale moved out of turnover on the Revenue paper is credited to 4930 there."
        />
        <AccountsPreview
          rows={[
            ...r.classes.map((c) => ({ label: c.name, amount: c.costClose - c.depClose })),
            { label: 'Tangible fixed assets', amount: tot('nbv'), strong: true },
          ]}
          note={`Policy: ${policyText(data, r.classes.map((c) => c.code)) || 'set the rates above'}.`}
        />
      </div>
    </div>
  );
}

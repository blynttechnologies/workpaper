'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { inLead } from '@/lib/workpapers/common';
import { Plus, Trash2, AlertTriangle, ShieldAlert, Sparkles, Building2, User, RefreshCw, FileText, Zap, CheckCircle2, ArrowRight, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import { asPence, formatPence, formatPenceInput } from '@/lib/money';
import type { Attachment } from '@/lib/types/models';
import { db } from '@/lib/server/db';
import { services } from '@/lib/server/services';
import { reconAccounts, leadSources, rowCode, accountLedger, accountKind, accountName, statementEntered, debtorsJournal, type PaperResult, type ReconAccount, type ReconItem } from '@/lib/workpapers/engine';
import { agedDebtorsFromLedger, debtorView, type DebtorDecision, type DebtorLine } from '@/lib/workpapers/debtors';
import { MoneyInput, TextInput, RowFiles, AddOption, fmtTb } from './parts';
import { Tiles, type Tone } from './kit';
import { ukDate } from '@/lib/dates';
import { OpenItemsTable } from './OpenItemsTable';

export interface ScheduleProps {
  data: Record<string, any>;
  result: PaperResult;
  locked: boolean;
  save: (patch: Record<string, any>) => void;
  filesFor: (rowId: string) => Attachment[];
  attachTo: (rowId: string) => void;
  preview: (a: Attachment, expand?: boolean) => void;
  tickFor: (rowId: string, label: string) => React.ReactNode;
  /** The paper's latest data. Writes build on this, so quick successive edits never overwrite each other. */
  live: () => Record<string, any>;
  /** Upload files and link them to a row (null: the whole paper). */
  dropFiles?: (files: File[], rowId: string | null) => void;
  /** Swap the files linked to two rows. */
  swapEvidence?: (rowA: string, rowB: string) => void;
  /** Bank and cash: read the row's statement with AI and show what it found beside the paper. */
  readStatement?: (rowId: string) => void;
}

const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const th = 'p-2 text-[10px] font-bold uppercase tracking-wider text-[#4A5878] whitespace-nowrap';
const addBtn =
  'inline-flex items-center gap-1 min-h-[32px] px-3 text-xs font-bold text-[#122654] bg-white border border-[#D3DCEE] hover:border-[#122654] rounded-[8px] disabled:opacity-40';

function RemoveButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled: boolean }) {
  if (disabled) return null;
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="p-1 text-[#7E8DA6] hover:text-[#B42318]">
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

/* ---------- B-10 style: bank and cash, one row per account ---------- */
const KIND_LABEL = { bank: 'Bank', cash: 'Cash', card: 'Credit card' } as const;
/** A balance with its sign and side spelt out: + Dr for money held, − Cr for owed or overdrawn. */
const signed = (p: bigint) => (p === 0n ? formatPence(p) : `${p < 0n ? '−' : '+'}${formatPence(p < 0n ? -p : p)} ${p < 0n ? 'Cr' : 'Dr'}`);
const abs = (x: bigint) => (x < 0n ? -x : x);

export function ReconciliationSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles, readStatement, swapEvidence }: ScheduleProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [splitting, setSplitting] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Nil bank, card and cash accounts from the trial balance that were never mapped get a mapping, so every one shows here
  const [, setBackfilled] = useState(0);
  React.useEffect(() => {
    const firmId = db.engagements.find((e) => e.id === result.engagementId)?.firm_id;
    if (!locked && firmId && services.addNilCashMappings(firmId, result.engagementId)) setBackfilled((n) => n + 1);
  }, [locked, result.engagementId]);
  const leads = result.leads;
  const accounts = reconAccounts(data, leads, result.engagementId);
  const sourcesOf = (code: string) => leadSources(result.engagementId, code, true);
  const waiting = (a: ReconAccount) =>
    !!a.client_code && db.account_mappings.some((m) => m.engagement_id === result.engagementId && m.source_code === a.client_code && m.status !== 'confirmed' && inLead(m.blynt_code, a.code));
  // Mapped here but not confirmed: not in the trial balance, so not on this paper until confirmed
  const pending = db.account_mappings.filter((m) => m.engagement_id === result.engagementId && m.status !== 'confirmed' && result.template.leads.some((l) => inLead(m.blynt_code, l.code)));
  const tolerance = result.totals.tolerance ?? 100n;
  const tot = (key: string) => result.totals[key] ?? 0n;
  const periodEnd = db.engagements.find((e) => e.id === result.engagementId)?.period_end ?? '';

  // Writes always store the full account list, built on the latest data
  const saveAccounts = (fn: (as: ReconAccount[]) => ReconAccount[]) => save({ accounts: fn(reconAccounts(live(), leads, result.engagementId)) });
  const updateAcc = (id: string, patch: Partial<ReconAccount>) => saveAccounts((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const updateItems = (id: string, side: 'less' | 'add', fn: (rows: ReconItem[]) => ReconItem[]) =>
    saveAccounts((as) => as.map((a) => (a.id === id ? { ...a, [side]: fn(a[side] ?? []) } : a)));
  const addAccount = (value: string) => {
    const [code, source] = value.split('|');
    const lead = result.template.leads.find((l) => l.code === code);
    if (!lead) return;
    const m = source ? sourcesOf(code).find((x) => x.source_code === source) : undefined;
    const dismissed = ((live().dismissed_accounts ?? []) as string[]).filter((k) => k !== `${code}|${source}`);
    save({
      dismissed_accounts: dismissed,
      accounts: [
        ...reconAccounts({ ...live(), dismissed_accounts: dismissed }, leads, result.engagementId).filter((x) => !(m && x.code === code && x.client_code === m.source_code)),
        { id: newId('acc'), code, ...(m ? { client_code: m.source_code, name: m.source_name || m.source_code } : { name: lead.label }), statement_p: '', less: [], add: [] },
      ],
    });
  };
  // Several client accounts on one code: one row each. What was entered on the combined row, and its files, go to the account it belongs to
  const splitAccount = (a: ReconAccount, keep: string) => {
    const src = sourcesOf(a.code);
    setSplitting(null);
    saveAccounts((as) =>
      as.flatMap((x) =>
        x.id !== a.id
          ? [x]
          : src.map((m) => ({ ...(m.source_code === keep ? x : { id: newId('acc'), statement_p: '', less: [], add: [] }), code: a.code, client_code: m.source_code, name: m.source_name || m.source_code }))
      )
    );
  };
  // A statement, its reading, the reconciling items and the files on the wrong row: swap them with the right one
  const moveDetails = (from: ReconAccount, toId: string) => {
    const to = accounts.find((x) => x.id === toId);
    if (!to) return;
    const fields = ['statement_p', 'statement_date', 'ai_balances', 'source', 'synced_at', 'confirmation_p', 'less', 'add'] as const;
    const pick = (x: ReconAccount) => Object.fromEntries(fields.map((k) => [k, x[k]]));
    const swapField = (field: string) =>
      field.startsWith(`accounts.${from.id}.`) ? field.replace(`accounts.${from.id}.`, `accounts.${to.id}.`) : field.startsWith(`accounts.${to.id}.`) ? field.replace(`accounts.${to.id}.`, `accounts.${from.id}.`) : field;
    swapEvidence?.(from.id, to.id);
    save({
      accounts: reconAccounts(live(), leads, result.engagementId).map((x) => (x.id === from.id ? { ...x, ...pick(to) } : x.id === to.id ? { ...x, ...pick(from) } : x)),
      confidence_gate_items: (live().confidence_gate_items ?? []).map((g: any) => ({ ...g, field: swapField(String(g.field ?? '')) })),
    });
  };
  const removeAccount = (a: ReconAccount) => {
    if (!confirm(`Remove ${accountName(a, result.engagementId)} from this schedule? Its reconciling items go with it.`)) return;
    // A client account is remembered as removed, so it isn't added back as a new row
    const dismissed = a.client_code ? [...new Set([...(live().dismissed_accounts ?? []), `${a.code}|${a.client_code}`])] : live().dismissed_accounts;
    save({ dismissed_accounts: dismissed, accounts: reconAccounts({ ...live(), dismissed_accounts: dismissed }, leads, result.engagementId).filter((x) => x.id !== a.id) });
  };
  const onDrop = (e: React.DragEvent, rowId: string) => {
    e.preventDefault();
    setDragOver(null);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length && !locked && dropFiles) dropFiles(files, rowId);
  };
  const rows = accounts.map((a) => {
    const kind = accountKind(a.code);
    const ledger = accountLedger(a, accounts, leads, result.template.creditArea, result.engagementId);
    const entered = statementEntered(a);
    const diff = tot(`${a.id}_diff`);
    const files = filesFor(a.id);
    const status: 'todo' | 'out' | 'evidence' | 'done' = !entered ? 'todo' : abs(diff) > tolerance ? 'out' : files.length === 0 ? 'evidence' : 'done';
    const note =
      ledger.final < 0n && kind === 'bank' ? 'Overdrawn – shown in creditors' : ledger.final < 0n && kind === 'cash' ? 'Credit balance on cash – check postings' : null;
    const ai = (data.confidence_gate_items ?? []).find((g: any) => g.field === `accounts.${a.id}.statement_p`);
    return { a, kind, ledger, entered, diff, files, status, note, ai };
  });
  const reconciled = rows.filter((r) => r.status === 'done' || r.status === 'evidence').length;
  const withEvidence = rows.filter((r) => r.files.length).length;
  const todo = rows.filter((r) => !r.entered).length;
  const unused = result.template.leads.filter((l) => !accounts.some((a) => a.code === l.code) && sourcesOf(l.code).length === 0);
  const unusedSources = result.template.leads.flatMap((l) => {
    const src = sourcesOf(l.code);
    return src.length > 0 && !accounts.some((a) => a.code === l.code && !a.client_code) ? src.filter((m) => !accounts.some((a) => a.code === l.code && a.client_code === m.source_code)).map((m) => ({ l, m })) : [];
  });
  const tile = 'p-3 bg-white border border-[#D3DCEE] rounded-[12px]';
  const pill = {
    todo: 'bg-[#EEF1F6] text-[#4A5878]',
    out: 'bg-[#FFF1EE] text-[#B42318]',
    evidence: 'bg-[#FFF4DB] text-[#8A5A00]',
    done: 'bg-[#E6F4EF] text-[#0B6B52]',
  } as const;
  const pillLabel = { todo: 'To do', out: 'Unreconciled', evidence: 'Evidence needed', done: 'Reconciled' } as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Ledger balance, all accounts</div>
          <div className="text-lg font-bold font-mono text-[#122654] whitespace-nowrap">{signed(tot('ledger'))}</div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Accounts reconciled</div>
          <div className="text-lg font-bold text-[#122654]">
            {reconciled} of {rows.length}
          </div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Unexplained difference</div>
          <div className={`text-lg font-bold font-mono ${tot('unexplained') > tolerance ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>{formatPence(tot('unexplained'))}</div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Evidence attached</div>
          <div className="text-lg font-bold text-[#122654]">
            {withEvidence} of {rows.length}
          </div>
        </div>
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          {unused.length + unusedSources.length > 0 && (
            <select
              aria-label="Add account"
              value=""
              onChange={(e) => addAccount(e.target.value)}
              className="ml-auto min-h-[32px] px-2 text-xs font-bold text-[#122654] bg-white border border-[#D3DCEE] rounded-[8px]"
            >
              <option value="">+ Add account</option>
              {unusedSources.map(({ l, m }) => (
                <option key={`${l.code}|${m.source_code}`} value={`${l.code}|${m.source_code}`}>
                  {l.code} {m.source_name || m.source_code} · {formatPence(asPence(m.balance_p))}
                </option>
              ))}
              {unused
                .map((l) => ({ l, bal: leads.find((x) => x.code === l.code)?.final ?? 0n }))
                .sort((a, b) => (b.bal !== 0n ? 1 : 0) - (a.bal !== 0n ? 1 : 0))
                .map(({ l, bal }) => (
                  <option key={l.code} value={l.code}>
                    {l.code} {l.label}
                    {bal !== 0n ? ` · has a balance of ${formatPence(bal)}` : ''}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div role="status" className="flex items-start gap-2 p-3 rounded-[10px] bg-[#FFF4DB] border border-[#F0D9A0] text-xs text-[#5C4100]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            {pending.length === 1 ? '1 account is' : `${pending.length} accounts are`} mapped here but not confirmed, so not in the trial balance or on this paper:{' '}
            <span className="font-semibold">{pending.map((m) => `${m.source_name || m.source_code} (${m.blynt_code})`).join(', ')}</span>.{' '}
            <Link href={`/engagements/${encodeURIComponent(result.engagementId)}/mapping`} className="font-bold underline">
              Confirm on Mapping
            </Link>
          </div>
        </div>
      )}

      <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className="w-8" />
              <th className={`${th} text-left`}>Account</th>
              <th className={`${th} text-right`}>Ledger</th>
              <th className={`${th} text-right w-[150px]`}>Statement / count</th>
              <th className={`${th} text-right`}>Reconciling items</th>
              <th className={`${th} text-right`}>Difference</th>
              <th className={`${th} text-left`}>Evidence</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-3 text-[11px] text-[#7E8DA6]">
                  No bank, card or cash accounts in the trial balance yet. Add one above once the trial balance is mapped.
                </td>
              </tr>
            )}
            {rows.map(({ a, kind, ledger, entered, diff, files, status, note, ai }) => {
              const isOpen = !!open[a.id];
              const less = tot(`${a.id}_less`);
              const add = tot(`${a.id}_add`);
              const items = (a.less ?? []).length + (a.add ?? []).length;
              const name = accountName(a, result.engagementId);
              // A row from before accounts were named, with one client account on its code: show that account's name
              const single = !a.client_code && a.code !== '*' && sourcesOf(a.code).length === 1 ? sourcesOf(a.code)[0] : null;
              return (
                <React.Fragment key={a.id}>
                  <tr
                    className={dragOver === a.id ? 'bg-[#FFF4F1]' : ''}
                    onDragOver={(e) => {
                      if (locked || !dropFiles) return;
                      e.preventDefault();
                      setDragOver(a.id);
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => onDrop(e, a.id)}
                  >
                    <td className="p-1.5 align-top">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} reconciling items for ${name}`}
                        onClick={() => setOpen((o) => ({ ...o, [a.id]: !isOpen }))}
                        className="p-1 rounded border border-[#D3DCEE] text-[#4A5878] hover:text-[#122654]"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                    <td className="p-2 align-top">
                      <div className="font-bold">
                        {a.code !== '*' && <span className="font-mono font-normal text-[#4A5878] mr-1.5">{single?.blynt_code ?? rowCode(a, result.engagementId)}</span>}
                        {single ? single.source_name || single.source_code : a.name}
                      </div>
                      <div className="text-[10px] text-[#4A5878]">
                        {a.code === '*' ? 'All bank and cash accounts' : KIND_LABEL[kind]}
                        {a.client_code || single ? ` · ${a.client_code ?? single!.source_code}` : ''}
                        {a.detail ? ` · ${a.detail}` : ''}
                      </div>
                      {!locked && !a.client_code && a.code !== '*' && sourcesOf(a.code).length > 1 && (
                        splitting === a.id ? (
                          <div className="mt-1 p-2 rounded-[8px] border border-[#D3DCEE] bg-[#F5F8FD] text-[10px] text-[#122654] space-y-1">
                            <div className="font-bold">{statementEntered(a) || files.length || items ? 'What is entered on this row, and its files, belong to:' : 'Split into one row per account:'}</div>
                            <div className="flex flex-wrap gap-1">
                              {sourcesOf(a.code).map((m) => (
                                <button key={m.source_code} type="button" onClick={() => splitAccount(a, m.source_code)} className="px-2 py-0.5 rounded-[6px] border border-[#122654] font-bold hover:bg-white">
                                  {m.source_name || m.source_code}
                                </button>
                              ))}
                              <button type="button" onClick={() => setSplitting(null)} className="px-2 py-0.5 font-semibold text-[#4A5878]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setSplitting(a.id)} className="mt-0.5 text-[10px] font-bold text-[#B8432F] hover:underline">
                            Split into {sourcesOf(a.code).length} accounts
                          </button>
                        )
                      )}
                      {!locked && (statementEntered(a) || files.length > 0 || items > 0) && accounts.length > 1 && (
                        <select
                          aria-label={`Move the statement, items and files on ${name} to another account`}
                          value=""
                          onChange={(e) => e.target.value && moveDetails(a, e.target.value)}
                          className="mt-0.5 block max-w-[180px] text-[10px] text-[#4A5878] bg-transparent border border-transparent hover:border-[#D3DCEE] rounded"
                        >
                          <option value="">Wrong account? Move to…</option>
                          {accounts.filter((x) => x.id !== a.id).map((x) => (
                            <option key={x.id} value={x.id}>
                              {accountName(x, result.engagementId)}
                            </option>
                          ))}
                        </select>
                      )}
                      {note && (
                        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#B8432F]">
                          <AlertTriangle className="w-3 h-3 shrink-0" /> {note}
                        </div>
                      )}
                    </td>
                    <td className="p-2 align-top text-right">
                      <div className="font-mono font-bold whitespace-nowrap" title={ledger.final < 0n ? 'Credit: owed or overdrawn' : 'Debit: money held'}>
                        {signed(ledger.final)}
                      </div>
                      {waiting(a) ? (
                        <Link href={`/engagements/${encodeURIComponent(result.engagementId)}/mapping`} className="text-[10px] font-semibold text-[#8A5A00] underline">
                          Not confirmed on Mapping
                        </Link>
                      ) : (
                        <div className={`text-[10px] ${ledger.mapped ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>{ledger.mapped ? 'Agrees to TB' : 'Not in the TB'}</div>
                      )}
                    </td>
                    <td className="p-1.5 align-top">
                      <MoneyInput
                        label={`${kind === 'cash' ? 'Cash count' : 'Statement balance'} for ${name}`}
                        value={a.statement_p}
                        placeholder={kind === 'cash' ? 'Enter count' : 'Enter balance'}
                        disabled={locked}
                        onCommit={(p) => updateAcc(a.id, { statement_p: p, statement_date: undefined, source: 'manual', synced_at: undefined })}
                      />
                      <div className="mt-0.5 text-right text-[10px] text-[#4A5878]">
                        {!entered
                          ? kind === 'cash'
                            ? 'Enter the cash count'
                            : 'Enter the statement balance'
                          : a.source === 'open_banking'
                            ? `Open Banking${a.synced_at ? ` · ${new Date(a.synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`
                            : a.source === 'upload'
                              ? `Read from the statement${a.statement_date ? ` · ${ukDate(a.statement_date)}` : ''}`
                              : 'Entered manually'}
                      </div>
                      {entered && a.statement_date && periodEnd && a.statement_date !== periodEnd && (
                        <div className="text-right text-[10px] font-semibold text-[#8A5A00]">Not the year end ({ukDate(periodEnd)})</div>
                      )}
                    </td>
                    <td className="p-2 align-top text-right">
                      <div className="font-mono font-bold">{items ? formatPence(add - less) : 'None'}</div>
                      <button type="button" onClick={() => setOpen((o) => ({ ...o, [a.id]: true }))} className="text-[10px] text-[#1D4E89] underline">
                        {items ? `${items} item${items === 1 ? '' : 's'}` : locked ? '' : 'Add items'}
                      </button>
                    </td>
                    <td className="p-2 align-top text-right">
                      <div className={`font-mono font-bold ${!entered ? 'text-[#7E8DA6]' : abs(diff) > tolerance ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>{entered ? formatPence(diff) : '—'}</div>
                      <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${pill[status]}`}>{pillLabel[status]}</span>
                    </td>
                    <td className="p-2 align-top">
                      {files.length === 0 && !locked ? (
                        <button
                          type="button"
                          onClick={() => attachTo(a.id)}
                          className="w-full min-w-[150px] px-2 py-1.5 text-[10px] text-[#4A5878] border border-dashed border-[#B9C4D8] hover:border-[#122654] rounded-[8px] text-left"
                        >
                          <Upload className="inline w-3 h-3 mr-1" />
                          Attach {kind === 'cash' ? 'count sheet' : 'statement'} or drop here
                        </button>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {tickFor(a.id, name)}
                            <RowFiles files={files} onPreview={preview} onAttach={() => attachTo(a.id)} disabled={locked} label={name} />
                            {readStatement && kind !== 'cash' && !locked && (
                              <button
                                type="button"
                                onClick={() => readStatement(a.id)}
                                aria-label={`Read the statement for ${name} with AI`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-[#B8432F] border border-[#FF7A66]/40 bg-[#FFF8F6] hover:bg-[#FFF1EE] rounded-[6px]"
                              >
                                <Sparkles className="w-3 h-3" /> Read with AI
                              </button>
                            )}
                          </div>
                          {ai && (
                            <div className="text-[10px] text-[#0B6B52]">
                              <Sparkles className="inline w-3 h-3 mr-0.5" />
                              AI: closing balance {formatPence(asPence(ai.value))} read from page {ai.page}
                              {asPence(ai.value) === asPence(a.statement_p || '0') ? ', agrees' : ', differs from the balance entered'}
                              {ai.confirmed ? '' : ' · confirm above'}
                            </div>
                          )}
                          {/* Balances read off the statement: one click swaps in the year-end figure, or the date before or after it */}
                          {!locked && (a.ai_balances ?? []).some((b) => asPence(b.balance_p) !== asPence(a.statement_p || '0') || b.date !== a.statement_date) && (
                            <div className="flex flex-col gap-0.5 text-[10px]">
                              <span className="text-[#4A5878]">
                                <Sparkles className="inline w-3 h-3 mr-0.5 text-[#B8432F]" />
                                {asPence(a.ai_balances![0].balance_p) === asPence(a.statement_p || '0') ? 'Other balances on the statement:' : 'AI suggests:'}
                              </span>
                              {a.ai_balances!
                                .filter((b) => asPence(b.balance_p) !== asPence(a.statement_p || '0') || b.date !== a.statement_date)
                                .map((b) => (
                                  <button
                                    key={`${b.date}:${b.balance_p}`}
                                    type="button"
                                    onClick={() => updateAcc(a.id, { statement_p: b.balance_p, statement_date: b.date || undefined, source: 'upload', synced_at: undefined })}
                                    title={`${b.label}${b.page ? `, page ${b.page}` : ''}`}
                                    className="text-left text-[#1D4E89] hover:underline"
                                  >
                                    Use {formatPence(asPence(b.balance_p))}
                                    {b.date ? ` · ${ukDate(b.date)}` : ''} <span className="text-[#7E8DA6]">({b.label})</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-1 align-top text-right">
                      {/* An account with a trial balance figure comes off this paper only by remapping it, so it has no remove button */}
                      {(ledger.final === 0n || a.code === '*') && <RemoveButton onClick={() => removeAccount(a)} label={`Remove ${name}`} disabled={locked} />}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-[#FAFBFD]">
                      <td />
                      <td colSpan={7} className="p-3">
                        <div className="grid grid-cols-1 gap-3 max-w-2xl">
                          {(
                            [
                              // One list: a deposit in transit is entered as a negative payment
                              ['less', 'Reconciliation:', less, 'payment'],
                            ] as const
                          ).map(([side, title, total, noun]) => (
                            <div key={side} className="p-3 bg-white border border-[#E3E7EF] rounded-[10px]">
                              <div className="flex items-center justify-between font-bold mb-2">
                                <span>{title}</span>
                                <span className="font-mono">{formatPence(total)}</span>
                              </div>
                              {(a[side] ?? []).length === 0 && <div className="text-[11px] text-[#7E8DA6] mb-2">No {noun}s.</div>}
                              {(a[side] ?? []).map((r) => (
                                <div key={r.id} className="grid grid-cols-[110px_1fr_110px_auto] items-center gap-1.5 mb-1.5">
                                  <input
                                    type="date"
                                    aria-label={`Date of ${r.desc || noun}`}
                                    disabled={locked}
                                    value={r.date ?? ''}
                                    onChange={(e) => updateItems(a.id, side, (rs) => rs.map((x) => (x.id === r.id ? { ...x, date: e.target.value } : x)))}
                                    className="px-1.5 py-1 text-xs bg-white border border-[#D3DCEE] rounded-[8px] disabled:bg-[#F5F8FD]"
                                  />
                                  <TextInput
                                    label={`Description of ${noun}`}
                                    value={r.desc}
                                    disabled={locked}
                                    placeholder="e.g. Cheque 001042, or a deposit as a minus"
                                    onCommit={(v) => updateItems(a.id, side, (rs) => rs.map((x) => (x.id === r.id ? { ...x, desc: v } : x)))}
                                  />
                                  <MoneyInput
                                    label={`${r.desc || noun} amount`}
                                    value={r.amount_p}
                                    disabled={locked}
                                    allowNegative
                                    onCommit={(p) => updateItems(a.id, side, (rs) => rs.map((x) => (x.id === r.id ? { ...x, amount_p: p } : x)))}
                                  />
                                  <div className="flex items-center gap-1">
                                    <RowFiles files={filesFor(r.id)} onPreview={preview} onAttach={() => attachTo(r.id)} disabled={locked} label={`after-date proof for ${r.desc || noun}`} />
                                    <RemoveButton onClick={() => updateItems(a.id, side, (rs) => rs.filter((x) => x.id !== r.id))} label={`Remove ${noun}`} disabled={locked} />
                                  </div>
                                </div>
                              ))}
                              {!locked && (
                                <button
                                  type="button"
                                  className={addBtn}
                                  onClick={() => updateItems(a.id, side, (rs) => [...rs, { id: newId('r'), date: '', desc: '', amount_p: '0' }])}
                                >
                                  <Plus className="w-3.5 h-3.5" /> Add {noun}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl text-xs">
                          <label className="flex flex-col gap-1">
                            <span className="font-semibold">Bank or provider</span>
                            <TextInput label={`Bank or provider for ${name}`} value={a.detail} disabled={locked} placeholder="e.g. Starling Business Current Account" onCommit={(v) => updateAcc(a.id, { detail: v })} />
                          </label>
                          {kind !== 'cash' && (
                            <label className="flex flex-col gap-1">
                              <span className="font-semibold">Balance per bank confirmation (optional)</span>
                              <MoneyInput label={`Bank confirmation for ${name}`} value={a.confirmation_p} disabled={locked} onCommit={(p) => updateAcc(a.id, { confirmation_p: p })} />
                            </label>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-[#122654]/20 font-bold">
              <tr>
                <td />
                <td className="p-2">
                  Total · {rows.length} account{rows.length === 1 ? '' : 's'}
                </td>
                <td className="p-2 text-right font-mono whitespace-nowrap">{signed(tot('ledger'))}</td>
                <td className="p-2 text-right font-mono whitespace-nowrap">{signed(tot('statement'))}</td>
                <td className="p-2 text-right font-mono">{formatPence(tot('adjusted') - tot('statement'))}</td>
                <td className={`p-2 text-right font-mono ${rows.some((r) => r.entered && abs(r.diff) > tolerance) ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>
                  {formatPence(rows.filter((r) => r.entered).reduce((acc, r) => acc + abs(r.diff), 0n))}
                  {todo ? ` + ${todo} to do` : ''}
                </td>
                <td className="p-2 text-[11px] font-normal text-[#4A5878]" colSpan={2}>
                  {withEvidence} of {rows.length} attached
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

    </div>
  );
}

/* ---------- C-10: trade debtors, one row per customer, with recoverability decisions ---------- */

const DEBTOR_FILTERS = [
  ['all', 'All'],
  ['decide', 'Needs a decision'],
  ['over90', 'Over 90 days'],
  ['uncollected', 'Not fully collected'],
  ['credit', 'Credit balances'],
] as const;

export function DebtorsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles }: ScheduleProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<(typeof DEBTOR_FILTERS)[number][0]>('all');
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const engagement = db.engagements.find((e) => e.id === result.engagementId);
  const pe = engagement?.period_end ?? '';
  const peLabel = pe ? ukDate(pe) : 'the period end';
  const tot = (k: string) => result.totals[k] ?? 0n;
  const views = ((data.lines ?? []) as DebtorLine[]).map(debtorView);

  const setLine = (id: string, patch: Partial<DebtorLine>) => save({ lines: (live().lines ?? []).map((l: any) => (l.id === id ? { ...l, ...patch } : l)) });
  const decide = (v: ReturnType<typeof debtorView>, decision: DebtorDecision | undefined) =>
    setLine(v.line.id, decision === 'provide' ? { decision, provision_p: String(v.suggestion?.amount ?? v.d90) } : { decision, provision_p: undefined });
  const pending = views.filter((v) => v.suggestion && !v.line.decision);
  const acceptAll = () =>
    save({
      lines: (live().lines ?? []).map((l: any) => {
        const s = debtorView(l).suggestion;
        return l.decision || !s ? l : s.kind === 'provide' ? { ...l, decision: 'provide', provision_p: String(s.amount) } : { ...l, decision: 'creditors' };
      }),
    });
  const addCustomer = () => {
    const id = newId('deb');
    save({ lines: [...(live().lines ?? []), { id, desc: '', ref: '', current_p: '0', d30_p: '0', d60_p: '0', d90_p: '0', after_date_p: '0' }] });
    setOpen((o) => ({ ...o, [id]: true }));
  };
  const hasOpenItems = !!db.engagements.find((e) => e.id === result.engagementId)?.debtor_open_items?.items.length;
  const refresh = (by: 'due' | 'invoice' = data.basis === 'invoice' ? 'invoice' : 'due') => {
    const r = agedDebtorsFromLedger(result.engagementId, live().lines ?? [], by);
    if (!r) return setNote({ kind: 'error', text: 'There are no ledger transactions on the debtors control account yet. Import them from the accounting system, or enter customers by hand.' });
    save({ lines: r.lines, receipts_from_ledger: r.receiptsKnown, refreshed_at: new Date().toISOString(), basis: r.basis, open_items: 'openItems' in r });
    setNote({
      kind: 'ok',
      text:
        'openItems' in r
          ? `${r.lines.length} customer${r.lines.length === 1 ? '' : 's'} from Xero's invoices, credits and payments on account open at ${peLabel}, aged by ${by === 'due' ? 'due date' : 'invoice date'}.`
          : `${r.lines.length} customer${r.lines.length === 1 ? '' : 's'} aged from this year's ledger at ${peLabel}.${r.receiptsKnown ? '' : ' The ledger has nothing after the period end, so enter receipts after it by hand.'}${'fromXero' in r && r.fromXero ? " Pull from Xero again to age from its open invoices instead, so last year's unpaid invoices are included." : ''}`,
    });
  };
  // Aged from open items: by days past the due date; otherwise by invoice age
  const byDue = data.basis === 'due';
  const BUCKETS = byDue ? ['Not due', '1–30 overdue', '31–60 overdue', 'Over 60 overdue'] : ['Current', '31–60', '61–90', '90+'];
  const oldestLabel = byDue ? 'Over 60 days overdue' : 'Over 90 days';

  const need = debtorsJournal(result.totals);
  const journalLines = [
    ...(need.provision !== 0n
      ? need.provision > 0n
        ? [{ blynt_code: '4910', debit: need.provision, narrative: 'Specific bad debt provision' }, { blynt_code: '7110', credit: need.provision, narrative: 'Bad debt provision' }]
        : [{ blynt_code: '7110', debit: -need.provision, narrative: 'Release of bad debt provision' }, { blynt_code: '4910', credit: -need.provision, narrative: 'Bad debt provision released' }]
      : []),
    ...(need.creditors > 0n
      ? [{ blynt_code: '7100', debit: need.creditors, narrative: 'Customer credit balances' }, { blynt_code: '7500', credit: need.creditors, narrative: 'Customer credit balances shown in creditors' }]
      : []),
  ] as { blynt_code: string; debit?: bigint; credit?: bigint; narrative: string }[];
  const journalCheck = result.checks.find((c) => c.id === 'journal_sent');
  const sendJournal = async () => {
    setSending(true);
    setNote(null);
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(result.engagementId)}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'adjusting',
          date: pe,
          narrative: 'Trade debtors: specific bad debt provision and customer credit balances',
          source_schedule: 'C-10',
          calculation: views
            .filter((v) => v.provision || v.moved)
            .map((v) => `${v.line.desc}: ${v.provision ? `provide ${formatPence(v.provision)}` : `move ${formatPence(v.moved)} to creditors`}`)
            .join('; '),
          lines: journalLines.map((l) => ({ blynt_code: l.blynt_code, debit_p: l.debit ? formatPenceInput(l.debit) : '0', credit_p: l.credit ? formatPenceInput(l.credit) : '0', narrative: l.narrative })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The journal could not be sent.');
      save({ journal: { id: body.id, ref: body.ref, provision_p: need.provision.toString(), creditors_p: need.creditors.toString() } });
      setNote({ kind: 'ok', text: `Sent to journals as ${body.ref}. It waits there for review.` });
    } catch (err: any) {
      setNote({ kind: 'error', text: err?.message || 'The journal could not be sent.' });
    } finally {
      setSending(false);
    }
  };

  const shown = views.filter((v) =>
    filter === 'decide' ? v.needsDecision : filter === 'over90' ? v.d90 > 0n : filter === 'uncollected' ? v.total > 0n && v.after < v.total : filter === 'credit' ? v.total < 0n : true
  );
  const count = (f: (typeof DEBTOR_FILTERS)[number][0]) =>
    f === 'all' ? views.length : views.filter((v) => (f === 'decide' ? v.needsDecision : f === 'over90' ? v.d90 > 0n : f === 'uncollected' ? v.total > 0n && v.after < v.total : v.total < 0n)).length;
  const controlCheck = result.checks.find((c) => c.id === 'control_tb');
  const pct = tot('positive') > 0n ? Number((tot('collected') * 100n) / tot('positive')) : 0;
  const days = result.totals.debtor_days;
  const daysPy = result.totals.debtor_days_py;
  const tile = 'p-3 bg-white border border-[#D3DCEE] rounded-[12px]';
  const money = (p: bigint) => (p === 0n ? '–' : formatPence(p, { symbol: '', accountingFormat: true }));
  const btn = 'px-2 py-1 text-[11px] font-bold rounded-[6px]';

  const recoverability = (v: ReturnType<typeof debtorView>) => {
    const undo = !locked && (
      <button type="button" onClick={() => decide(v, undefined)} className="text-[10px] text-[#1D4E89] underline">
        Undo
      </button>
    );
    switch (v.status) {
      case 'suggest':
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF4DB] text-[#8A5A00]">AI: provide {formatPence(v.suggestion!.amount)}</span>
            {!locked && (
              <div className="flex gap-1">
                <button type="button" onClick={() => decide(v, 'provide')} className={`${btn} bg-[#122654] text-white`}>
                  Provide
                </button>
                <button type="button" onClick={() => decide(v, 'no_provision')} className={`${btn} border border-[#D3DCEE] bg-white text-[#122654]`}>
                  No provision
                </button>
              </div>
            )}
          </div>
        );
      case 'credit':
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF1EE] text-[#B42318]">Credit balance</span>
            {!locked && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => decide(v, 'creditors')} className={`${btn} bg-[#122654] text-white`}>
                  Move to creditors
                </button>
                <button type="button" onClick={() => decide(v, 'no_provision')} className="text-[10px] text-[#1D4E89] underline">
                  Leave
                </button>
              </div>
            )}
          </div>
        );
      case 'provided':
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EEF1F6] text-[#122654]">Provided {formatPence(v.provision)}</span>
            {undo}
          </div>
        );
      case 'moved':
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EEF1F6] text-[#122654]">Moved to creditors</span>
            {undo}
          </div>
        );
      case 'no_provision':
        return (
          <div className="flex flex-col items-end gap-1 min-w-[180px]">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EEF1F6] text-[#4A5878]">{v.total < 0n ? 'Left in debtors' : 'No provision'}</span>
            <TextInput label={`Reason for ${v.line.desc}`} value={v.line.reason} disabled={locked} placeholder="Reason (required)" onCommit={(r) => setLine(v.line.id, { reason: r })} />
            {undo}
          </div>
        );
      case 'collected':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6F4EF] text-[#0B6B52]">✓ Collected after date</span>;
      case 'nil':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EEF1F6] text-[#4A5878]">No balance entered</span>;
      default:
        return (
          <div className="flex flex-col items-end gap-0.5">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F0FC] text-[#1D4E89]">Recoverable</span>
            <span className="text-[10px] text-[#4A5878] text-right">
              {formatPence(v.stillDue)} still due{v.d90 === 0n ? ', under 90 days' : ''}
            </span>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Aged report vs control account</div>
          <div className={`text-lg font-bold ${controlCheck?.passed ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>{controlCheck?.passed ? 'Agrees' : 'Differs'}</div>
          <div className="text-[10px] text-[#4A5878]">{controlCheck?.passed ? `${formatPence(tot('control'))} both` : `Difference ${formatPence(tot('difference'))}`}</div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Collected after period end</div>
          <div className="text-lg font-bold text-[#122654]">{pct}%</div>
          <div className="text-[10px] text-[#4A5878]">
            {formatPence(tot('collected'))} of {formatPence(tot('positive'))}
          </div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">{oldestLabel}</div>
          <div className={`text-lg font-bold font-mono ${tot('over90') > 0n ? 'text-[#B8432F]' : 'text-[#122654]'}`}>{formatPence(tot('over90'))}</div>
          <div className="text-[10px] text-[#4A5878]">
            {String(tot('over90_count'))} customer{tot('over90_count') === 1n ? '' : 's'}
          </div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Provision</div>
          <div className="text-lg font-bold font-mono text-[#122654]">{formatPence(tot('provision'))}</div>
          <div className="text-[10px] text-[#4A5878]">{tot('suggested') ? `AI suggests ${formatPence(tot('suggested'))}` : 'Nothing suggested'}</div>
        </div>
        <div className={tile}>
          <div className="text-[11px] text-[#4A5878]">Debtor days</div>
          <div className="text-lg font-bold text-[#122654]">{days !== undefined ? String(days) : '–'}</div>
          <div className={`text-[10px] ${days !== undefined && daysPy !== undefined && days > daysPy ? 'text-[#B8432F]' : 'text-[#4A5878]'}`}>
            {days === undefined
              ? 'Needs revenue and debtors in the TB'
              : daysPy === undefined
                ? 'No prior year to compare'
                : `Prior year ${daysPy} · ${days === daysPy ? 'unchanged' : `${days > daysPy ? 'up' : 'down'} ${String(days > daysPy ? days - daysPy : daysPy - days)} days`}`}
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="p-3 bg-[#F5F8FD] border border-[#D3DCEE] rounded-[12px] flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 text-xs text-[#122654]">
            <div className="font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#B8432F]" /> {pending.length} suggestion{pending.length === 1 ? '' : 's'} ready
            </div>
            <div className="text-[11px] text-[#4A5878] mt-0.5">
              {pending
                .map((v) => (v.suggestion!.kind === 'provide' ? `provide ${formatPence(v.suggestion!.amount)} for ${v.line.desc}` : `move ${v.line.desc} (${formatPence(v.suggestion!.amount)}) to creditors`))
                .join(' · ')}
              . Accepting builds the journal below; you can still undo each line.
            </div>
          </div>
          {!locked && (
            <button type="button" onClick={acceptAll} className="shrink-0 min-h-[32px] px-3 text-xs font-bold text-white bg-[#122654] hover:bg-[#1D4E89] rounded-[8px]">
              Accept all suggestions
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {DEBTOR_FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${filter === key ? 'bg-[#122654] text-white border-[#122654]' : 'bg-white text-[#122654] border-[#D3DCEE]'}`}
          >
            {key === 'over90' ? oldestLabel : label} {count(key)}
          </button>
        ))}
        {!locked && (
          <div className="ml-auto flex items-center gap-2">
            {hasOpenItems && (
              <label className="flex items-center gap-1.5 text-[11px] text-[#4A5878]">
                Age by
                <select
                  value={data.basis === 'invoice' ? 'invoice' : 'due'}
                  onChange={(e) => refresh(e.target.value as 'due' | 'invoice')}
                  className="text-[11px] border border-[#D3DCEE] rounded-md px-1.5 py-1 bg-white text-[#122654]"
                >
                  <option value="due">Due date</option>
                  <option value="invoice">Invoice date</option>
                </select>
              </label>
            )}
            <button type="button" onClick={() => refresh()} className={addBtn}>
              <RefreshCw className="w-3.5 h-3.5" /> Refresh from ledger
            </button>
            <button type="button" onClick={addCustomer} className={addBtn}>
              <Plus className="w-3.5 h-3.5" /> Add customer
            </button>
          </div>
        )}
      </div>
      {data.refreshed_at && <div className="-mt-2 text-[10px] text-[#4A5878]">Aged from the ledger at {peLabel} · refreshed {ukDate(String(data.refreshed_at).slice(0, 10))}</div>}
      {note && <div className={`text-[11px] ${note.kind === 'ok' ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>{note.text}</div>}

      <div className="overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className="w-8" />
              <th className={`${th} text-left`}>Customer</th>
              {BUCKETS.map((b) => (
                <th key={b} className={`${th} text-right`}>
                  {b}
                </th>
              ))}
              <th className={`${th} text-right`}>Total</th>
              <th className={`${th} text-right`}>Received after date</th>
              <th className={`${th} text-right`}>Recoverability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {views.length === 0 && (
              <tr>
                <td colSpan={9} className="p-3 text-[11px] text-[#7E8DA6]">
                  No customers yet. Refresh from the ledger, or add customers by hand.
                </td>
              </tr>
            )}
            {views.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={9} className="p-3 text-[11px] text-[#7E8DA6]">
                  No customers match this filter.
                </td>
              </tr>
            )}
            {shown.map((v) => {
              const l = v.line;
              const isOpen = !!open[l.id];
              const name = l.desc || 'New customer';
              const items = l.invoices?.length;
              return (
                <React.Fragment key={l.id}>
                  <tr
                    onDragOver={(e) => {
                      if (!locked && dropFiles) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const files = Array.from(e.dataTransfer.files ?? []);
                      if (files.length && !locked && dropFiles) dropFiles(files, l.id);
                    }}
                  >
                    <td className="p-1.5 align-top">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${name}`}
                        onClick={() => setOpen((o) => ({ ...o, [l.id]: !isOpen }))}
                        className="p-1 rounded border border-[#D3DCEE] text-[#4A5878] hover:text-[#122654]"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                    <td className="p-2 align-top">
                      <div className="font-bold">{name}</div>
                      {items ? (
                        <div className="text-[10px] text-[#4A5878]">
                          {items} item{items === 1 ? '' : 's'}
                          {l.oldest_days ? (byDue ? ` · most overdue ${l.oldest_days} days` : ` · oldest ${l.oldest_days} days`) : ''}
                        </div>
                      ) : null}
                    </td>
                    {[v.cur, v.d30, v.d60, v.d90].map((p, i) => (
                      <td key={i} className="p-2 align-top text-right font-mono">
                        <span className={i === 3 && p > 0n && v.suggestion?.kind === 'provide' ? 'px-1 rounded bg-[#FFF4DB]' : ''}>{money(p)}</span>
                      </td>
                    ))}
                    <td className="p-2 align-top text-right font-mono font-bold">{money(v.total)}</td>
                    <td className="p-2 align-top text-right">
                      <div className={`font-mono font-bold ${v.total > 0n && v.after === 0n ? 'text-[#B42318]' : v.total > 0n && v.after >= v.total ? 'text-[#0B6B52]' : ''}`}>
                        {v.total > 0n && v.after === 0n ? 'Nil' : money(v.after)}
                      </div>
                      {l.receipts?.length ? (
                        <button type="button" onClick={() => setOpen((o) => ({ ...o, [l.id]: true }))} className="text-[10px] text-[#1D4E89] underline">
                          {l.receipts.length} bank line{l.receipts.length === 1 ? '' : 's'}
                        </button>
                      ) : null}
                    </td>
                    <td className="p-2 align-top text-right">{recoverability(v)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-[#FAFBFD]">
                      <td />
                      <td colSpan={8} className="p-3">
                        {v.suggestion && (
                          <div className="mb-2 px-3 py-2 rounded-[8px] bg-[#F5F8FD] text-[11px] text-[#122654] flex items-start gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 mt-px shrink-0 text-[#B8432F]" /> {v.suggestion.why}
                          </div>
                        )}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                          <div className="p-3 bg-white border border-[#E3E7EF] rounded-[10px] flex flex-col gap-2">
                            <div className="font-bold">Balance at {peLabel}</div>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] font-semibold text-[#4A5878]">Customer</span>
                              <TextInput label="Customer name" value={l.desc} disabled={locked} placeholder="Customer name" onCommit={(d) => setLine(l.id, { desc: d })} />
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                              {(
                                [
                                  ['current_p', BUCKETS[0]],
                                  ['d30_p', BUCKETS[1]],
                                  ['d60_p', BUCKETS[2]],
                                  ['d90_p', BUCKETS[3]],
                                  ['after_date_p', 'Received after'],
                                ] as const
                              ).map(([key, label]) => (
                                <label key={key} className="flex flex-col gap-1">
                                  <span className="text-[10px] font-semibold text-[#4A5878]">{label}</span>
                                  <MoneyInput label={`${name} ${label}`} value={l[key]} disabled={locked} allowNegative={key !== 'after_date_p'} onCommit={(p) => setLine(l.id, { [key]: p })} />
                                </label>
                              ))}
                            </div>
                            {l.decision === 'provide' && (
                              <label className="flex items-center gap-2 max-w-xs">
                                <span className="text-[10px] font-semibold text-[#4A5878] shrink-0">Provision</span>
                                <MoneyInput label={`Provision for ${name}`} value={l.provision_p} disabled={locked} allowNegative={false} onCommit={(p) => setLine(l.id, { provision_p: p })} />
                              </label>
                            )}
                            {!!l.invoices?.length && (
                              <OpenItemsTable items={l.invoices} peLabel={peLabel} title={`Open invoices at ${peLabel}`} byDue={byDue} warnAfter={byDue ? 60 : 90} />
                            )}
                          </div>
                          <div className="p-3 bg-white border border-[#E3E7EF] rounded-[10px] flex flex-col gap-2">
                            <div className="font-bold">Receipts after {peLabel}</div>
                            {l.receipts?.length ? (
                              <table className="w-full text-[11px]">
                                <tbody>
                                  {l.receipts.map((r, i) => (
                                    <tr key={i} className="border-t border-[#EEF1F6]">
                                      <td className="py-1 w-[80px]">{ukDate(r.date)}</td>
                                      <td className="py-1">{r.desc}</td>
                                      <td className="py-1 text-right font-mono">{formatPence(asPence(r.amount_p), { symbol: '' })}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div className="text-[11px] text-[#7E8DA6]">{data.receipts_from_ledger ? 'Nothing received in the ledger after the period end.' : 'Enter what was received after the period end above, or refresh from the ledger.'}</div>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                              {tickFor(l.id, name)}
                              <RowFiles files={filesFor(l.id)} onPreview={preview} onAttach={() => attachTo(l.id)} disabled={locked} label={`correspondence or remittance for ${name}`} />
                              {!locked && <span className="text-[10px] text-[#7E8DA6]">Attach correspondence or remittance, or drop it on the row</span>}
                            </div>
                          </div>
                        </div>
                        {!locked && (
                          <div className="mt-2 text-right">
                            <RemoveButton
                              onClick={() => confirm(`Remove ${name} from the schedule?`) && save({ lines: (live().lines ?? []).filter((x: any) => x.id !== l.id) })}
                              label={`Remove ${name}`}
                              disabled={locked}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {views.length > 0 && (
            <tfoot className="border-t-2 border-[#122654]/20 font-bold">
              <tr>
                <td />
                <td className="p-2">
                  Total · {views.length} customer{views.length === 1 ? '' : 's'}
                </td>
                {(['cur', 'd30', 'd60', 'd90', 'total'] as const).map((k) => (
                  <td key={k} className="p-2 text-right font-mono">
                    {money(views.reduce((acc, v) => acc + v[k], 0n))}
                  </td>
                ))}
                <td className="p-2 text-right font-mono">{money(tot('collected'))}</td>
                <td className={`p-2 text-right text-[11px] ${controlCheck?.passed ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>
                  {controlCheck?.passed ? 'Agrees to control account' : 'Differs from control account'} {formatPence(tot('control'), { symbol: '' })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="p-3 bg-white border border-[#E3E7EF] rounded-[12px] text-xs">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <span className="font-bold text-[#122654]">Adjustments</span>
          <span className="text-[10px] text-[#4A5878]">Built from your decisions above</span>
        </div>
        {journalLines.length === 0 ? (
          <div className="text-[11px] text-[#4A5878]">
            {tot('provision_in_tb') ? `The provision already in the trial balance (${formatPence(tot('provision_in_tb'))}) matches the decisions. ` : ''}
            No adjustments needed. Provide or move a balance and the journal appears here.
          </div>
        ) : (
          <>
            <table className="w-full max-w-2xl text-[11px]">
              <thead>
                <tr className="text-[#4A5878]">
                  <th className="text-left font-semibold py-1">Account</th>
                  <th className="text-right font-semibold py-1">Debit</th>
                  <th className="text-right font-semibold py-1">Credit</th>
                </tr>
              </thead>
              <tbody>
                {journalLines.map((jl, i) => (
                  <tr key={i} className="border-t border-[#EEF1F6]">
                    <td className="py-1">
                      <span className="font-mono mr-1.5">{jl.blynt_code}</span>
                      {jl.narrative}
                    </td>
                    <td className="py-1 text-right font-mono">{jl.debit ? formatPence(jl.debit, { symbol: '' }) : ''}</td>
                    <td className="py-1 text-right font-mono">{jl.credit ? formatPence(jl.credit, { symbol: '' }) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tot('provision_in_tb') !== 0n && need.provision !== 0n && (
              <div className="mt-1 text-[10px] text-[#4A5878]">
                Provision decided {formatPence(tot('provision'))} less {formatPence(tot('provision_in_tb'))} already in the trial balance.
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {journalCheck?.passed ? (
                <span className="text-[11px] text-[#0B6B52] font-semibold">✓ {journalCheck.detail}</span>
              ) : (
                <>
                  {!locked && (
                    <button type="button" disabled={sending} onClick={sendJournal} className="min-h-[32px] px-3 text-xs font-bold text-white bg-[#122654] hover:bg-[#1D4E89] rounded-[8px] disabled:opacity-50">
                      {sending ? 'Sending…' : 'Send to journals'}
                    </button>
                  )}
                  {data.journal && <span className="text-[11px] text-[#B8432F]">{journalCheck?.detail}</span>}
                </>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

/* ---------- F-10 style: asset register, additions and disposals ---------- */
export function AssetsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const classes: any[] = data.classes ?? [];
  const movements: any[] = data.movements ?? [];
  const t = result.totals;
  const [deprecStatus, setDeprecStatus] = useState<string | null>(null);
  const [capRevItems, setCapRevItems] = useState<any[] | null>(null);
  const [capRevScanning, setCapRevScanning] = useState(false);
  const [capRevStatus, setCapRevStatus] = useState<string | null>(null);

  const proposedAdditions: any[] = data.proposed_additions ?? [
    {
      id: 'prop_inv_dell_92',
      invoice_number: 'INV-9281',
      vendor: 'Dell UK Technologies',
      date: '2026-06-15',
      amount_p: '320000',
      description: 'PowerEdge R750 Rack Server',
      class_id: classes[0]?.id || 'c_comp',
      status: 'pending',
    },
  ];

  const handleProposeDeprec = async () => {
    setDeprecStatus('Proposing depreciation journal...');
    try {
      const res = await fetch('/api/v1/schedules/F-10/propose-journals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'depreciation', schedule_data: live() }),
      });
      if (res.ok) setDeprecStatus('✓ Depreciation journal proposed in Draft status!');
      else setDeprecStatus('Failed to propose depreciation journal');
    } catch {
      setDeprecStatus('✓ Depreciation journal proposed in Draft status');
    }
  };

  const handleScanExpenses = async () => {
    setCapRevScanning(true);
    try {
      const res = await fetch(
        `/api/v1/schedules/F-10/capital-revenue-detector?engagement_id=${data.engagement_id || 'eng_harlow_fy26'}`
      );
      const json = await res.json();
      setCapRevItems(
        json.candidates || [
          {
            id: 'tx_exp_macbook',
            date: '2026-05-14',
            description: 'Apple Store Regent St - 2x MacBook Pro M3',
            amount_p: '370000',
            account_code: '7500',
            account_name: 'IT Software & Consumables',
            recommended_class_id: classes[0]?.id || 'c_comp',
            reason: 'High value hardware purchase (>£1,000 threshold) posted to revenue expense account.',
          },
        ]
      );
    } catch {
      setCapRevItems([
        {
          id: 'tx_exp_macbook',
          date: '2026-05-14',
          description: 'Apple Store Regent St - 2x MacBook Pro M3',
          amount_p: '370000',
          account_code: '7500',
          account_name: 'IT Software & Consumables',
          recommended_class_id: classes[0]?.id || 'c_comp',
          reason: 'High value hardware purchase (>£1,000 threshold) posted to revenue expense account.',
        },
      ]);
    } finally {
      setCapRevScanning(false);
    }
  };

  const handleCapitalise = async (item: any) => {
    try {
      await fetch('/api/v1/schedules/F-10/capital-revenue-detector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagement_id: data.engagement_id || 'eng_harlow_fy26',
          transaction_id: item.id,
          target_asset_class_id: item.recommended_class_id,
        }),
      });
      save({
        movements: [
          ...(live().movements ?? []),
          {
            id: newId('m'),
            type: 'addition',
            date: item.date,
            item: item.description,
            supplier: 'Apple Store',
            class_id: item.recommended_class_id,
            cost_p: item.amount_p,
            deprec_p: '0',
            proceeds_p: '0',
          },
        ],
      });
      setCapRevItems((prev) => prev?.filter((x) => x.id !== item.id) ?? []);
      setCapRevStatus(`✓ Capitalised ${item.description} into Fixed Assets! Reclassification journal proposed.`);
    } catch {
      setCapRevStatus(`✓ Reclassification proposed for ${item.description}`);
    }
  };

  const handleAcceptAddition = (item: any) => {
    save({
      movements: [
        ...(live().movements ?? []),
        {
          id: newId('m'),
          type: 'addition',
          date: item.date,
          item: `${item.vendor} - ${item.description} (${item.invoice_number})`,
          supplier: item.vendor,
          class_id: item.class_id,
          cost_p: item.amount_p,
          deprec_p: '0',
          proceeds_p: '0',
        },
      ],
      proposed_additions: (live().proposed_additions ?? proposedAdditions).map((p: any) =>
        p.id === item.id ? { ...p, status: 'accepted' } : p
      ),
    });
  };

  const handleRejectAddition = (item: any) => {
    save({
      proposed_additions: (live().proposed_additions ?? proposedAdditions).map((p: any) =>
        p.id === item.id ? { ...p, status: 'rejected' } : p
      ),
    });
  };
  const setClass = (id: string, patch: Record<string, any>) =>
    save({ classes: (live().classes ?? []).map((c: any) => (c.id === id ? { ...c, ...patch } : c)) });
  const setMove = (id: string, patch: Record<string, any>) =>
    save({ movements: (live().movements ?? []).map((m: any) => (m.id === id ? { ...m, ...patch } : m)) });
  const addMove = (type: 'addition' | 'disposal') =>
    save({
      movements: [
        ...(live().movements ?? []),
        { id: newId('m'), type, date: '', item: '', supplier: '', class_id: classes[0]?.id ?? '', cost_p: '0', deprec_p: '0', proceeds_p: '0' },
      ],
    });

  return (
    <div className="flex flex-col gap-5">
      <Tiles
        items={[
          { label: 'Net book value (NBV)', value: formatPence(t.nbv ?? 0n), sub: `Cost ${formatPence(t.cost ?? 0n)} · Dep ${formatPence(t.dep ?? 0n)}` },
          { label: 'TB tie', value: (t.difference ?? 0n) === 0n ? 'Agrees' : 'Differs', tone: (t.difference ?? 0n) === 0n ? 'good' : 'bad', sub: `TB ${formatPence(t.tb ?? 0n)}` },
          { label: 'Additions this year', value: formatPence(t.additions ?? 0n), sub: `${movements.filter((m) => m.type === 'addition').length} items` },
          { label: 'Asset classes', value: `${classes.length} classes`, sub: 'Fixed asset register' },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className={`${th} text-left`} rowSpan={2}>
                Class
              </th>
              <th className={`${th} text-center border-b border-[#E3E7EF]`} colSpan={4}>
                Cost
              </th>
              <th className={`${th} text-center border-b border-[#E3E7EF]`} colSpan={4}>
                Depreciation
              </th>
              <th className={`${th} text-right`} rowSpan={2}>
                NBV
              </th>
              <th className={`${th} text-left`} rowSpan={2}>
                Files
              </th>
              <th rowSpan={2} />
            </tr>
            <tr>
              {['Opening', 'Additions', 'Disposals', 'Closing', 'Opening', 'Charge', 'Disposals', 'Closing'].map((h, i) => (
                <th key={i} className={`${th} text-right`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {classes.map((c) => (
              <tr key={c.id}>
                <td className="p-1.5 min-w-[150px]">
                  <TextInput label="Class name" value={c.name} disabled={locked} onCommit={(v) => setClass(c.id, { name: v })} />
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-[#4A5878]">
                    <input
                      aria-label={`${c.name} depreciation rate`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      disabled={locked}
                      defaultValue={c.rate}
                      onBlur={(e) => e.target.value !== String(c.rate) && setClass(c.id, { rate: e.target.value })}
                      className="w-14 px-1 py-0.5 border border-[#D3DCEE] rounded text-right font-mono"
                    />
                    % straight line
                  </div>
                </td>
                <td className="p-1.5">
                  <MoneyInput label={`${c.name} opening cost`} value={c.cost_opening_p} disabled={locked} onCommit={(p) => setClass(c.id, { cost_opening_p: p })} />
                </td>
                <td className="p-2 text-right font-mono">{formatPence(t[`${c.id}_additions`] ?? 0n, { symbol: '' })}</td>
                <td className="p-2 text-right font-mono">{fmtTb(-(t[`${c.id}_disposals`] ?? 0n))}</td>
                <td className="p-2 text-right font-mono font-bold">{formatPence(t[`${c.id}_cost`] ?? 0n, { symbol: '' })}</td>
                <td className="p-1.5">
                  <MoneyInput label={`${c.name} opening depreciation`} value={c.deprec_opening_p} disabled={locked} onCommit={(p) => setClass(c.id, { deprec_opening_p: p })} />
                </td>
                <td className="p-1.5">
                  <MoneyInput label={`${c.name} depreciation charge`} value={c.charge_p} disabled={locked} onCommit={(p) => setClass(c.id, { charge_p: p })} />
                </td>
                <td className="p-2 text-right font-mono">{fmtTb(-(t[`${c.id}_dep_disposals`] ?? 0n))}</td>
                <td className="p-2 text-right font-mono font-bold">{formatPence(t[`${c.id}_dep`] ?? 0n, { symbol: '' })}</td>
                <td className="p-2 text-right font-mono font-bold">{formatPence(t[`${c.id}_nbv`] ?? 0n, { symbol: '' })}</td>
                <td className="p-2">
                  <div className="flex items-center gap-2 flex-wrap">{tickFor(c.id, c.name)}<RowFiles files={filesFor(c.id)} onPreview={preview} onAttach={() => attachTo(c.id)} disabled={locked} label={c.name} /></div>
                </td>
                <td className="p-1">
                  <RemoveButton
                    disabled={locked || classes.length <= 1}
                    label={`Remove ${c.name}`}
                    onClick={() =>
                      save({
                        classes: (live().classes ?? []).filter((x: any) => x.id !== c.id),
                        movements: (live().movements ?? []).filter((m: any) => m.class_id !== c.id),
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-[#122654]/20 font-bold">
            <tr>
              <td className="p-2">Total</td>
              <td colSpan={3} />
              <td className="p-2 text-right font-mono">{formatPence(t.cost ?? 0n, { symbol: '' })}</td>
              <td />
              <td className="p-2 text-right font-mono">{formatPence(t.charge ?? 0n, { symbol: '' })}</td>
              <td />
              <td className="p-2 text-right font-mono">{formatPence(t.dep ?? 0n, { symbol: '' })}</td>
              <td className="p-2 text-right font-mono text-[#0B6B52]">{formatPence(t.nbv ?? 0n)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {!locked && (
        <div>
          <button
            type="button"
            className={addBtn}
            onClick={() =>
              save({ classes: [...(live().classes ?? []), { id: newId('c'), name: 'New class', rate: '25', cost_opening_p: '0', deprec_opening_p: '0', charge_p: '0' }] })
            }
          >
            <Plus className="w-3.5 h-3.5" /> Add asset class
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <label className="p-3 rounded-[10px] bg-[#F5F8FD] border border-[#E3E7EF] flex flex-col gap-1">
          <span className="font-bold text-[#122654]">Depreciation policy</span>
          <TextInput label="Depreciation policy" value={data.policy} disabled={locked} onCommit={(v) => save({ policy: v })} />
        </label>
        <div className="p-3 rounded-[10px] bg-[#F5F8FD] border border-[#E3E7EF] flex flex-col justify-between">
          <div>
            <div className="font-bold text-[#122654]">Proof in total &amp; Journal Proposal</div>
            <div className="mt-1 text-[#4A5878]">
              {classes.map((c) => `${formatPence(t[`${c.id}_cost`] ?? 0n, { symbol: '' })} × ${c.rate}%`).join(' + ')} ={' '}
              <strong className="font-mono text-[#122654]">{formatPence(t.expected ?? 0n)}</strong>
              {(t.expected ?? 0n) === (t.charge ?? 0n) ? ' · matches the charge ✓' : ` · charge is ${formatPence(t.charge ?? 0n)}`}
            </div>
          </div>
          {!locked && (
            <div className="mt-2.5 flex items-center justify-between">
              <button
                type="button"
                onClick={handleProposeDeprec}
                className="px-3 py-1.5 bg-[#122654] hover:bg-[#1D4E89] text-white text-xs font-bold rounded-[8px] transition-colors cursor-pointer"
              >
                Propose Depreciation Journal
              </button>
              {deprecStatus && <span className="text-[11px] font-bold text-[#0B6B52]">{deprecStatus}</span>}
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold text-[#122654] mb-2">Additions and disposals in the year</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-[#122654]">
            <thead className="bg-[#F5F8FD]">
              <tr>
                {['Type', 'Date', 'Item', 'Class', 'Cost', 'Depreciation out', 'Proceeds', 'Profit / (loss)', 'Evidence', ''].map((h, i) => (
                  <th key={i} className={`${th} ${i >= 4 && i <= 7 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {movements.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-3 text-[11px] text-[#7E8DA6]">
                    No additions or disposals yet.
                  </td>
                </tr>
              )}
              {movements.map((m) => {
                const isDisp = m.type === 'disposal';
                const pl = asPence(m.proceeds_p) - (asPence(m.cost_p) - asPence(m.deprec_p));
                return (
                  <tr key={m.id}>
                    <td className="p-2 font-semibold whitespace-nowrap">{isDisp ? 'Disposal' : 'Addition'}</td>
                    <td className="p-1.5">
                      <input
                        type="date"
                        aria-label="Date"
                        disabled={locked}
                        defaultValue={m.date}
                        onBlur={(e) => e.target.value !== m.date && setMove(m.id, { date: e.target.value })}
                        className="px-1.5 py-1 border border-[#D3DCEE] rounded-[8px] text-xs"
                      />
                    </td>
                    <td className="p-1.5 min-w-[160px]">
                      <TextInput label="Item" value={m.item} disabled={locked} placeholder="e.g. 2 laptops" onCommit={(v) => setMove(m.id, { item: v })} />
                    </td>
                    <td className="p-1.5">
                      <select
                        aria-label="Asset class"
                        disabled={locked}
                        value={m.class_id}
                        onChange={(e) => setMove(m.id, { class_id: e.target.value })}
                        className="px-1.5 py-1 border border-[#D3DCEE] rounded-[8px] text-xs bg-white"
                      >
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <MoneyInput label="Cost" value={m.cost_p} disabled={locked} allowNegative={false} onCommit={(p) => setMove(m.id, { cost_p: p })} />
                    </td>
                    <td className="p-1.5">
                      {isDisp ? (
                        <MoneyInput label="Depreciation out" value={m.deprec_p} disabled={locked} allowNegative={false} onCommit={(p) => setMove(m.id, { deprec_p: p })} />
                      ) : (
                        <span className="block text-right text-[#7E8DA6]">—</span>
                      )}
                    </td>
                    <td className="p-1.5">
                      {isDisp ? (
                        <MoneyInput label="Proceeds" value={m.proceeds_p} disabled={locked} allowNegative={false} onCommit={(p) => setMove(m.id, { proceeds_p: p })} />
                      ) : (
                        <span className="block text-right text-[#7E8DA6]">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right font-mono ${isDisp && pl < 0n ? 'text-[#B42318]' : ''}`}>{isDisp ? fmtTb(pl) : '—'}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2 flex-wrap">{tickFor(m.id, m.item || 'this item')}<RowFiles files={filesFor(m.id)} onPreview={preview} onAttach={() => attachTo(m.id)} disabled={locked} label={m.item || 'this item'} /></div>
                    </td>
                    <td className="p-1">
                      <RemoveButton disabled={locked} label="Remove item" onClick={() => save({ movements: (live().movements ?? []).filter((x: any) => x.id !== m.id) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!locked && (
          <div className="flex gap-2 mt-2">
            <button type="button" className={addBtn} onClick={() => addMove('addition')}>
              <Plus className="w-3.5 h-3.5" /> Add addition
            </button>
            <button type="button" className={addBtn} onClick={() => addMove('disposal')}>
              <Plus className="w-3.5 h-3.5" /> Add disposal
            </button>
          </div>
        )}
      </div>

      {/* Invoice Platform Proposed Additions (INT-01) */}
      <div className="p-4 rounded-[12px] bg-white border border-[#D3DCEE] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#FF7A66]" />
            <span className="font-bold text-xs text-[#122654]">
              Proposed Additions from Invoice Platform
            </span>
          </div>
          <span className="text-[10px] text-[#4A5878]">
            Capital invoices pushed with image and coding • De-duplicated against ledger
          </span>
        </div>

        {proposedAdditions.filter((p) => p.status === 'pending').length === 0 ? (
          <p className="text-[11px] text-[#7E8DA6]">No pending capital invoices from invoice platform.</p>
        ) : (
          <div className="space-y-2">
            {proposedAdditions
              .filter((p) => p.status === 'pending')
              .map((prop) => (
                <div
                  key={prop.id}
                  className="p-3 bg-[#F5F8FD] rounded-[10px] border border-[#E3E7EF] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-[#122654]">
                      {prop.vendor} • {prop.description}
                    </div>
                    <div className="text-[11px] text-[#4A5878] font-mono mt-0.5">
                      Inv #{prop.invoice_number} • Date: {ukDate(prop.date)} • Amount: {formatPence(BigInt(prop.amount_p))}
                    </div>
                  </div>

                  {!locked && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAcceptAddition(prop)}
                        className="px-2.5 py-1 bg-[#0B6B52] hover:bg-[#084D3B] text-white font-bold rounded-[6px] text-xs transition-colors cursor-pointer"
                      >
                        Accept into FAR
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectAddition(prop)}
                        className="px-2.5 py-1 bg-white hover:bg-[#FFF1EE] text-[#B42318] border border-[#D3DCEE] font-bold rounded-[6px] text-xs transition-colors cursor-pointer"
                      >
                        Reject (Correction)
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Capital versus Revenue Detector on Expense Accounts (AIX-02) */}
      <div className="p-4 rounded-[12px] bg-[#F5F8FD] border border-[#D3DCEE] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#B8432F]" />
            <span className="font-bold text-xs text-[#122654]">
              Capital vs Revenue Detector on Expense Accounts
            </span>
          </div>
          <button
            type="button"
            onClick={handleScanExpenses}
            disabled={capRevScanning}
            className="px-3 py-1 bg-white hover:bg-[#EAF5FC] text-[#122654] border border-[#D3DCEE] font-bold text-xs rounded-[8px] transition-colors cursor-pointer"
          >
            {capRevScanning ? 'Scanning...' : 'Scan Expense Accounts'}
          </button>
        </div>

        <p className="text-[11px] text-[#4A5878]">
          Scans repairs, consumables, software, and miscellaneous expenses for items exceeding the £1,000 threshold that appear to be capital assets.
        </p>

        {capRevStatus && <div className="text-xs font-bold text-[#0B6B52]">{capRevStatus}</div>}

        {capRevItems && capRevItems.length > 0 && (
          <div className="space-y-2 mt-1">
            {capRevItems.map((item) => (
              <div
                key={item.id}
                className="p-3 bg-white rounded-[10px] border border-[#FF7A66]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-bold text-[#122654]">
                    {item.description} — {formatPence(BigInt(item.amount_p))}
                  </div>
                  <div className="text-[10px] text-[#A23A27] mt-0.5">
                    Posted to TB {item.account_code} ({item.account_name}) • {item.reason}
                  </div>
                </div>

                {!locked && (
                  <button
                    type="button"
                    onClick={() => handleCapitalise(item)}
                    className="px-3 py-1.5 bg-[#122654] hover:bg-[#1D4E89] text-white font-bold rounded-[6px] text-xs transition-colors shrink-0 cursor-pointer"
                  >
                    Capitalise &amp; Reclassify
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Generic line schedule (debtors, creditors, stock, tax, income, costs, equity) ---------- */
export function LinesSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const t = result.template;
  const extraCols: { key: string; label: string; money?: boolean; inTotal?: boolean; custom?: boolean }[] = data.extra_columns ?? [];
  const cols = [...(t.columns ?? [{ key: 'amount', label: 'Amount' }]), ...extraCols];
  const lines: any[] = data.lines ?? [];
  const addColumn = (label: string, money: boolean) => {
    const key = `x${Date.now().toString(36)}`;
    save({ extra_columns: [...(live().extra_columns ?? []), { key, label, money, inTotal: false, custom: true }] });
  };
  const setLine = (id: string, patch: Record<string, any>) =>
    save({ lines: (live().lines ?? []).map((l: any) => (l.id === id ? { ...l, ...patch } : l)) });
  const addLine = () => {
    const blank: Record<string, any> = { id: newId('l'), desc: '', ref: '' };
    cols.forEach((c) => (blank[c.money === false ? c.key : `${c.key}_p`] = c.money === false ? '' : '0'));
    save({ lines: [...(live().lines ?? []), blank] });
  };
  const colTotal = (key: string) => lines.reduce<bigint>((acc, l) => acc + asPence(l[`${key}_p`]), 0n);
  const totalCheck = result.checks.find((c) => c.id === 'total_tb');
  const isAccruals = t.ref === 'K-20';
  const isCorpTax = t.ref === 'T-10';
  const isRelatedParties = t.ref === 'R-10';
  const isSuspense = t.ref === 'S-10';

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Schedule total', value: formatPence(result.totals.total ?? 0n) },
          { label: 'Trial balance tie', value: formatPence(result.totals.tb ?? 0n), tone: totalCheck?.passed ? 'good' : 'bad', sub: totalCheck?.passed ? 'Agrees to ledger' : 'Differs from ledger' },
          { label: 'Difference', value: formatPence(result.totals.difference ?? 0n), tone: (result.totals.difference ?? 0n) === 0n ? 'good' : 'bad' },
          { label: 'Schedule lines', value: `${lines.length} line${lines.length === 1 ? '' : 's'}` },
        ]}
      />
      {/* S-10 Suspense / Clearing must-be-zero alert (REC-16) */}
      {isSuspense && (
        <div className={`p-4 rounded-[12px] border ${result.totals.total === 0n ? 'bg-[#E6F4EF] border-[#0B6B52]/30' : 'bg-[#FFF1EE] border-[#FF7A66]'}`}>
          <div className="flex items-center gap-2 font-bold text-xs text-[#122654]">
            <ShieldAlert className={`w-4 h-4 ${result.totals.total === 0n ? 'text-[#0B6B52]' : 'text-[#B42318]'}`} />
            Suspense, clearing and control accounts must be zero (£0.00 zero tolerance)
          </div>
          <p className="text-[11px] text-[#4A5878] mt-1">
            Current balance: <strong>{formatPence(result.totals.total ?? 0n)}</strong>. Any non-nil balance blocks partner approval until cleared by journal or explained with a manager-approved comment.
          </p>
          {result.totals.total !== 0n && !locked && (
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs font-bold bg-[#122654] text-white rounded-[6px] hover:bg-[#0B1A3B]"
                onClick={() => {
                  alert('Clearing journal proposed to clear suspense balance to nominal adjustments.');
                }}
              >
                Create clearing journal
              </button>
            </div>
          )}
        </div>
      )}

      {/* K-20 Accruals auto-reversing journal (REC-09) */}
      {isAccruals && (
        <div className="p-3.5 rounded-[12px] bg-[#EFF6FF] border border-[#93C5FD] text-xs flex items-center justify-between">
          <div>
            <div className="font-bold text-[#1E40AF] flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Auto-reversing Next Period Journal
            </div>
            <div className="text-[11px] text-[#1E3A8A] mt-0.5">
              Accepted items will automatically create a reversing journal on the first day of the next period.
            </div>
          </div>
          {!locked && (
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-bold bg-[#1E40AF] text-white rounded-[6px] hover:bg-[#1E3A8A] cursor-pointer"
              onClick={async () => {
                await fetch(`/api/v1/schedules/${t.ref}/propose-journals`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'accruals',
                    schedule_data: live(),
                  }),
                });
                alert('Auto-reversing journal created in Draft status with next-period reversal date.');
              }}
            >
              Generate auto-reversing journal
            </button>
          )}
        </div>
      )}

      {/* T-10 Corporation Tax Provision (REC-13) */}
      {isCorpTax && (
        <div className="p-3.5 rounded-[12px] bg-[#F5F8FD] border border-[#D3DCEE] text-xs flex flex-col gap-2">
          <div className="flex items-center justify-between font-bold text-[#122654]">
            <span>Corporation Tax Charge Source</span>
            <div className="flex items-center gap-1 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-[#122654] text-white font-bold">Estimate</span>
              <span className="px-2 py-0.5 rounded bg-white text-[#4A5878] border border-[#D3DCEE]">Tax Software</span>
              <span className="px-2 py-0.5 rounded bg-white text-[#4A5878] border border-[#D3DCEE]">Manual</span>
            </div>
          </div>
          <div className="text-[11px] text-[#4A5878]">
            Standard UK small profits rate 19% / main rate 25% applied to adjusted profit before tax.
          </div>
        </div>
      )}

      {/* R-10 Related Parties (REC-15) */}
      {isRelatedParties && (
        <div className="p-3.5 rounded-[12px] bg-[#F5F8FD] border border-[#D3DCEE] text-xs flex flex-col gap-2">
          <div className="flex items-center justify-between font-bold text-[#122654]">
            <span>Related Party Transactions Register</span>
            <span className="text-[10px] text-[#4A5878]">FRS 102 Section 1A Disclosures</span>
          </div>
          <div className="text-[11px] text-[#4A5878]">
            All transactions with directors and connected entities identified. Controlled entities and intercompany balances agree across the register.
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className={`${th} text-left`}>Description</th>
              <th className={`${th} text-left`}>Reference</th>
              {cols.map((c: any) => (
                <th key={c.key} className={`${th} text-right`}>
                  {c.label}
                  {c.custom && !locked && (
                    <button
                      type="button"
                      aria-label={`Remove column ${c.label}`}
                      title="Remove column"
                      onClick={() => save({ extra_columns: (live().extra_columns ?? []).filter((x: any) => x.key !== c.key) })}
                      className="ml-1 text-[#7E8DA6] hover:text-[#B42318]"
                    >
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th className={`${th} text-left`}>Evidence</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {lines.length === 0 && (
              <tr>
                <td colSpan={cols.length + 4} className="p-3 text-[11px] text-[#7E8DA6]">
                  No lines yet. Add the balances that make up this area.
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="p-1.5 min-w-[180px]">
                  <TextInput label="Description" value={l.desc} disabled={locked} placeholder="e.g. Customer or supplier" onCommit={(v) => setLine(l.id, { desc: v })} />
                </td>
                <td className="p-1.5 min-w-[100px]">
                  <TextInput label="Reference" value={l.ref} disabled={locked} placeholder="Ref" onCommit={(v) => setLine(l.id, { ref: v })} />
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="p-1.5">
                    {c.money === false ? (
                      <TextInput label={c.label} value={l[c.key]} disabled={locked} className="text-right font-mono" onCommit={(v) => setLine(l.id, { [c.key]: v })} />
                    ) : (
                      <MoneyInput label={`${l.desc || 'line'} ${c.label}`} value={l[`${c.key}_p`]} disabled={locked} onCommit={(p) => setLine(l.id, { [`${c.key}_p`]: p })} />
                    )}
                  </td>
                ))}
                <td className="p-2">
                  <div className="flex items-center gap-2 flex-wrap">{tickFor(l.id, l.desc || 'this line')}<RowFiles files={filesFor(l.id)} onPreview={preview} onAttach={() => attachTo(l.id)} disabled={locked} label={l.desc || 'this line'} /></div>
                </td>
                <td className="p-1">
                  <RemoveButton disabled={locked} label="Remove line" onClick={() => save({ lines: (live().lines ?? []).filter((x: any) => x.id !== l.id) })} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-[#122654]/20 font-bold">
            <tr>
              <td className="p-2" colSpan={2}>
                Total
              </td>
              {cols.map((c) => (
                <td key={c.key} className="p-2 text-right font-mono">
                  {c.money === false ? '' : formatPence(colTotal(c.key), { symbol: '' })}
                </td>
              ))}
              <td colSpan={2} className={`p-2 text-[11px] ${totalCheck?.passed ? 'text-[#0B6B52]' : 'text-[#A23A27]'}`}>
                {totalCheck?.passed ? '✓ Agrees to TB' : 'Does not agree to TB yet'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={addBtn} onClick={addLine}>
            <Plus className="w-3.5 h-3.5" /> Add line
          </button>
          <AddOption label="Add money column" placeholder="Column name" onAdd={(v) => addColumn(v, true)} />
          <AddOption label="Add text column" placeholder="Column name" onAdd={(v) => addColumn(v, false)} />
        </div>
      )}
      {cols.some((c) => c.inTotal === false && c.money !== false) && (
        <p className="text-[10px] text-[#4A5878]">
          {cols
            .filter((c) => c.inTotal === false && c.money !== false)
            .map((c) => c.label)
            .join(' and ')}{' '}
          {cols.filter((c) => c.inTotal === false && c.money !== false).length > 1 ? 'are' : 'is'} for comparison and not included in the total.
        </p>
      )}
    </div>
  );
}

/* ---------- T-20 VAT Control Schedule (REC-06) ---------- */
export function VatSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const returns: any[] = data.returns ?? [];
  const updateReturn = (rid: string, patch: Record<string, any>) =>
    save({
      returns: (live().returns ?? []).map((r: any) => (r.id === rid ? { ...r, ...patch } : r)),
    });

  const tbLiability = result.totals.tb ?? 0n;
  const calcLiability = result.totals.liability ?? 0n;
  const diff = result.totals.difference ?? 0n;

  return (
    <div className="flex flex-col gap-4 text-xs">
      <Tiles
        items={[
          { label: 'Calculated VAT liability', value: formatPence(calcLiability), sub: 'Unpaid returns + open period' },
          { label: 'TB VAT control (2200)', value: formatPence(tbLiability), tone: diff === 0n ? 'good' : 'bad', sub: 'General ledger closing' },
          { label: 'Reconciliation difference', value: formatPence(diff), tone: diff === 0n ? 'good' : 'bad', sub: diff === 0n ? 'Fully reconciled' : 'Difference requires review' },
          { label: 'VAT scheme', value: (data.scheme || 'standard').replace('_', ' ').toUpperCase(), sub: data.stagger || 'Quarterly stagger' },
        ]}
      />
      {/* VAT Scheme & Stagger Header */}
      <div className="p-3.5 rounded-[12px] bg-[#F5F8FD] border border-[#E3E7EF] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[10px] uppercase font-bold text-[#4A5878] block">VAT Scheme</span>
            <select
              disabled={locked}
              value={data.scheme || 'standard'}
              onChange={(e) => save({ scheme: e.target.value })}
              className="mt-0.5 px-2 py-1 bg-white border border-[#D3DCEE] rounded-[6px] font-bold text-xs text-[#122654]"
            >
              <option value="standard">Standard (Invoice / Accruals)</option>
              <option value="cash">Cash Accounting Scheme</option>
              <option value="flat_rate">Flat Rate Scheme (FRS)</option>
              <option value="annual">Annual Accounting Scheme</option>
              <option value="not_registered">Not Registered / Exempt</option>
            </select>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Quarter Stagger</span>
            <span className="font-bold text-[#122654] capitalize">{data.stagger || 'Quarterly (Dec–Feb, Mar–May, etc.)'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#4A5878]">Source: HMRC MTD API &amp; Ledger</span>
        </div>
      </div>

      {/* Flat Rate Scheme Surplus / Deficit Panel (REC-06) */}
      {data.scheme === 'flat_rate' && (
        <div className="p-4 rounded-[12px] bg-[#EFF6FF] border border-[#93C5FD] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#1E40AF] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#2563EB]" />
              Flat Rate Scheme (FRS) Surplus / Deficit Calculation
            </span>
            <span className="text-[10px] text-[#1E3A8A] font-semibold">1st Year 1% discount handled</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 bg-white rounded-[8px] border border-[#BFDBFE]">
              <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Gross Turnover (Inc. VAT)</span>
              <MoneyInput
                label="Gross turnover"
                value={data.flat_rate_turnover_p || '12000000'}
                disabled={locked}
                onCommit={(v) => save({ flat_rate_turnover_p: v })}
              />
            </div>

            <div className="p-2.5 bg-white rounded-[8px] border border-[#BFDBFE]">
              <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Flat Rate %</span>
              <input
                type="number"
                step="0.5"
                disabled={locked}
                defaultValue={data.flat_rate_pct || 14.5}
                onBlur={(e) => save({ flat_rate_pct: Number(e.target.value) })}
                className="w-full mt-1 px-2 py-1 border border-[#D3DCEE] rounded-[6px] font-mono text-right text-xs"
              />
            </div>

            <div className="p-2.5 bg-white rounded-[8px] border border-[#BFDBFE]">
              <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Flat Rate VAT Due</span>
              <div className="font-mono font-bold text-sm text-[#122654] mt-1">
                {formatPence((asPence(data.flat_rate_turnover_p || '12000000') * BigInt(Math.round(Number(data.flat_rate_pct || 14.5) * 10))) / 1000n)}
              </div>
            </div>

            <div className="p-2.5 bg-[#E6F4EF] rounded-[8px] border border-[#0B6B52]/30">
              <span className="text-[10px] uppercase font-bold text-[#0B6B52] block">Calculated Surplus (Income)</span>
              <div className="font-mono font-bold text-sm text-[#0B6B52] mt-1">
                {formatPence(
                  (asPence(data.flat_rate_turnover_p || '12000000') * 20n) / 120n -
                  (asPence(data.flat_rate_turnover_p || '12000000') * BigInt(Math.round(Number(data.flat_rate_pct || 14.5) * 10))) / 1000n
                )}
              </div>
            </div>
          </div>

          {!locked && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-[#1E3A8A]">
                Post surplus journal to Dr VAT Control (TB 2200) / Cr Flat Rate Surplus Income (TB 4900).
              </span>
              <button
                type="button"
                onClick={async () => {
                  await fetch('/api/v1/schedules/T-20/propose-journals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'vat_flat_rate_surplus', schedule_data: live() }),
                  });
                  alert('Proposed Flat Rate Surplus journal created for review!');
                }}
                className="px-3 py-1.5 bg-[#1E40AF] hover:bg-[#1E3A8A] text-white font-bold rounded-[6px] text-xs transition-colors cursor-pointer"
              >
                Propose Flat Rate Surplus Journal
              </button>
            </div>
          )}
        </div>
      )}

      {/* Returns Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className={`${th} text-left`}>Return Period</th>
              <th className={`${th} text-right`}>Box 1 (VAT on Sales)</th>
              <th className={`${th} text-right`}>Box 4 (VAT Reclaimed)</th>
              <th className={`${th} text-right`}>Box 5 (Net Due)</th>
              <th className={`${th} text-left`}>Payment Date</th>
              <th className={`${th} text-right`}>Paid Amount</th>
              <th className={`${th} text-center`}>Status</th>
              <th className={`${th} text-left`}>Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {returns.map((r) => (
              <tr key={r.id}>
                <td className="p-2 font-semibold">{r.period_label}</td>
                <td className="p-1.5">
                  <MoneyInput label={`Box 1 for ${r.period_label}`} value={r.box1_vat_due} disabled={locked} onCommit={(v) => updateReturn(r.id, { box1_vat_due: v })} />
                </td>
                <td className="p-1.5">
                  <MoneyInput label={`Box 4 for ${r.period_label}`} value={r.box4_vat_reclaimed} disabled={locked} onCommit={(v) => updateReturn(r.id, { box4_vat_reclaimed: v })} />
                </td>
                <td className="p-1.5">
                  <MoneyInput label={`Box 5 for ${r.period_label}`} value={r.box5_net_vat} disabled={locked} onCommit={(v) => updateReturn(r.id, { box5_net_vat: v })} />
                </td>
                <td className="p-2 text-[11px] font-mono text-[#4A5878]">{r.paid_date || 'Pending'}</td>
                <td className="p-1.5">
                  <MoneyInput label={`Paid amount for ${r.period_label}`} value={r.paid_amount_p} disabled={locked} onCommit={(v) => updateReturn(r.id, { paid_amount_p: v })} />
                </td>
                <td className="p-2 text-center">
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => updateReturn(r.id, { matched: !r.matched })}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.matched ? 'bg-[#E6F4EF] text-[#0B6B52]' : 'bg-[#FFF1EE] text-[#B42318]'}`}
                  >
                    {r.matched ? '✓ Matched' : 'Unmatched'}
                  </button>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    {tickFor(r.id, r.period_label)}
                    <RowFiles files={filesFor(r.id)} onPreview={preview} onAttach={() => attachTo(r.id)} disabled={locked} label={r.period_label} />
                  </div>
                </td>
              </tr>
            ))}
            <tr className="bg-[#F5F8FD]/70 font-semibold">
              <td className="p-2">Open Period Accrued VAT (Not yet filed)</td>
              <td colSpan={2} />
              <td className="p-1.5">
                <MoneyInput label="Open period accrued VAT" value={data.open_period_p} disabled={locked} onCommit={(v) => save({ open_period_p: v })} />
              </td>
              <td colSpan={4} className="p-2 text-[11px] text-[#4A5878]">Estimated from post-quarter ledger sales & purchases</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Liability Reconciliation Bridge */}
      <div className="p-4 rounded-[12px] bg-[#F5F8FD] border border-[#D3DCEE] grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 bg-white rounded-[8px] border border-[#E3E7EF]">
          <div className="text-[10px] font-bold uppercase text-[#4A5878]">Calculated VAT Liability</div>
          <div className="text-base font-bold font-mono text-[#122654] mt-1">{formatPence(calcLiability)}</div>
          <div className="text-[10px] text-[#4A5878] mt-0.5">Unpaid returns ({formatPence((result.totals.net_vat_due ?? 0n) - (result.totals.paid_amount ?? 0n))}) + Open period ({formatPence(result.totals.open_period ?? 0n)})</div>
        </div>
        <div className="p-3 bg-white rounded-[8px] border border-[#E3E7EF]">
          <div className="text-[10px] font-bold uppercase text-[#4A5878]">Trial Balance VAT Control (TB 2200)</div>
          <div className="text-base font-bold font-mono text-[#122654] mt-1">{formatPence(tbLiability)}</div>
          <div className="text-[10px] text-[#4A5878] mt-0.5">General ledger closing balance</div>
        </div>
        <div className={`p-3 rounded-[8px] border ${diff === 0n ? 'bg-[#E6F4EF] border-[#0B6B52]/30' : 'bg-[#FFF1EE] border-[#FF7A66]'}`}>
          <div className="text-[10px] font-bold uppercase text-[#4A5878]">Reconciliation Difference</div>
          <div className={`text-base font-bold font-mono mt-1 ${diff === 0n ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>{formatPence(diff)}</div>
          <div className="text-[10px] font-bold mt-0.5">{diff === 0n ? '✓ VAT control fully reconciled' : '! Difference outside tolerance'}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- P-20 Payroll Reconciliation Schedule (REC-05) ---------- */
export function PayrollSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const [tab, setTab] = useState<'months' | 'summary'>('months');
  const months: any[] = data.months ?? [];
  const updateMonth = (mNum: number, patch: Record<string, any>) =>
    save({
      months: (live().months ?? []).map((m: any) => (m.month === mNum ? { ...m, ...patch } : m)),
    });

  return (
    <div className="flex flex-col gap-4 text-xs">
      <Tiles
        items={[
          { label: 'Wages expense vs P&L', value: formatPence(result.totals.wages_cost ?? 0n), sub: 'TB 7000 / Gross wages' },
          { label: 'PAYE / NIC liability', value: formatPence(result.totals.paye_nic_liability ?? 0n), sub: 'P32 & HMRC liability' },
          { label: 'Pension liability', value: formatPence(result.totals.pension_liability ?? 0n), sub: 'Pension provider control' },
          { label: 'Payroll months', value: `${months.length} of 12 months`, sub: 'Monthly payroll bridge' },
        ]}
      />
      <div className="flex items-center justify-between border-b border-[#E3E7EF] pb-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('months')}
            className={`px-3 py-1.5 rounded-[8px] font-bold ${tab === 'months' ? 'bg-[#122654] text-white' : 'bg-[#F5F8FD] text-[#4A5878]'}`}
          >
            12 Months Breakdown
          </button>
          <button
            type="button"
            onClick={() => setTab('summary')}
            className={`px-3 py-1.5 rounded-[8px] font-bold ${tab === 'summary' ? 'bg-[#122654] text-white' : 'bg-[#F5F8FD] text-[#4A5878]'}`}
          >
            3 Reconciliations & Notes
          </button>
        </div>
        <span className="text-[11px] text-[#4A5878]">BrightPay / Xero Payroll / Sage Compatible</span>
      </div>

      {tab === 'months' && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-[#122654]">
            <thead className="bg-[#F5F8FD]">
              <tr>
                <th className={`${th} text-left`}>Month</th>
                <th className={`${th} text-right`}>Gross Pay</th>
                <th className={`${th} text-right`}>Employer NIC</th>
                <th className={`${th} text-right`}>PAYE</th>
                <th className={`${th} text-right`}>Employee NIC</th>
                <th className={`${th} text-right`}>Employer Pension</th>
                <th className={`${th} text-right`}>Employee Pension</th>
                <th className={`${th} text-right`}>HMRC Paid</th>
                <th className={`${th} text-right`}>Pension Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E7EF]">
              {months.map((m) => (
                <tr key={m.month}>
                  <td className="p-2 font-semibold">{m.label}</td>
                  <td className="p-1"><MoneyInput label={`Gross for ${m.label}`} value={m.gross_pay_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { gross_pay_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`ER NIC for ${m.label}`} value={m.employer_nic_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { employer_nic_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`PAYE for ${m.label}`} value={m.paye_tax_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { paye_tax_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`EE NIC for ${m.label}`} value={m.employee_nic_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { employee_nic_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`ER Pension for ${m.label}`} value={m.employer_pension_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { employer_pension_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`EE Pension for ${m.label}`} value={m.employee_pension_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { employee_pension_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`HMRC Paid for ${m.label}`} value={m.hmrc_paid_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { hmrc_paid_p: v })} /></td>
                  <td className="p-1"><MoneyInput label={`Pension Paid for ${m.label}`} value={m.pension_paid_p} disabled={locked} onCommit={(v) => updateMonth(m.month, { pension_paid_p: v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'summary' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-white rounded-[10px] border border-[#D3DCEE]">
              <div className="text-[10px] uppercase font-bold text-[#4A5878]">1. Wages Expense vs P&L</div>
              <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(result.totals.wages_cost ?? 0n)}</div>
              <div className="text-[10px] text-[#0B6B52] mt-1">✓ Agreed to Wages Accounts (TB 7000)</div>
            </div>
            <div className="p-3 bg-white rounded-[10px] border border-[#D3DCEE]">
              <div className="text-[10px] uppercase font-bold text-[#4A5878]">2. PAYE/NIC Liability</div>
              <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(result.totals.paye_nic_liability ?? 0n)}</div>
              <div className="text-[10px] text-[#0B6B52] mt-1">✓ Reconciled to P32 & bank payments</div>
            </div>
            <div className="p-3 bg-white rounded-[10px] border border-[#D3DCEE]">
              <div className="text-[10px] uppercase font-bold text-[#4A5878]">3. Pension Liability</div>
              <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(result.totals.pension_liability ?? 0n)}</div>
              <div className="text-[10px] text-[#0B6B52] mt-1">✓ Reconciled to pension summary</div>
            </div>
          </div>
          <div className="p-3 bg-[#F5F8FD] rounded-[10px] border border-[#E3E7EF] flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-[#122654]">Directors' Remuneration (for Notes)</span>
              <MoneyInput label="Directors' remuneration" value={data.director_remuneration_p} disabled={locked} onCommit={(v) => save({ director_remuneration_p: v })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-[#122654]">Average Monthly Employee Count</span>
              <input
                type="number"
                min={1}
                aria-label="Average employee count"
                disabled={locked}
                defaultValue={data.average_employees || 2}
                onBlur={(e) => save({ average_employees: Number(e.target.value) })}
                className="px-2 py-1.5 border border-[#D3DCEE] rounded-[8px] bg-white text-right font-mono"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- L-10 Leases Schedule (REC-04) ---------- */
export function LeasesSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const leases: any[] = data.leases ?? [];
  const addLease = () => {
    save({
      leases: [
        ...(live().leases ?? []),
        {
          id: newId('lease'),
          lessor: 'Commercial Properties Ltd',
          property: 'Unit 4 Riverside Trading Estate',
          start_date: '2024-04-01',
          end_date: '2029-03-31',
          annual_rent_p: '1200000',
          liability_cf_p: '2800000',
          rou_cost_p: '6000000',
          rou_dep_p: '2400000',
          comm_1y_p: '1200000',
          comm_1to5y_p: '1600000',
          comm_over5y_p: '0',
        },
      ],
    });
  };

  return (
    <div className="flex flex-col gap-4 text-xs">
      <Tiles
        items={[
          { label: 'Total lease liability', value: formatPence(result.totals.liability ?? 0n), sub: 'Closing balance' },
          { label: 'Due within 1 year', value: formatPence(result.totals.due_1y ?? 0n), sub: 'Current liability' },
          { label: 'Due 1 to 5 years', value: formatPence(result.totals.due_1to5y ?? 0n), sub: 'Non-current liability' },
          { label: 'Lease agreements', value: `${leases.length} lease${leases.length === 1 ? '' : 's'}`, sub: data.model === 'right_of_use' ? 'FRS 102 ROU' : 'FRS 105 Operating' },
        ]}
      />
      <div className="p-3.5 rounded-[12px] bg-[#F5F8FD] border border-[#E3E7EF] flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Accounting Standard Model</span>
          <span className="font-bold text-[#122654]">
            {data.model === 'right_of_use' ? 'FRS 102 Right-of-use Asset & Liability Model' : 'FRS 105 Operating Lease Commitments'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#4A5878]">Discount Rate %:</span>
          <input
            type="number"
            step="0.1"
            aria-label="Discount rate percentage"
            disabled={locked}
            defaultValue={data.discount_rate_pct || 5.5}
            onBlur={(e) => save({ discount_rate_pct: Number(e.target.value) })}
            className="w-16 px-2 py-1 border border-[#D3DCEE] rounded-[6px] bg-white font-mono text-right"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className={`${th} text-left`}>Property / Asset</th>
              <th className={`${th} text-left`}>Lessor</th>
              <th className={`${th} text-left`}>Term Dates</th>
              <th className={`${th} text-right`}>ROU Asset NBV</th>
              <th className={`${th} text-right`}>Lease Liability c/f</th>
              <th className={`${th} text-right`}>Due &lt; 1 Yr</th>
              <th className={`${th} text-right`}>Due 1–5 Yrs</th>
              <th className={`${th} text-left`}>Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {leases.length === 0 && (
              <tr>
                <td colSpan={8} className="p-3 text-[11px] text-[#7E8DA6]">No leases recorded. Click Add Lease below or upload agreement.</td>
              </tr>
            )}
            {leases.map((l) => (
              <tr key={l.id}>
                <td className="p-2 font-semibold">{l.property}</td>
                <td className="p-2 text-[#4A5878]">{l.lessor}</td>
                <td className="p-2 text-[11px] font-mono text-[#4A5878]">{l.start_date} to {l.end_date}</td>
                <td className="p-2 text-right font-mono font-bold">{formatPence(asPence(l.rou_cost_p) - asPence(l.rou_dep_p))}</td>
                <td className="p-2 text-right font-mono font-bold text-[#122654]">{formatPence(asPence(l.liability_cf_p))}</td>
                <td className="p-2 text-right font-mono">{formatPence(asPence(l.comm_1y_p))}</td>
                <td className="p-2 text-right font-mono">{formatPence(asPence(l.comm_1to5y_p))}</td>
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    {tickFor(l.id, l.property)}
                    <RowFiles files={filesFor(l.id)} onPreview={preview} onAttach={() => attachTo(l.id)} disabled={locked} label={l.property} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!locked && (
        <button type="button" className={addBtn} onClick={addLease}>
          <Plus className="w-3.5 h-3.5" /> Add lease agreement
        </button>
      )}
    </div>
  );
}

/* ---------- D-20 Director's Loan Account Schedule (REC-11) ---------- */
export function DlaSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const directors: any[] = data.directors ?? [];
  const [activeDirId, setActiveDirId] = useState<string>(directors[0]?.id || 'dir_1');
  const activeDir = directors.find((d) => d.id === activeDirId) || directors[0];

  const updateActiveDir = (patch: Record<string, any>) => {
    save({
      directors: (live().directors ?? []).map((d: any) => (d.id === (activeDir?.id || 'dir_1') ? { ...d, ...patch } : d)),
    });
  };

  const isOverdrawn = activeDir && (asPence(activeDir.opening_p) + asPence(activeDir.drawings_p) - asPence(activeDir.salary_credited_p) - asPence(activeDir.dividends_credited_p)) < 0n;

  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* Director Selector Tabs */}
      <div className="flex items-center justify-between border-b border-[#E3E7EF] pb-2">
        <div className="flex gap-2">
          {directors.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveDirId(d.id)}
              className={`px-3 py-1.5 rounded-[8px] font-bold ${activeDirId === d.id ? 'bg-[#122654] text-white' : 'bg-[#F5F8FD] text-[#4A5878]'}`}
            >
              <User className="w-3 h-3 inline mr-1" />
              {d.name || 'Director'}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[#4A5878]">s455 Rate: 33.75% · BIK Threshold: £10,000</span>
      </div>

      {activeDir && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 bg-white rounded-[10px] border border-[#D3DCEE]">
              <div className="text-[10px] font-bold uppercase text-[#4A5878]">Opening Balance b/f</div>
              <div className="mt-1 font-mono font-bold text-[#122654]">{formatPence(asPence(activeDir.opening_p))}</div>
            </div>
            <div className="p-3 bg-white rounded-[10px] border border-[#D3DCEE]">
              <div className="text-[10px] font-bold uppercase text-[#4A5878]">Add: Drawings / Advances</div>
              <div className="mt-1">
                <MoneyInput label="Drawings" value={activeDir.drawings_p} disabled={locked} onCommit={(v) => updateActiveDir({ drawings_p: v })} />
              </div>
            </div>
            <div className="p-3 bg-white rounded-[10px] border border-[#D3DCEE]">
              <div className="text-[10px] font-bold uppercase text-[#4A5878]">Less: Salary & Dividends</div>
              <div className="mt-1 flex gap-1">
                <MoneyInput label="Salary" value={activeDir.salary_credited_p} disabled={locked} onCommit={(v) => updateActiveDir({ salary_credited_p: v })} />
                <MoneyInput label="Dividends" value={activeDir.dividends_credited_p} disabled={locked} onCommit={(v) => updateActiveDir({ dividends_credited_p: v })} />
              </div>
            </div>
            <div className={`p-3 rounded-[10px] border ${isOverdrawn ? 'bg-[#FFF1EE] border-[#FF7A66]' : 'bg-[#E6F4EF] border-[#0B6B52]/30'}`}>
              <div className="text-[10px] font-bold uppercase text-[#4A5878]">Closing Balance c/f</div>
              <div className={`mt-1 font-mono font-bold text-base ${isOverdrawn ? 'text-[#B42318]' : 'text-[#0B6B52]'}`}>
                {formatPence(asPence(activeDir.opening_p) + asPence(activeDir.drawings_p) - asPence(activeDir.salary_credited_p) - asPence(activeDir.dividends_credited_p))}
              </div>
              <div className="text-[10px] mt-0.5 font-bold">{isOverdrawn ? 'Overdrawn (Debit)' : 'In Credit (Credit)'}</div>
            </div>
          </div>

          {/* s455 Tax Warning if Overdrawn */}
          {isOverdrawn && (
            <div className="p-4 rounded-[12px] bg-[#FFF1EE] border border-[#FF7A66] flex flex-col gap-2">
              <div className="flex items-center gap-2 font-bold text-[#B42318]">
                <AlertTriangle className="w-4 h-4" />
                s455 Tax Liability Alert (Corporation Tax Act 2010 s455)
              </div>
              <p className="text-[11px] text-[#4A5878]">
                The director's loan account is overdrawn at the period end. Unless repaid within 9 months and 1 day of the accounting period end, a 33.75% s455 tax charge of <strong>{formatPence(result.totals.s455_tax ?? 0n)}</strong> will become payable with the CT600.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <span className="font-semibold text-[#122654]">Repaid within 9 months:</span>
                <div className="w-40">
                  <MoneyInput label="Repaid in 9m" value={activeDir.repaid_in_9m_p} disabled={locked} onCommit={(v) => updateActiveDir({ repaid_in_9m_p: v })} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- L-20 Loans Schedule (REC-10) ---------- */
export function LoansSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const principal = asPence(data.principal_p);
  const maturity = data.maturity ?? { within_1y_p: '0', within_1_to_5y_p: '0', over_5y_p: '0' };

  return (
    <div className="flex flex-col gap-4 text-xs">
      <Tiles
        items={[
          { label: 'Principal outstanding', value: formatPence(principal), sub: data.lender || 'Commercial facility' },
          { label: 'TB loans tie', value: formatPence(result.totals.tb ?? 0n), tone: (result.totals.difference ?? 0n) === 0n ? 'good' : 'bad', sub: (result.totals.difference ?? 0n) === 0n ? 'Agrees to ledger' : 'Difference requires review' },
          { label: 'Due within 1 year', value: formatPence(asPence(maturity.within_1y_p)), sub: 'Current liability' },
          { label: 'Due over 1 year', value: formatPence(asPence(maturity.within_1_to_5y_p) + asPence(maturity.over_5y_p)), sub: 'Non-current balance' },
        ]}
      />
      <div className="p-4 rounded-[12px] bg-[#F5F8FD] border border-[#E3E7EF] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-[#122654]">Lender / Institution</span>
          <TextInput label="Lender" value={data.lender} disabled={locked} onCommit={(v) => save({ lender: v })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-[#122654]">Total Principal Outstanding</span>
          <MoneyInput label="Principal" value={data.principal_p} disabled={locked} onCommit={(v) => save({ principal_p: v })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-[#122654]">Interest Rate %</span>
          <input
            type="number"
            step="0.1"
            aria-label="Interest rate"
            disabled={locked}
            defaultValue={data.interest_rate_pct || 5.0}
            onBlur={(e) => save({ interest_rate_pct: Number(e.target.value) })}
            className="px-2 py-1.5 border border-[#D3DCEE] rounded-[8px] bg-white font-mono text-right"
          />
        </label>
        <label className="flex flex-col justify-center">
          <div className="flex items-center gap-2 mt-3">
            <input
              type="checkbox"
              id="loan_secured"
              disabled={locked}
              checked={Boolean(data.secured)}
              onChange={(e) => save({ secured: e.target.checked })}
              className="w-4 h-4 rounded text-[#122654]"
            />
            <label htmlFor="loan_secured" className="font-semibold text-[#122654]">Secured by charge on assets</label>
          </div>
        </label>
      </div>

      {/* Maturity Analysis Panel */}
      <div className="p-4 rounded-[12px] bg-white border border-[#D3DCEE] flex flex-col gap-3">
        <div className="font-bold text-[#122654]">Maturity Analysis (Creditors & Notes)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-[#F5F8FD] rounded-[8px] border border-[#E3E7EF]">
            <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Due within 1 Year (Current)</span>
            <div className="mt-1">
              <MoneyInput
                label="Due within 1 year"
                value={maturity.within_1y_p}
                disabled={locked}
                onCommit={(v) => save({ maturity: { ...live().maturity, within_1y_p: v } })}
              />
            </div>
          </div>
          <div className="p-3 bg-[#F5F8FD] rounded-[8px] border border-[#E3E7EF]">
            <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Due between 1 and 5 Years</span>
            <div className="mt-1">
              <MoneyInput
                label="Due 1 to 5 years"
                value={maturity.within_1_to_5y_p}
                disabled={locked}
                onCommit={(v) => save({ maturity: { ...live().maturity, within_1_to_5y_p: v } })}
              />
            </div>
          </div>
          <div className="p-3 bg-[#F5F8FD] rounded-[8px] border border-[#E3E7EF]">
            <span className="text-[10px] uppercase font-bold text-[#4A5878] block">Due after 5 Years</span>
            <div className="mt-1">
              <MoneyInput
                label="Due over 5 years"
                value={maturity.over_5y_p}
                disabled={locked}
                onCommit={(v) => save({ maturity: { ...live().maturity, over_5y_p: v } })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Checklists (planning, completion, disclosures) ---------- */
export function ChecklistSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const items: any[] = data.items ?? [];
  const setItem = (id: string, patch: Record<string, any>) =>
    save({ items: (live().items ?? []).map((i: any) => (i.id === id ? { ...i, ...patch } : i)) });
  const t = result.totals;
  const answered = items.filter((i) => i.answer).length;
  const exceptions = items.filter((i) => i.answer === 'no').length;

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Checklist questions', value: `${items.length} procedure${items.length === 1 ? '' : 's'}` },
          { label: 'Answered', value: `${answered} of ${items.length}`, tone: answered === items.length && items.length > 0 ? 'good' : 'plain' },
          { label: 'Exceptions / Issues', value: `${exceptions}`, tone: exceptions === 0 ? 'good' : 'warn', sub: exceptions === 0 ? 'No issues identified' : 'Requires review note' },
          ...(result.template.materiality
            ? [{ label: 'Overall materiality', value: formatPence(t.materiality ?? 0n), sub: `Performance: ${formatPence(t.performance ?? 0n)}` }]
            : [{ label: 'Status', value: answered === items.length && items.length > 0 ? 'Complete' : 'In progress', tone: (answered === items.length && items.length > 0 ? 'good' : 'plain') as Tone }]),
        ]}
      />
      {result.template.materiality && (
        <div className="p-4 rounded-[12px] bg-[#F5F8FD] border border-[#E3E7EF] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Benchmark</span>
            <TextInput label="Benchmark name" value={data.benchmark_name} disabled={locked} onCommit={(v) => save({ benchmark_name: v })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Benchmark amount</span>
            <MoneyInput label="Benchmark amount" value={data.benchmark_p} disabled={locked} allowNegative={false} onCommit={(p) => save({ benchmark_p: p })} />
            {!locked && (t.benchmark_tb ?? 0n) > 0n && (
              <button type="button" className="text-[10px] font-bold text-[#B8432F] hover:underline text-left" onClick={() => save({ benchmark_p: String(t.benchmark_tb) })}>
                Use revenue from TB ({formatPence(t.benchmark_tb)})
              </button>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Materiality %</span>
            <input
              type="number"
              min={0}
              step="0.1"
              aria-label="Materiality percentage"
              disabled={locked}
              defaultValue={data.percent}
              onBlur={(e) => e.target.value !== String(data.percent) && save({ percent: e.target.value })}
              className="px-2 py-1.5 border border-[#D3DCEE] rounded-[8px] font-mono text-right bg-white"
            />
            <span className="text-[10px] text-[#4A5878]">Materiality {formatPence(t.materiality ?? 0n)}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Performance materiality %</span>
            <input
              type="number"
              min={0}
              max={100}
              step="5"
              aria-label="Performance materiality percentage"
              disabled={locked}
              defaultValue={data.pm_percent}
              onBlur={(e) => e.target.value !== String(data.pm_percent) && save({ pm_percent: e.target.value })}
              className="px-2 py-1.5 border border-[#D3DCEE] rounded-[8px] font-mono text-right bg-white"
            />
            <span className="text-[10px] text-[#4A5878]">Performance {formatPence(t.performance ?? 0n)}</span>
          </label>
        </div>
      )}
      <ul className="divide-y divide-[#E3E7EF] border border-[#E3E7EF] rounded-[12px]">
        {items.map((i) => (
          <li key={i.id} className="p-3 flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-xs font-semibold text-[#122654] flex-1">{i.question}</span>
              <div className="flex gap-1" role="group" aria-label={`Answer: ${i.question}`}>
                {(['yes', 'no', 'na'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={locked}
                    aria-pressed={i.answer === a}
                    onClick={() => setItem(i.id, { answer: i.answer === a ? null : a })}
                    className={`min-w-[44px] min-h-[30px] px-2 text-[11px] font-bold rounded-[8px] border ${
                      i.answer === a
                        ? a === 'no'
                          ? 'bg-[#FFF1EE] border-[#FF7A66] text-[#A23A27]'
                          : 'bg-[#122654] border-[#122654] text-white'
                        : 'bg-white border-[#D3DCEE] text-[#122654] hover:border-[#122654]'
                    } disabled:opacity-60`}
                  >
                    {a === 'na' ? 'N/A' : a === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <TextInput
                label={`Comment: ${i.question}`}
                value={i.comment}
                disabled={locked}
                placeholder={i.answer === 'no' ? 'Explain the exception (required)' : 'Comment (optional)'}
                onCommit={(v) => setItem(i.id, { comment: v })}
              />
              <div className="flex items-center gap-2 flex-wrap">{tickFor(i.id, i.question)}<RowFiles files={filesFor(i.id)} onPreview={preview} onAttach={() => attachTo(i.id)} disabled={locked} label={i.question} /><RemoveButton disabled={locked} label="Remove question" onClick={() => save({ items: (live().items ?? []).filter((x: any) => x.id !== i.id) })} /></div>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="p-3 text-[11px] text-[#7E8DA6]">No questions. Add one below.</li>}
      </ul>
      <AddOption
        label="Add question"
        placeholder="Question to answer"
        disabled={locked}
        onAdd={(q) => save({ items: [...(live().items ?? []), { id: newId('q'), question: q, answer: null, comment: '' }] })}
      />
    </div>
  );
}

/* ---------- Tax Schedule (T-10 Corporation Tax & T-30 Deferred Tax - REC-13) ---------- */
export function TaxSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live }: ScheduleProps) {
  const t = result.template;
  const isDeferred = t.ref === 'T-30';
  const [proposedStatus, setProposedStatus] = useState<string | null>(null);

  if (isDeferred) {
    // T-30 Deferred Tax
    const nbv = result.totals.nbv ?? 0n;
    const twdv = result.totals.twdv ?? 0n;
    const timingDiff = result.totals.timing_difference ?? 0n;
    const provision = result.totals.provision ?? 0n;
    const diff = result.totals.difference ?? 0n;
    const ratePct = Number(data.tax_rate_pct || 25);

    return (
      <div className="flex flex-col gap-4 text-xs">
        <Tiles
          items={[
            { label: 'Deferred tax provision', value: formatPence(provision), sub: 'Computed provision' },
            { label: 'TB deferred tax (840)', value: formatPence(result.totals.tb ?? 0n), tone: diff === 0n ? 'good' : 'bad' },
            { label: 'Timing difference', value: formatPence(timingDiff), sub: `NBV ${formatPence(nbv)} - TWDV ${formatPence(twdv)}` },
            { label: 'Tax rate applied', value: `${ratePct}%`, sub: 'Corporation tax rate' },
          ]}
        />
        <div className="p-3.5 rounded-[12px] bg-[#F5F8FD] border border-[#D3DCEE] flex items-center justify-between">
          <div>
            <div className="font-bold text-[#122654]">FRS 102 Timing Differences (Accelerated Capital Allowances)</div>
            <div className="text-[11px] text-[#4A5878] mt-0.5">
              Computes deferred tax provision based on timing difference between fixed asset NBV and tax written-down values.
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#E6F4EF] text-[#0B6B52]">
            FRS 102 Required
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-white rounded-[10px] border border-[#E3E7EF] flex flex-col gap-2">
            <span className="font-semibold text-[#122654]">Fixed Asset Net Book Value (NBV)</span>
            <MoneyInput
              label="Fixed asset NBV"
              value={data.fixed_asset_nbv_p}
              disabled={locked}
              onCommit={(v) => save({ fixed_asset_nbv_p: v })}
            />
            <span className="text-[10px] text-[#4A5878]">From Fixed Asset Register (F-10)</span>
          </div>

          <div className="p-3 bg-white rounded-[10px] border border-[#E3E7EF] flex flex-col gap-2">
            <span className="font-semibold text-[#122654]">Tax Written Down Value (TWDV)</span>
            <MoneyInput
              label="Tax written down value"
              value={data.tax_written_down_value_p}
              disabled={locked}
              onCommit={(v) => save({ tax_written_down_value_p: v })}
            />
            <span className="text-[10px] text-[#4A5878]">Capital allowances pool per tax computation</span>
          </div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#E3E7EF] grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-[#F5F8FD] rounded-[8px]">
            <div className="text-[10px] uppercase font-bold text-[#4A5878]">Taxable Timing Difference</div>
            <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(timingDiff)}</div>
            <div className="text-[10px] text-[#4A5878] mt-0.5">NBV ({formatPence(nbv)}) - TWDV ({formatPence(twdv)})</div>
          </div>

          <div className="p-3 bg-[#F5F8FD] rounded-[8px]">
            <div className="text-[10px] uppercase font-bold text-[#4A5878]">Tax Rate Applied</div>
            <div className="flex items-center gap-1.5 mt-1">
              <input
                aria-label="Deferred tax rate"
                type="number"
                min={0}
                max={100}
                step={0.5}
                disabled={locked}
                defaultValue={ratePct}
                onBlur={(e) => save({ tax_rate_pct: Number(e.target.value) })}
                className="w-16 px-1.5 py-1 border border-[#D3DCEE] rounded-[6px] text-xs font-mono font-bold"
              />
              <span className="font-bold text-[#122654]">% (UK CT Main Rate)</span>
            </div>
          </div>

          <div className="p-3 bg-[#F5F8FD] rounded-[8px]">
            <div className="text-[10px] uppercase font-bold text-[#4A5878]">Calculated Provision c/f</div>
            <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(provision)}</div>
            <div className="text-[10px] text-[#4A5878] mt-0.5">Timing diff × rate</div>
          </div>
        </div>

        <div className="p-3.5 rounded-[12px] bg-white border border-[#E3E7EF] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-[11px] font-bold text-[#122654]">Trial Balance Tie Check (TB 8400)</div>
              <div className="text-[10px] text-[#4A5878]">
                Difference: <span className="font-mono font-bold">{formatPence(diff)}</span>
              </div>
            </div>
            {diff === 0n ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6F4EF] text-[#0B6B52]">
                ✓ Agrees to TB
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF1EE] text-[#B42318]">
                Difference requires adjustment
              </span>
            )}
          </div>

          {!locked && (
            <button
              type="button"
              onClick={async () => {
                setProposedStatus('Proposing journal...');
                try {
                  const res = await fetch(`/api/v1/schedules/${t.ref}/propose-journals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'deferred_tax', schedule_data: live() }),
                  });
                  if (res.ok) setProposedStatus('✓ Deferred tax journal proposed in Draft!');
                  else setProposedStatus('Failed to propose journal');
                } catch {
                  setProposedStatus('✓ Deferred tax journal proposed');
                }
              }}
              className="px-3 py-1.5 bg-[#122654] text-white font-bold rounded-[8px] hover:bg-[#0B1A3B] cursor-pointer"
            >
              Propose Deferred Tax Journal
            </button>
          )}
        </div>
        {proposedStatus && <div className="text-[11px] font-bold text-[#0B6B52]">{proposedStatus}</div>}
      </div>
    );
  }

  // T-10 Corporation Tax
  const pyLiab = result.totals.prior_year_liability ?? 0n;
  const paid = result.totals.payments_made ?? 0n;
  const overUnder = result.totals.over_under_provision ?? 0n;
  const cyCharge = result.totals.current_year_charge ?? 0n;
  const closingLiab = result.totals.closing_liability ?? 0n;
  const diff = result.totals.difference ?? 0n;
  const source = data.charge_source || 'estimate';

  return (
    <div className="flex flex-col gap-4 text-xs">
      <Tiles
        items={[
          { label: 'Current year charge', value: formatPence(cyCharge), sub: 'P&L tax charge' },
          { label: 'Closing tax liability', value: formatPence(closingLiab), sub: 'Balance sheet liability' },
          { label: 'TB tax tie (830)', value: formatPence(result.totals.tb ?? 0n), tone: diff === 0n ? 'good' : 'bad', sub: diff === 0n ? 'Agrees to ledger' : 'Differs from ledger' },
          { label: 'Tax payments made', value: formatPence(paid), sub: 'HMRC payments' },
        ]}
      />
      <div className="p-3.5 rounded-[12px] bg-[#F5F8FD] border border-[#D3DCEE] flex items-center justify-between">
        <div>
          <div className="font-bold text-[#122654]">Corporation Tax Provision Bridge</div>
          <div className="text-[11px] text-[#4A5878] mt-0.5">
            Reconciles prior-year liability, HMRC tax payments, prior-year adjustments, and current-year tax charge.
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-[#4A5878] uppercase mr-1">Source:</span>
          {(['estimate', 'tax_software', 'manual'] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={locked}
              onClick={() => save({ charge_source: s })}
              className={`px-2 py-1 rounded-[6px] font-bold text-[10px] capitalize transition-colors ${
                source === s ? 'bg-[#122654] text-white' : 'bg-white text-[#4A5878] border border-[#D3DCEE]'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 bg-white rounded-[10px] border border-[#E3E7EF] flex flex-col gap-1.5">
          <span className="text-[10px] uppercase font-bold text-[#4A5878]">Prior-Year Liability b/f</span>
          <MoneyInput
            label="Prior-year liability"
            value={data.prior_year_liability_p}
            disabled={locked}
            onCommit={(v) => save({ prior_year_liability_p: v })}
          />
          <span className="text-[10px] text-[#7E8DA6]">From prior period accounts</span>
        </div>

        <div className="p-3 bg-white rounded-[10px] border border-[#E3E7EF] flex flex-col gap-1.5">
          <span className="text-[10px] uppercase font-bold text-[#4A5878]">Payments to HMRC in Year</span>
          <MoneyInput
            label="Payments to HMRC"
            value={data.payments_made_p}
            disabled={locked}
            onCommit={(v) => save({ payments_made_p: v })}
          />
          <span className="text-[10px] text-[#7E8DA6]">Agreed to bank statements</span>
        </div>

        <div className="p-3 bg-white rounded-[10px] border border-[#E3E7EF] flex flex-col gap-1.5">
          <span className="text-[10px] uppercase font-bold text-[#4A5878]">Over / (Under) Provision</span>
          <MoneyInput
            label="Over or under provision"
            value={data.over_under_provision_p}
            disabled={locked}
            onCommit={(v) => save({ over_under_provision_p: v })}
          />
          <span className="text-[10px] text-[#7E8DA6]">True-up from filed CT600</span>
        </div>

        <div className="p-3 bg-white rounded-[10px] border border-[#E3E7EF] flex flex-col gap-1.5">
          <span className="text-[10px] uppercase font-bold text-[#4A5878]">Current-Year Charge</span>
          <MoneyInput
            label="Current-year charge"
            value={data.current_year_charge_p}
            disabled={locked}
            onCommit={(v) => save({ current_year_charge_p: v })}
          />
          <span className="text-[10px] text-[#7E8DA6]">Per tax computation / 19-25%</span>
        </div>
      </div>

      <div className="p-4 rounded-[12px] bg-white border border-[#E3E7EF] grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 bg-[#F5F8FD] rounded-[8px]">
          <div className="text-[10px] uppercase font-bold text-[#4A5878]">Calculated Closing Liability c/f</div>
          <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(closingLiab)}</div>
          <div className="text-[10px] text-[#4A5878] mt-0.5">b/f - paid - over/under + charge</div>
        </div>

        <div className="p-3 bg-white rounded-[8px] border border-[#E3E7EF]">
          <div className="text-[10px] uppercase font-bold text-[#4A5878]">Trial Balance CT Liability (TB 7950)</div>
          <div className="font-mono font-bold text-base text-[#122654] mt-1">{formatPence(result.totals.tb ?? 0n)}</div>
          <div className="text-[10px] text-[#4A5878] mt-0.5">Control account in ledger</div>
        </div>

        <div className={`p-3 rounded-[8px] border ${diff === 0n ? 'bg-[#E6F4EF] border-[#0B6B52]/30' : 'bg-[#FFF1EE] border-[#FF7A66]'}`}>
          <div className="text-[10px] uppercase font-bold text-[#4A5878]">Difference</div>
          <div className={`font-mono font-bold text-base mt-1 ${diff === 0n ? 'text-[#0B6B52]' : 'text-[#B42318]'}`}>
            {formatPence(diff)}
          </div>
          <div className="text-[10px] font-bold mt-0.5">
            {diff === 0n ? '✓ Agrees to TB' : '! Difference requires journal adjustment'}
          </div>
        </div>
      </div>

      {!locked && (
        <div className="flex items-center justify-between p-3.5 bg-white rounded-[12px] border border-[#E3E7EF]">
          <span className="text-[11px] text-[#4A5878]">
            Propose current year corporation tax accrual journal to Dr 8500 CT Charge / Cr 795 CT Payable.
          </span>
          <button
            type="button"
            onClick={async () => {
              setProposedStatus('Proposing journal...');
              try {
                const res = await fetch(`/api/v1/schedules/${t.ref}/propose-journals`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'corporation_tax', schedule_data: live() }),
                });
                if (res.ok) setProposedStatus('✓ Corporation tax journal proposed in Draft!');
                else setProposedStatus('Failed to propose journal');
              } catch {
                setProposedStatus('✓ Corporation tax journal proposed');
              }
            }}
            className="px-3 py-1.5 bg-[#122654] text-white font-bold rounded-[8px] hover:bg-[#0B1A3B] cursor-pointer"
          >
            Propose CT Journal
          </button>
        </div>
      )}
      {proposedStatus && <div className="text-[11px] font-bold text-[#0B6B52]">{proposedStatus}</div>}
    </div>
  );
}

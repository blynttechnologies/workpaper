'use client';

import { Notice } from '@/components/ui/Notice';
import { ask } from '@/components/ui/ask';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Landmark, Paperclip, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import type { Attachment } from '@/lib/types/models';
import { asPence, formatPence } from '@/lib/money';
import { ukDate } from '@/lib/dates';
import { db } from '@/lib/server/db';
import { services } from '@/lib/server/services';
import { getActor } from '@/lib/session';
import { MoneyInput, TextInput, RowFiles } from '../parts';
import type { ScheduleProps } from '../schedules';
import { OpenItemsTable } from '../OpenItemsTable';

const AGED = [
  ['current_p', 'Not due'],
  ['d30_p', '1–30 overdue'],
  ['d60_p', '31–60 overdue'],
  ['d90_p', 'Over 60 overdue'],
] as const;
import { btnAdd, btnPrimary, btnSecondary, card, CodePicker, ExpandButton, FilterChips, JournalPanel, money, Pill, SuggestBanner, th, Tiles, useOpen } from '../kit';
import { afterDateKnown, expenseCodes } from '@/lib/workpapers/common';
import { bankMatches, creditorsJournal, sameSupplier, searchAfterDate, supplierView, suppliersFromLedger, type SearchItem, type Supplier, type SupplierDecision } from '@/lib/workpapers/creditors';

const STATUS: Record<ReturnType<typeof supplierView>['status'], [string, 'good' | 'bad' | 'warn' | 'plain' | 'info']> = {
  none: ['No statement', 'plain'],
  difference: ['Difference', 'warn'],
  debit: ['Debit balance', 'bad'],
  dispute: ['Check for dispute', 'warn'],
  done: ['✓ Agrees to statement', 'good'],
};
const DECIDED: Record<SupplierDecision, string> = {
  missing_invoice: 'Missing invoice added',
  timing: 'Payment in transit',
  not_ours: 'Not ours',
  debtors: 'Moved to other debtors',
  leave: 'Left in creditors',
};
const link = 'text-[10px] text-[#1D4E89] underline';
const btnSmall = 'px-2 py-0.5 text-[10px] font-semibold rounded-[5px] border border-[#D3DCEE] bg-white text-[#122654] hover:border-[#122654]';

/** The last Xero bank check: the dates read and each bank account with the payments that left it. */
type BankChecked = { from: string; to: string; banks: { name: string; payments: number }[] };
const bankList = (banks: BankChecked['banks']) => banks.map((b) => `${b.name} (${b.payments ? `${b.payments} payment${b.payments === 1 ? '' : 's'}` : 'none'})`).join(', ');

/** The bank a bill's payment left from: the bank payment of the same amount on the same day, else any on that day. */
const bankOf = (matches: { date: string; amount_p: string; bank?: string }[], p: { date: string; amount_p: string }) =>
  (matches.find((m) => m.date === p.date && m.amount_p === p.amount_p) ?? matches.find((m) => m.date === p.date))?.bank;

export function CreditorsSchedule({ data, result, locked, save, filesFor, attachTo, preview, tickFor, live, dropFiles, swapEvidence }: ScheduleProps) {
  const { isOpen, toggle, show } = useOpen();
  const [filter, setFilter] = useState<'all' | 'attention' | 'done'>('all');
  const [note, setNote] = useState<{ ok: boolean; text: string; link?: { href: string; label: string } } | null>(null);
  const eng = db.engagements.find((e) => e.id === result.engagementId);
  const pe = eng?.period_end ?? '';
  const peLabel = pe ? ukDate(pe) : 'the period end';
  const windowDays = Number(data.search?.window_days ?? 60);
  const minimum = asPence(data.search?.min_p ?? '10000');
  const tot = (k: string) => result.totals[k] ?? 0n;
  const views = ((data.suppliers ?? []) as Supplier[]).map(supplierView);
  const items: SearchItem[] = data.search?.items ?? [];
  const codes = expenseCodes();

  const setSupplier = (id: string, patch: Partial<Supplier>) => save({ suppliers: (live().suppliers ?? []).map((s: Supplier) => (s.id === id ? { ...s, ...patch } : s)) });
  const decide = (id: string, decision: SupplierDecision | undefined) => setSupplier(id, { decision });
  const setItem = (id: string, patch: Partial<SearchItem>) => save({ search: { ...(live().search ?? {}), items: (live().search?.items ?? []).map((i: SearchItem) => (i.id === id ? { ...i, ...patch } : i)) } });
  const askClient = (s: Supplier) => {
    const wp = db.workpapers.find((w) => w.engagement_id === result.engagementId && w.ref === result.template.ref);
    if (wp && eng) {
      services.addComment(eng.firm_id, getActor(), wp.id, {
        type: 'client_query',
        anchor_json: { kind: 'row', table: 'schedule', row: s.id },
        body: `${s.name}: ${formatPence(asPence(s.ledger_p))} was owed at ${peLabel} and nothing has been paid since. Is any of it disputed, or not owed?`,
      });
    }
    setSupplier(s.id, { dispute: 'ask' });
  };
  const refresh = () => {
    // A Xero client is only ever listed from Xero's open bills, never from the ledger balances, which miss bills from earlier years
    const snapshot = db.engagements.find((e) => e.id === result.engagementId)?.creditor_open_items?.as_at === pe;
    if (!snapshot && db.transactions.some((t) => t.engagement_id === result.engagementId && t.source === 'Xero'))
      return setNote({ ok: false, text: `Xero's open bills at ${peLabel} have not been read for this client yet. Pull from Xero again, then refresh.` });
    const s = suppliersFromLedger(result.engagementId, pe, windowDays, live().suppliers ?? []);
    if (!s) return setNote({ ok: false, text: 'Nothing to read yet: no ledger has been pulled from Xero or imported for this client’s trade creditors. Pull the ledger first, or add suppliers by hand.' });
    save({ suppliers: s, refreshed_at: new Date().toISOString() });
    const fromXero = s.some((x) => x.overdue);
    setNote({
      ok: true,
      text: fromXero
        ? `${s.length} supplier${s.length === 1 ? '' : 's'} from Xero's bills, credits and payments on account open at ${peLabel}, with days past the due date.`
        : `${s.length} supplier${s.length === 1 ? '' : 's'} from the ledger at ${peLabel}.${db.engagements.find((e) => e.id === result.engagementId)?.creditor_open_items || !db.transactions.some((t) => t.engagement_id === result.engagementId && t.source === 'Xero') ? '' : ' Pull from Xero again to read its open bills instead, so last year’s unpaid bills are included.'}`,
    });
  };
  const [checking, setChecking] = useState(false);
  const checkBank = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/v1/integrations/xero/bank-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engagementId: result.engagementId, days: windowDays }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Not connected, expired or missing permission: all are put right on the client's page
        const connect = ['XERO_NOT_CONNECTED', 'XERO_RECONNECT', 'XERO_NO_ACCESS'].includes(body.code) && eng;
        return setNote({
          ok: false,
          text: body.code === 'XERO_NOT_CONNECTED' ? 'This client is not connected to Xero, so the bank could not be checked. Connect Xero on the client’s page, then check again.' : body.error || 'Could not read the Xero bank account. Nothing was changed. Try again.',
          ...(connect ? { link: { href: `/clients/${eng.client_id}`, label: 'Open the client’s page' } } : {}),
        });
      }
      const suppliers = (live().suppliers ?? []).map((s: Supplier) => ({ ...s, bank_check: { to: body.to, matches: bankMatches(s, body.payments ?? []) } }));
      const banks: BankChecked['banks'] = body.banks ?? [];
      save({ suppliers, bank_checked: { from: body.from, to: body.to, banks } });
      const found = suppliers.filter((s: Supplier) => s.bank_check!.matches.length).length;
      const n = body.payments?.length ?? 0;
      const read = banks.length ? `Read ${banks.length} Xero bank account${banks.length === 1 ? '' : 's'} from ${ukDate(body.from)} to ${ukDate(body.to)}: ${bankList(banks)}.` : '';
      setNote({
        ok: true,
        text: n
          ? `${read || `${n} payment${n === 1 ? '' : 's'} left the Xero bank from ${ukDate(body.from)} to ${ukDate(body.to)}.`} ${found} of ${suppliers.length} suppliers have a matching payment. See the Paid after column.`
          : `${read || `Xero shows no payments out of the bank from ${ukDate(body.from)} to ${ukDate(body.to)}.`} Nothing was paid out. If that looks wrong, check the banks are up to date in Xero.`,
      });
    } catch {
      setNote({ ok: false, text: 'Could not reach Blynt to check the Xero bank. Check your connection and try again.' });
    } finally {
      setChecking(false);
    }
  };
  // The AI reads each cost found: the period it covers when the description says, and whether it looks like this year's. It never decides.
  const [aiReading, setAiReading] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const readCosts = async (ids: string[]) => {
    if (!ids.length) return;
    setAiReading(true);
    setAiNote('');
    try {
      const res = await fetch(`/api/v1/engagements/${encodeURIComponent(result.engagementId)}/ai-after-date-costs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: windowDays, min_p: minimum.toString(), ids }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'The AI could not read these costs. Try again.');
      const read = new Map<string, NonNullable<SearchItem['ai']>>((body.items ?? []).map((x: { id: string; from: string; to: string; summary: string }) => [x.id, { from: x.from, to: x.to, summary: x.summary }]));
      save({ search: { ...(live().search ?? {}), items: (live().search?.items ?? []).map((i: SearchItem) => (read.has(i.id) ? { ...i, ai: read.get(i.id) } : i)) } });
    } catch (e) {
      setAiNote((e as Error).message);
    } finally {
      setAiReading(false);
    }
  };
  const runSearch = () => {
    const found = searchAfterDate(result.engagementId, pe, windowDays, minimum, live().search?.items ?? []);
    save({ search: { ...(live().search ?? {}), window_days: windowDays, min_p: minimum.toString(), items: found, searched_at: new Date().toISOString() } });
    // Costs already read, and their decisions, are kept; only the new ones go to the AI
    void readCosts(found.filter((i) => !i.ai).map((i) => i.id));
  };
  const addSupplier = () => {
    const id = `sup_${Date.now()}`;
    save({ suppliers: [...(live().suppliers ?? []), { id, name: '', ledger_p: '0', statement_p: '', paid_after_p: '0' }] });
    show(id);
  };
  const pending = views.filter((v) => v.suggestion && !v.s.decision && (v.suggestion.kind !== 'missing_invoice' || v.s.expense_code));
  const acceptAll = () =>
    save({
      suppliers: (live().suppliers ?? []).map((s: Supplier) => {
        const v = supplierView(s);
        return s.decision || !v.suggestion || (v.suggestion.kind === 'missing_invoice' && !s.expense_code) ? s : { ...s, decision: v.suggestion.kind };
      }),
    });

  // The AI reads the balance off a supplier statement attached to a row and fills it in when none has been typed; the row says the AI filled it
  const [reading, setReading] = useState<Record<string, boolean>>({});
  const [dropOn, setDropOn] = useState<string | null>(null);
  const readStatement = async (id: string, att: Attachment, show: boolean) => {
    setReading((r) => ({ ...r, [id]: true }));
    let ai: NonNullable<Supplier['ai_statement']> = { file: att.id, balance_p: '' };
    let problem = '';
    try {
      const res = await fetch(`/api/v1/documents/${encodeURIComponent(att.id)}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideCategory: 'Supplier statement' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.attachment) {
        // Keep this browser's copy of the file in step with what the server saved
        const local = db.attachments.find((a) => a.id === att.id);
        if (local) Object.assign(local, { category: body.attachment.category, ai_summary: body.attachment.ai_summary, extracted_data: body.attachment.extracted_data });
        const bal = body.data?.closing_balance_p;
        if (body.ai && bal?.value) ai = { file: att.id, balance_p: String(bal.value), date: body.data?.statement_date?.value || undefined, page: bal.page, confidence: bal.confidence, supplier: body.data?.supplier?.value || undefined };
        else problem = body.note || `The AI could not read a balance from ${att.filename}. Enter it from the statement.`;
      } else problem = body.error || 'Could not read the statement.';
    } catch {
      problem = 'Could not reach Blynt to read the statement. Check your connection and try again.';
    }
    // A balance someone typed is never overwritten
    const blank = !(live().suppliers ?? []).find((s: Supplier) => s.id === id)?.statement_p;
    setSupplier(id, { ai_statement: ai, ...(ai.balance_p && blank ? { statement_p: ai.balance_p } : {}) });
    if (show && problem) setNote({ ok: false, text: problem });
    setReading((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  };
  // One read at a time: each read reloads the workspace when it ends, which would wipe the result of a read that ended just before it
  const reads = useRef<Promise<void>>(Promise.resolve());
  const queueRead = (id: string, att: Attachment) => {
    setReading((r) => ({ ...r, [id]: true }));
    reads.current = reads.current.then(() => readStatement(id, att, true));
  };
  // A statement attached to a supplier with no balance entered is read once, as the bank paper does
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (locked) return;
    for (const v of views) {
      const att = filesFor(v.s.id).at(-1);
      if (!att || v.debit || v.entered || v.s.ai_statement?.file === att.id || tried.current.has(att.id)) continue;
      tried.current.add(att.id);
      queueRead(v.s.id, att);
    }
  });

  // What the AI read belongs to the file it came from. When that file is deleted, archived or moved to another
  // supplier, the read goes with it, and so does the balance if it is still the one the AI filled in (a typed one stays)
  useEffect(() => {
    if (locked) return;
    const stale = views.filter((v) => v.s.ai_statement && !reading[v.s.id] && !filesFor(v.s.id).some((f) => f.id === v.s.ai_statement!.file));
    if (!stale.length) return;
    const ids = new Set(stale.map((v) => v.s.id));
    // The file may be read again on the supplier it is moved to
    stale.forEach((v) => tried.current.delete(v.s.ai_statement!.file));
    save({
      suppliers: (live().suppliers ?? []).map((s: Supplier) =>
        ids.has(s.id) ? { ...s, ai_statement: undefined, ...(s.ai_statement?.balance_p && s.statement_p === s.ai_statement.balance_p ? { statement_p: '' } : {}) } : s
      ),
    });
  });

  const attention = (v: ReturnType<typeof supplierView>) => v.status !== 'done';
  // Suppliers read from Xero's open bills carry an ageing by due date; the ledger fallback only has the oldest bill's age
  const agedCols = views.some((v) => v.s.aged);
  const shown = views.filter((v) => (filter === 'attention' ? attention(v) : filter === 'done' ? !attention(v) : true));
  const withStatement = views.filter((v) => v.ledger > 0n && v.entered && filesFor(v.s.id).length);
  const owedCount = views.filter((v) => v.ledger > 0n).length;
  const control = result.checks.find((c) => c.id === 'control_tb');
  const lines = creditorsJournal(data);
  const cols = agedCols ? 12 : 8;
  // Ageing columns drop out when the table is too narrow to fit them (e.g. side panel open); the supplier line still says how overdue
  const wide = 'hidden @min-[1380px]:table-cell';

  // The right-hand column: the suggestion and its buttons, or the decision made and its reason, as on Trade debtors
  const status = (v: ReturnType<typeof supplierView>) => {
    const s = v.s;
    const name = s.name || 'New supplier';
    const blocks: React.ReactNode[] = [];
    if (v.suggestion && !s.decision) {
      const k = v.suggestion.kind;
      blocks.push(
        <div key="suggest" className="flex flex-col items-end gap-1">
          <Pill tone="warn">Suggested: {k === 'debtors' ? 'move to debtors' : k === 'timing' ? 'payment in transit' : `add ${formatPence(v.diff!)}`}</Pill>
          {!locked && (
            <div className="flex flex-wrap items-center justify-end gap-1">
              {k === 'missing_invoice' && (
                <span className="inline-block w-full [&>select]:w-full">
                  <CodePicker label={`Expense account for ${name}`} value={s.expense_code} codes={codes} disabled={locked} onChange={(c) => setSupplier(s.id, { expense_code: c })} />
                </span>
              )}
              <button
                type="button"
                className={btnPrimary}
                disabled={k === 'missing_invoice' && !s.expense_code}
                title={k === 'missing_invoice' && !s.expense_code ? 'Pick the expense account first' : undefined}
                onClick={() => decide(s.id, k)}
              >
                {k === 'debtors' ? 'Move to debtors' : k === 'timing' ? 'Accept as timing' : 'Add to creditors'}
              </button>
              <button type="button" className={btnSecondary} onClick={() => decide(s.id, k === 'debtors' ? 'leave' : 'not_ours')}>
                {k === 'debtors' ? 'Leave' : k === 'timing' ? 'Other reason' : 'Not ours'}
              </button>
            </div>
          )}
        </div>
      );
    } else if (s.decision) {
      blocks.push(
        <div key="decided" className="flex flex-col items-end gap-1 w-full min-w-[150px]">
          <Pill tone="info">
            {DECIDED[s.decision]}
            {s.decision === 'missing_invoice' && s.expense_code ? ` to ${s.expense_code}` : ''}
          </Pill>
          {s.decision === 'missing_invoice' && (
            <label className="flex items-center gap-1 text-[10px] text-[#4A5878]">
              VAT included
              <span className="w-24">
                <MoneyInput label={`VAT in the missing invoice for ${name}`} value={s.vat_p} disabled={locked} allowNegative={false} onCommit={(p) => setSupplier(s.id, { vat_p: p })} />
              </span>
              {!locked && v.diff && (
                <button type="button" className={link} onClick={() => setSupplier(s.id, { vat_p: ((v.diff! + 3n) / 6n).toString() })}>
                  20%
                </button>
              )}
            </label>
          )}
          {(s.decision === 'not_ours' || s.decision === 'leave') && (
            <TextInput label={`Reason for ${name}`} value={s.reason} disabled={locked} placeholder="Reason (required)" onCommit={(r) => setSupplier(s.id, { reason: r })} />
          )}
          {!locked && (
            <button type="button" className={link} onClick={() => decide(s.id, undefined)}>
              Undo
            </button>
          )}
        </div>
      );
    }
    if (v.needsDispute || s.dispute) {
      blocks.push(
        !s.dispute ? (
          <div key="dispute" className="flex flex-col items-end gap-1">
            <Pill tone="warn">Check for dispute</Pill>
            {!locked && (
              <div className="flex gap-1 whitespace-nowrap">
                <button type="button" className={btnSmall} title="Adds a question for the client in Comments" onClick={() => askClient(s)}>
                  Ask client
                </button>
                <button type="button" className={btnSmall} title="Mark as owed; you'll be asked for a reason" onClick={() => setSupplier(s.id, { dispute: 'not_disputed' })}>
                  Not disputed
                </button>
              </div>
            )}
          </div>
        ) : (
          <div key="dispute" className="flex flex-col items-end gap-1 w-full min-w-[150px]">
            <Pill tone="plain">{s.dispute === 'ask' ? 'Asked the client (in Comments)' : 'Not disputed'}</Pill>
            {s.dispute === 'not_disputed' && (
              <TextInput label={`Why ${name} is not disputed`} value={s.dispute_reason} disabled={locked} placeholder="Reason (required), e.g. client confirmed" onCommit={(r) => setSupplier(s.id, { dispute_reason: r })} />
            )}
            {!locked && (
              <button type="button" className={link} onClick={() => setSupplier(s.id, { dispute: undefined })}>
                Undo
              </button>
            )}
          </div>
        )
      );
    }
    if (!blocks.length) {
      if (v.status === 'none') {
        // The paperclip by the balance attaches the statement; here we only say if it was paid off
        if (v.ledger > 0n && v.paid >= v.ledger) {
          blocks.push(<span key="status" className="text-[10px] text-[#0B6B52]">Paid in full after the year end</span>);
        }
      } else {
        const [label, tone] = STATUS[v.status];
        blocks.push(<Pill key="status" tone={tone}>{label}</Pill>);
      }
    }
    return (
      <div className="ml-auto flex flex-col items-end gap-2 max-w-[170px] text-right [&_.rounded-full]:whitespace-normal">
        {blocks}
        {tickFor(s.id, name)}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Tiles
        items={[
          { label: 'Aged creditors vs TB 7500', value: control?.passed ? 'Agrees' : 'Differs', tone: control?.passed ? 'good' : 'bad', sub: control?.passed ? `${formatPence(tot('control'))} both` : `Difference ${formatPence(tot('difference'))} · ${views.length} suppliers` },
          { label: 'Statements on file', value: `${withStatement.length} of ${owedCount}`, sub: 'suppliers owed money' },
          { label: 'Unrecorded liabilities found', value: formatPence(tot('found')), tone: tot('found') ? 'warn' : 'plain', sub: `${items.filter((i) => !i.decision).length} to decide · ${items.length} items` },
          { label: 'Paid after period end', value: tot('owed') ? `${Number((tot('paid_after') * 100n) / tot('owed'))}%` : '–', sub: `${formatPence(tot('paid_after'))} of ${formatPence(tot('owed'))} within ${windowDays} days` },
          { label: 'Trade creditors after adjustments', value: formatPence(tot('after_adjustments')), sub: tot('debit_balances') ? `${formatPence(tot('debit_balances'))} of debit balances` : 'no debit balances' },
        ]}
      />
      <SuggestBanner
        count={pending.length}
        locked={locked}
        onAccept={acceptAll}
        text={pending.map((v) => `${v.s.name}: ${v.suggestion!.kind === 'debtors' ? 'move the debit balance to debtors' : v.suggestion!.kind === 'timing' ? 'payment in transit' : `add the missing ${formatPence(v.diff!)}`}`).join(' · ') + '.'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={[
            { key: 'all', label: 'All', count: views.length },
            { key: 'attention', label: 'Needs attention', count: views.filter(attention).length },
            { key: 'done', label: 'Done', count: views.filter((v) => !attention(v)).length },
          ]}
        />
        {!locked && (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={refresh} className={btnAdd} title="Read the suppliers and open bills again from the ledger last pulled from Xero. Balances and decisions you entered are kept.">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh from ledger
            </button>
            <button type="button" onClick={checkBank} disabled={checking || !views.length} className={btnAdd} title={views.length ? `Look in the Xero bank for payments to these suppliers in the ${windowDays} days after ${peLabel}` : 'Add or refresh suppliers first'}>
              <Landmark className="w-3.5 h-3.5" /> {checking ? 'Checking bank…' : 'Check bank'}
            </button>
            <button type="button" onClick={addSupplier} className={btnAdd}>
              + Add supplier
            </button>
          </div>
        )}
      </div>
      {data.refreshed_at && <div className="-mt-2 text-[10px] text-[#4A5878]">Read from the ledger at {peLabel} · refreshed {ukDate(String(data.refreshed_at).slice(0, 10))}</div>}
      {!!(data.bank_checked as BankChecked | undefined)?.banks?.length && (
        <div className="-mt-2 text-[10px] text-[#4A5878] flex items-start gap-1">
          <Sparkles className="w-3 h-3 mt-px shrink-0 text-[#B8432F]" aria-hidden="true" />
          Xero bank read from {ukDate(data.bank_checked.from)} to {ukDate(data.bank_checked.to)}: {bankList(data.bank_checked.banks)}. Only what is entered in Xero is seen; a bank that is not in Xero is not checked.
        </div>
      )}
      {note && (
        <Notice tone={note.ok ? 'ok' : 'error'} onClose={() => setNote(null)}>
            {note.text}{' '}
            {note.link && (
              <Link href={note.link.href} className="font-bold underline">
                {note.link.label}
              </Link>
            )}
          </Notice>
      )}

      <div className="@container overflow-x-auto border border-[#E3E7EF] rounded-[12px]">
        <table className="w-full text-xs text-[#122654]">
          <thead className="bg-[#F5F8FD]">
            <tr>
              <th className="w-8" />
              <th className={`${th} text-left`}>Supplier</th>
              <th className={`${th} text-right`}>Ledger</th>
              <th className={`${th} text-right w-[124px] whitespace-normal! leading-tight`}>Statement balance</th>
              <th className={`${th} text-right`}>Difference</th>
              {agedCols ? AGED.map(([, label]) => <th key={label} className={`${th} ${wide} px-1.5! text-right whitespace-normal! leading-tight`}>{label}</th>) : <th className={`${th} text-right`}>Oldest</th>}
              {agedCols && <th className={`${th} ${wide} text-right`}>Total</th>}
              <th className={`${th} text-right`}>Paid after</th>
              <th className={`${th} text-right`}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E7EF]">
            {views.length === 0 && (
              <tr>
                <td colSpan={cols} className="p-3 text-[11px] text-[#7E8DA6]">
                  No suppliers yet. Refresh from the ledger, or add suppliers by hand.
                </td>
              </tr>
            )}
            {views.length > 0 && shown.length === 0 && (
              <tr>
                <td colSpan={cols} className="p-3 text-[11px] text-[#7E8DA6]">
                  No suppliers match this filter.
                </td>
              </tr>
            )}
            {shown.map((v) => {
              const s = v.s;
              const name = s.name || 'New supplier';
              const file = filesFor(s.id).at(-1);
              const ai = s.ai_statement;
              const aiBalance = ai?.balance_p ? asPence(ai.balance_p) : null;
              // The supplier on this paper the statement names, when it is not this one and has no statement of its own yet
              const owner = ai?.supplier && !sameSupplier(ai.supplier, name) ? views.find((o) => o.s.id !== s.id && sameSupplier(ai.supplier!, o.s.name) && !filesFor(o.s.id).length) : undefined;
              return (
                <React.Fragment key={s.id}>
                  <tr
                    className={dropOn === s.id ? 'bg-[#EEF3FF] outline-2 outline-dashed -outline-offset-2 outline-[#122654]' : undefined}
                    onDragOver={(e) => {
                      if (locked || !dropFiles) return;
                      e.preventDefault();
                      if (dropOn !== s.id) setDropOn(s.id);
                    }}
                    onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropOn(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropOn(null);
                      const f = Array.from(e.dataTransfer.files ?? []);
                      if (f.length && !locked && dropFiles) dropFiles(f, s.id);
                    }}
                  >
                    <td className="p-1.5 align-top">
                      <ExpandButton open={isOpen(s.id)} label={`details for ${name}`} onClick={() => toggle(s.id)} />
                    </td>
                    <td className="p-2 align-top min-w-[130px]">
                      <div className="font-bold">{name}</div>
                      <div className="text-[10px] text-[#4A5878]">
                        {s.invoices?.length ? `${s.invoices.length} open bill${s.invoices.length === 1 ? '' : 's'}` : v.debit ? 'debit balance' : ''}
                        {s.oldest_days ? ` · ${s.overdue ? `most overdue ${s.oldest_days} days` : `oldest ${s.oldest_days} days`}` : ''}
                      </div>
                    </td>
                    <td className="p-2 align-top text-right font-mono font-bold">{money(v.ledger)}</td>
                    <td className="p-1.5 align-top">
                      {v.debit ? (
                        <div className="text-right text-[10px] text-[#7E8DA6] pt-1.5">Not needed</div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                            <div className="flex-1 min-w-0">
                              <MoneyInput label={`Statement balance for ${name}`} value={s.statement_p} placeholder="Balance" disabled={locked} onCommit={(p) => setSupplier(s.id, { statement_p: p })} />
                            </div>
                            {!locked && (
                              <button
                                type="button"
                                onClick={() => attachTo(s.id)}
                                aria-label={`Attach the statement for ${name}`}
                                title="Attach the supplier's statement"
                                className="shrink-0 p-1.5 rounded-[6px] border border-dashed border-[#D3DCEE] text-[#4A5878] hover:text-[#122654] hover:border-[#122654]"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          {reading[s.id] ? (
                            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#4A5878]">
                              <Sparkles className="w-3 h-3 text-[#B8432F]" aria-hidden="true" /> Reading statement…
                            </div>
                          ) : aiBalance !== null ? (
                            // What the AI read, whose statement it is, and how it compares with the ledger
                            <div className="mt-1 text-right text-[10px] leading-snug text-[#4A5878]">
                              <div>
                                <Sparkles className="inline w-3 h-3 text-[#B8432F]" aria-hidden="true" /> AI read <span className="font-mono font-bold text-[#122654]">{formatPence(aiBalance)}</span> owed
                                {ai?.date ? ` at ${ukDate(ai.date)}` : ''}
                                {ai?.page ? ` (page ${ai.page})` : ''}
                              </div>
                              {ai?.supplier &&
                                (sameSupplier(ai.supplier, name) ? (
                                  <div>Statement from {ai.supplier}</div>
                                ) : (
                                  <div className="font-bold text-[#B42318]">
                                    This statement is from {ai.supplier}, not {name}. Check it is attached to the right supplier.
                                    {owner && !locked && swapEvidence && (
                                      <button
                                        type="button"
                                        className={`${link} block ml-auto mt-0.5`}
                                        onClick={() => {
                                          swapEvidence(s.id, owner.s.id);
                                          // The read and the balance it filled leave this row with the file; it is read again on the other
                                          tried.current.delete(ai.file);
                                          setSupplier(s.id, { ai_statement: undefined, ...(s.statement_p === ai.balance_p ? { statement_p: '' } : {}) });
                                        }}
                                      >
                                        Move it to {owner.s.name}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              {aiBalance === v.ledger ? (
                                <div className="text-[#0B6B52]">Agrees to the ledger</div>
                              ) : (
                                <div className="text-[#B8432F]">
                                  {formatPence(aiBalance > v.ledger ? aiBalance - v.ledger : v.ledger - aiBalance)} {aiBalance > v.ledger ? 'more' : 'less'} than the ledger ({formatPence(v.ledger)})
                                </div>
                              )}
                              {aiBalance === v.statement ? (
                                <div>Filled in above as the statement balance. Check it against the statement.</div>
                              ) : (
                                !locked && (
                                  <button type="button" className={link} onClick={() => setSupplier(s.id, { statement_p: ai!.balance_p })}>
                                    Use this balance
                                  </button>
                                )
                              )}
                            </div>
                          ) : (
                            file &&
                            !locked && (
                              <div className="mt-1 text-right">
                                <button type="button" className={`${link} inline-flex items-center gap-1`} onClick={() => queueRead(s.id, file)}>
                                  <Sparkles className="w-3 h-3 text-[#B8432F]" aria-hidden="true" /> {ai ? 'Read again with AI' : 'Read with AI'}
                                </button>
                              </div>
                            )
                          )}
                        </>
                      )}
                      {/* Statements already attached, kept with the balance they support */}
                      {!!filesFor(s.id).length && (
                        <div className="mt-1 flex justify-end">
                          <RowFiles files={filesFor(s.id)} onPreview={preview} onAttach={() => attachTo(s.id)} disabled label={`the statement for ${name}`} />
                        </div>
                      )}
                    </td>
                    <td className={`p-2 align-top text-right font-mono ${v.diff ? 'text-[#B8432F] font-bold' : ''}`}>{v.diff === null ? '–' : money(v.diff)}</td>
                    {agedCols ? (
                      AGED.map(([key]) => {
                        const p = asPence(s.aged?.[key] ?? '0');
                        return (
                          <td key={key} className={`${wide} px-1.5 py-2 align-top text-right font-mono`}>
                            <span className={key === 'd90_p' && p > 0n ? 'px-1 rounded bg-[#FFF4DB] font-bold text-[#B8432F]' : ''}>{p === 0n ? '–' : money(p)}</span>
                          </td>
                        );
                      })
                    ) : (
                      <td className="p-2 align-top text-right">
                        {s.oldest_days ? <Pill tone={s.oldest_days > (s.overdue ? 60 : 90) ? 'warn' : 'plain'}>{s.oldest_days} days{s.overdue ? ' overdue' : ''}</Pill> : '–'}
                      </td>
                    )}
                    {agedCols && <td className={`${wide} p-2 align-top text-right font-mono font-bold`}>{money(s.aged ? AGED.reduce((t, [key]) => t + asPence(s.aged![key]), 0n) : v.ledger)}</td>}
                    <td className="p-2 align-top text-right">
                      <div className={`font-mono font-bold ${v.ledger > 0n && v.paid === 0n ? 'text-[#B42318]' : v.paid >= v.ledger && v.ledger > 0n ? 'text-[#0B6B52]' : ''}`}>{v.ledger > 0n && v.paid === 0n ? 'Nil' : money(v.paid)}</div>
                      {s.payments_after?.length ? (
                        <button type="button" onClick={() => show(s.id)} className={link}>
                          {s.payments_after.length} payment{s.payments_after.length === 1 ? '' : 's'}
                        </button>
                      ) : null}
                      {/* With bills listed, the bank shows against each bill; only a supplier with no bill list says it here */}
                      {s.bank_check &&
                        !s.invoices?.length &&
                        (s.bank_check.matches.length ? (
                          <div className="text-[10px] text-[#0B6B52]">{[...new Set(s.bank_check.matches.map((m) => m.bank).filter(Boolean))].join(', ') || 'Found in the bank'}</div>
                        ) : (
                          <div className="text-[10px] text-[#B42318]">Not from any bank account to {ukDate(s.bank_check.to)}</div>
                        ))}
                    </td>
                    <td className="p-2 align-top text-right">{status(v)}</td>
                  </tr>
                  {isOpen(s.id) && (
                    <tr className="bg-[#FAFBFD]">
                      <td />
                      <td colSpan={cols - 1} className="p-3">
                        {[v.suggestion?.why, v.needsDispute ? `Nothing paid since the period end and the oldest ${s.overdue ? `bill is ${s.oldest_days} days overdue` : `invoice is ${s.oldest_days} days old`}. It may be disputed or not owed.` : '']
                          .filter(Boolean)
                          .map((why) => (
                            <div key={why} className="mb-2 px-3 py-2 rounded-[8px] bg-[#F5F8FD] text-[11px] text-[#122654] flex items-start gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 mt-px shrink-0 text-[#B8432F]" aria-hidden="true" /> {why}
                            </div>
                          ))}
                        <div className="flex flex-col gap-3">
                          {!s.invoices && (
                            <div className="p-3 bg-white border border-[#E3E7EF] rounded-[10px] flex flex-col gap-2 max-w-xl">
                              <div className="font-bold">Balance at {peLabel}</div>
                              <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-semibold text-[#4A5878]">Supplier</span>
                                <TextInput label="Supplier name" value={s.name} disabled={locked} placeholder="Supplier name" onCommit={(n) => setSupplier(s.id, { name: n })} />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[10px] font-semibold text-[#4A5878]">Ledger balance</span>
                                <MoneyInput label={`Ledger balance for ${name}`} value={s.ledger_p} disabled={locked} onCommit={(p) => setSupplier(s.id, { ledger_p: p })} />
                              </label>
                            </div>
                          )}
                          {s.invoices && (
                            <div className="p-3 bg-white border border-[#E3E7EF] rounded-[10px]">
                              {s.invoices.length ? (
                                <OpenItemsTable items={s.invoices} peLabel={peLabel} title={`Open bills at ${peLabel}`} refLabel="Bill #" byDue={!!s.overdue} warnAfter={s.overdue ? 60 : 90} bankFor={s.bank_check ? (p) => bankOf(s.bank_check!.matches, p) : undefined} />
                              ) : (
                                <>
                                  <div className="font-bold mb-1">Open bills at {peLabel}</div>
                                  <div className="text-[11px] text-[#7E8DA6]">None from the ledger.</div>
                                </>
                              )}
                            </div>
                          )}
                          {ai?.balance_p && (
                            <div className="text-[10px] text-[#4A5878] flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-[#B8432F]" aria-hidden="true" />
                              AI read {formatPence(asPence(ai.balance_p))} from the attached statement{ai.page ? `, page ${ai.page}` : ''}
                              {ai.confidence !== undefined ? ` · ${ai.confidence}% sure` : ''}. Check it against the statement before using it.
                            </div>
                          )}
                        </div>
                        {!locked && (
                          <div className="mt-2 text-right">
                            <button
                              type="button"
                              aria-label={`Remove ${name}`}
                              title={`Remove ${name}`}
                              onClick={async () => (await ask.confirm({ title: `Remove ${name} from the schedule?`, action: 'Remove', danger: true })) && save({ suppliers: (live().suppliers ?? []).filter((x: Supplier) => x.id !== s.id) })}
                              className="p-1 text-[#7E8DA6] hover:text-[#B42318]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
                <td className="p-2">Total · {control?.passed ? 'agrees to TB 7500' : 'differs from TB 7500'}</td>
                <td className="p-2 text-right font-mono">{money(tot('aged'))}</td>
                <td className="p-2 text-right font-mono">{money(views.reduce((a, v) => a + (v.statement ?? 0n), 0n))}</td>
                <td className="p-2 text-right font-mono">{money(views.reduce((a, v) => a + (v.diff ?? 0n), 0n))}</td>
                {agedCols && AGED.map(([key]) => <td key={key} className={`${wide} p-2 text-right font-mono`}>{money(views.reduce((a, v) => a + asPence(v.s.aged?.[key] ?? '0'), 0n))}</td>)}
                {agedCols ? <td className={`${wide} p-2 text-right font-mono`}>{money(views.reduce((a, v) => a + (v.s.aged ? AGED.reduce((t, [key]) => t + asPence(v.s.aged![key]), 0n) : v.ledger), 0n))}</td> : <td />}
                <td className="p-2 text-right font-mono">{money(tot('paid_after'))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="-mt-2 text-[10px] text-[#4A5878]">Amounts owed are positive; debit balances are in brackets. Enter the statement balance from the supplier's statement, or drag the statement onto the supplier's row to attach it and have the AI read the balance.</p>

      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div>
            <div className="font-bold">Search for unrecorded liabilities</div>
            <div className="text-[10px] text-[#4A5878]">
              {data.search?.searched_at
                ? `${items.length} cost${items.length === 1 ? '' : 's'} over ${formatPence(minimum)} posted in the ${windowDays} days after ${peLabel}. Decide which belong to this year.`
                : `Costs over ${formatPence(minimum)} posted in the ${windowDays} days after ${peLabel}, from the ledger.`}
            </div>
          </div>
          {!locked && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px]">
                Days
                <input
                  type="number"
                  min={1}
                  aria-label="Days after the period end to search"
                  defaultValue={windowDays}
                  onBlur={(e) => Number(e.target.value) !== windowDays && save({ search: { ...(live().search ?? {}), window_days: Number(e.target.value) || 60 } })}
                  className="w-14 px-1.5 py-1 border border-[#D3DCEE] rounded-[6px] text-right"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px]">
                Over £
                <span className="w-24">
                  <MoneyInput label="Minimum amount to search" value={minimum.toString()} disabled={locked} allowNegative={false} onCommit={(p) => save({ search: { ...(live().search ?? {}), min_p: p } })} />
                </span>
              </label>
              <button type="button" onClick={runSearch} className={btnAdd}>
                <Search className="w-3.5 h-3.5" /> {data.search?.searched_at ? 'Search again' : 'Search'}
              </button>
            </div>
          )}
        </div>
        {data.search?.searched_at && items.length === 0 && (
          <div className="text-[11px] text-[#4A5878]">
            {afterDateKnown(result.engagementId, pe)
              ? 'Nothing over the minimum was posted in the window.'
              : `The ledger has nothing after ${peLabel} yet, so there was nothing to search. Pull from Xero again or import the later transactions, then search again.`}
          </div>
        )}
        {aiNote && <Notice inline className="mb-2">{aiNote}</Notice>}
        {!locked && !aiReading && items.some((i) => !i.ai) && (
          <button type="button" className={`${link} mb-2 inline-flex items-center gap-1`} onClick={() => readCosts(items.filter((i) => !i.ai).map((i) => i.id))}>
            <Sparkles className="w-3 h-3 text-[#B8432F]" aria-hidden="true" /> Read with AI
          </button>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Cost</th>
                <th className={`${th} text-left`}>Account</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Belongs to this year?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1F6]">
              {items.map((i) => {
                const period = i.ai?.from && i.ai.to ? (i.ai.from === i.ai.to ? ukDate(i.ai.from) : `${ukDate(i.ai.from)} to ${ukDate(i.ai.to)}`) : '';
                const choice = 'px-2 py-0.5 text-[10px] font-bold rounded-[6px] whitespace-nowrap';
                return (
                  <tr key={i.id} className={i.decision ? '' : 'bg-[#FFFBF0]'}>
                    <td className="p-2 align-top">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="underline">{i.contact || i.desc}</a> : i.contact || i.desc}</span>
                        <span className="text-[10px] text-[#7E8DA6]">
                          {ukDate(i.date)}
                          {i.contact && i.desc ? ` · ${i.desc}` : ''}
                          {period ? ` · covers ${period}` : ''}
                        </span>
                      </div>
                      {i.ai?.summary ? (
                        <div className="mt-0.5 flex items-start gap-1 text-[10px] leading-snug text-[#4A5878]">
                          <Sparkles className="w-3 h-3 mt-px shrink-0 text-[#B8432F]" aria-hidden="true" /> {i.ai.summary}
                        </div>
                      ) : (
                        aiReading && <div className="mt-0.5 text-[10px] text-[#7E8DA6]">Reading…</div>
                      )}
                    </td>
                    <td className="p-2 align-top">
                      <CodePicker label={`Account for ${i.contact || i.desc}`} value={i.code} codes={codes} disabled={locked || !!i.decision} onChange={(c) => setItem(i.id, { code: c })} />
                    </td>
                    <td className="p-2 align-top text-right font-mono whitespace-nowrap">{formatPence(asPence(i.amount_p), { symbol: '' })}</td>
                    <td className="p-2 align-top text-right">
                      {i.decision ? (
                        <span className="inline-flex items-center gap-2">
                          <Pill tone={i.decision === 'not_liability' ? 'plain' : 'info'}>{{ accrue: 'Accrued', creditor: 'Added to creditors', not_liability: 'Not this year' }[i.decision]}</Pill>
                          {!locked && (
                            <button type="button" className="text-[10px] text-[#1D4E89] underline" onClick={() => setItem(i.id, { decision: undefined })}>
                              Undo
                            </button>
                          )}
                        </span>
                      ) : (
                        !locked && (
                          <span className="inline-flex gap-1">
                            <button type="button" title="Yes: post an accrual" className={`${choice} bg-[#122654] hover:bg-[#1D4E89] text-white`} onClick={() => setItem(i.id, { decision: 'accrue' })}>
                              Accrue
                            </button>
                            <button type="button" title="Yes: add the bill to trade creditors" className={`${choice} border border-[#D3DCEE] bg-white text-[#122654] hover:border-[#122654]`} onClick={() => setItem(i.id, { decision: 'creditor' })}>
                              Creditor
                            </button>
                            <button type="button" title="No: it belongs to next year" className={`${choice} border border-[#D3DCEE] bg-white text-[#122654] hover:border-[#122654]`} onClick={() => setItem(i.id, { decision: 'not_liability' })}>
                              No
                            </button>
                          </span>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <JournalPanel
        engagementId={result.engagementId}
        date={pe}
        lines={lines}
        sent={data.journal}
        narrative="Trade creditors: missing invoices, accruals found after the period end and debit balances"
        source="K-10"
        locked={locked}
        save={save}
        title="Year-end journals"
      />
    </div>
  );
}

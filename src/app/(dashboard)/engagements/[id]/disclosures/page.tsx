'use client';

import { ask } from '@/components/ui/ask';
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Eye, FileText, ShieldCheck } from 'lucide-react';
import { db } from '@/lib/server/db';
import { useLocale } from '@/context/LocaleContext';
import { buildAccounts, type AccountsLine } from '@/lib/workpapers/accounts';
import { structureForCompanyType } from '@/lib/practice-structure';
import { getActor } from '@/lib/session';
import { answerChecklist, checklistFor, consistencyChecks, dismissStandardFinding, draftNotes, notesFor, standardCheck } from '@/lib/completion';
import { btnPrimary, btnSecondary } from '@/components/workpaper/kit';
import type { DisclosureChecklistItem } from '@/lib/types/models';

const SECTION: Record<DisclosureChecklistItem['section'], string> = {
  accounting_policies: 'Accounting policies', balance_sheet_notes: 'Balance sheet notes', pl_notes: 'Profit and loss notes', directors: 'Directors',
  related_parties: 'Related parties', commitments: 'Commitments', post_balance_sheet: 'Events after the year end', going_concern: 'Going concern',
};

// Pounds, rounded; negatives in brackets as in published accounts
const fmt = (p: bigint | null) => {
  if (p === null) return '';
  const v = Math.round(Math.abs(Number(p)) / 100).toLocaleString('en-GB');
  return p < 0n ? `(${v})` : v;
};

type Tab = 'accounts' | 'notes' | 'checklist' | 'checks';

export default function DisclosuresPage() {
  const params = useParams();
  const engagementId = (params?.id as string) || '';
  const { formatDate } = useLocale();
  const [tab, setTab] = useState<Tab>('accounts');
  const [filing, setFiling] = useState(false);
  const [, redraw] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const engagement = db.engagements.find((e) => e.id === engagementId);
  const client = engagement ? db.clients.find((c) => c.id === engagement.client_id) : undefined;
  const structure = structureForCompanyType(client?.company_type || '');
  const isCompany = structure === 'ltd' || structure === 'llp';
  const a = useMemo(() => buildAccounts(engagementId), [engagementId]);
  const prior = engagement?.prior_engagement_id ? db.engagements.find((e) => e.id === engagement.prior_engagement_id) : undefined;

  if (!engagement || !client) {
    return <div className="bg-white border border-[#E3E7EF] rounded-xl p-8 text-center text-xs text-[#4A5878]">Engagement not found.</div>;
  }

  const actor = getActor();
  const locked = engagement.status === 'locked';
  const act = (result: string | null | void) => { setError(result ?? null); redraw((n) => n + 1); };
  const firm = db.firms.find((f) => f.id === engagement.firm_id);
  const brand = firm?.settings?.branding;
  const checklist = isCompany ? checklistFor(engagementId) : [];
  const notes = notesFor(engagementId);
  const findings = standardCheck(engagementId);
  const checks = consistencyChecks(engagementId);
  const lineAmount = (label: string) => Object.values(a.bs).flat().find((l) => l.label === label)?.amount;
  const yearLabel = (iso?: string) => (iso ? formatDate(iso, { year: 'numeric', month: 'short' }) : '');
  const balanced = a.netAssets.amount === a.capitalAndReserves.amount;
  const empty = a.pl.length === 0 && Object.values(a.bs).every((l) => l.length === 0);
  const tabs: [Tab, string, React.ReactNode][] = [
    ['accounts', isCompany ? 'Statutory accounts preview' : 'Accounts preview', <Eye key="i" className="w-4 h-4 text-[#1D4E89]" />],
    ['notes', 'Notes', <FileText key="i" className="w-4 h-4 text-[#1D4E89]" />],
    ...(isCompany ? ([['checklist', `Disclosure checklist (${checklist.filter((c) => c.confirmed_answer).length}/${checklist.length})`, <ShieldCheck key="i" className="w-4 h-4 text-[#1D4E89]" />]] as [Tab, string, React.ReactNode][]) : []),
    ['checks', `Final checks (${checks.filter((c) => !c.passed).length + findings.filter((f) => !f.dismissed).length} to clear)`, <CheckCircle2 key="i" className="w-4 h-4 text-[#1D4E89]" />],
  ];

  const Row = ({ label, amount, prior: p, bold, indent, rule }: { label: string; amount: bigint; prior: bigint | null; bold?: boolean; indent?: boolean; rule?: boolean }) => (
    <tr className={`${bold ? 'font-bold' : ''} ${rule ? 'border-t border-gray-300' : ''}`}>
      <td className={`py-1.5 text-left font-sans ${indent ? 'pl-4' : ''}`}>{label}</td>
      <td className="py-1.5 text-right">{fmt(amount)}</td>
      {a.hasPrior && <td className="py-1.5 text-right text-gray-600">{fmt(p)}</td>}
    </tr>
  );
  const Lines = ({ lines, negate }: { lines: AccountsLine[]; negate?: boolean }) => (
    <>
      {lines.map((l) => (
        <Row key={l.label} label={l.label} amount={negate ? -l.amount : l.amount} prior={l.prior === null ? null : negate ? -l.prior : l.prior} indent />
      ))}
    </>
  );
  const Head = () => (
    <thead>
      <tr className="border-b border-gray-300 font-bold">
        <th className="py-2 text-left" />
        <th className="py-2 text-right w-28">{yearLabel(engagement.period_end)} (£)</th>
        {a.hasPrior && <th className="py-2 text-right w-28">{yearLabel(prior?.period_end)} (£)</th>}
      </tr>
    </thead>
  );

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      <div className="bg-white border border-[#E3E7EF] rounded-xl p-5 shadow-xs">
        <h1 className="text-xl font-bold text-[#122654]">{isCompany ? 'Disclosures, notes & statutory accounts' : 'Accounts & notes'}</h1>
        <p className="text-xs text-[#4A5878] mt-1">
          Built from the confirmed trial balance and the journals in it. {engagement.framework}
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-[#E3E7EF] pb-1 overflow-x-auto" role="tablist">
        {tabs.map(([k, label, icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold border-b-2 transition-all shrink-0 whitespace-nowrap ${tab === k ? 'border-[#FF7A66] text-[#122654]' : 'border-transparent text-[#4A5878] hover:text-[#122654]'}`}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {error && <p role="alert" className="p-3 rounded-[10px] bg-[#FDECEA] text-xs text-[#B42318]">{error}</p>}
      {a.unmappedPence !== 0n && (
        <div role="alert" className="p-3 rounded-[10px] bg-[#FFF4DB] border border-[#6B4700]/20 text-xs text-[#6B4700] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            £{fmt(a.unmappedPence < 0n ? -a.unmappedPence : a.unmappedPence)} of the trial balance isn&apos;t confirmed to an account yet, so it is left out.{' '}
            <Link href={`/engagements/${engagementId}/mapping`} className="font-bold underline">Finish mapping</Link>
          </span>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-xs p-4 sm:p-6 space-y-5">
          {empty ? (
            <p className="text-xs text-[#4A5878]">
              No figures yet. <Link href={`/engagements/${engagementId}/import`} className="font-bold text-[#B8432F] hover:underline">Import the trial balance</Link> and confirm the mapping to see the accounts.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {isCompany ? (
                  <div className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={() => setFiling(false)} className={`px-3 py-1 font-bold rounded-lg ${!filing ? 'bg-[#122654] text-white' : 'bg-[#F5F8FD] text-[#4A5878]'}`}>Full accounts</button>
                    <button type="button" onClick={() => setFiling(true)} className={`px-3 py-1 font-bold rounded-lg ${filing ? 'bg-[#122654] text-white' : 'bg-[#F5F8FD] text-[#4A5878]'}`}>Companies House filing version</button>
                  </div>
                ) : <span />}
                <button type="button" className={`${btnPrimary} no-print`} disabled={!balanced} title={balanced ? 'Opens the print dialog: choose Save as PDF' : 'The balance sheet must balance first'} onClick={() => { db.logAudit(engagement.firm_id, actor, 'PRODUCE_ACCOUNTS_PDF', 'engagements', engagement.id, null, { version: filing ? 'filing' : 'full' }); window.print(); }}>Download PDF</button>
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${balanced ? 'bg-[#E6F4EF] text-[#0B6B52]' : 'bg-[#FDECEA] text-[#B42318]'}`}>
                  {balanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {balanced
                    ? `Net assets £${fmt(a.netAssets.amount)} agree to ${isCompany ? 'capital and reserves' : 'the capital account'}`
                    : a.unmappedPence !== 0n
                      ? 'Won’t balance until the whole trial balance is mapped'
                      : `Net assets £${fmt(a.netAssets.amount)} don't agree to capital £${fmt(a.capitalAndReserves.amount)}`}
                </div>
              </div>

              <div className="print-area border border-gray-200 rounded-xl p-4 sm:p-8 bg-gray-50/50 max-w-3xl mx-auto space-y-6 text-[#122654] overflow-x-auto">
                <div className="text-center space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {brand?.logo_file_key && <img src={`/api/v1/files/${brand.logo_file_key}`} alt={firm?.name ?? 'Practice logo'} className="h-10 mx-auto mb-2" />}
                  <h2 className="text-lg font-bold tracking-tight">{client.name}</h2>
                  {isCompany && client.company_no && <p className="text-xs text-[#4A5878]">Registered number {client.company_no}</p>}
                </div>

                {!filing && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider mb-2">
                      Profit and loss account for the period ended {formatDate(engagement.period_end)}
                    </p>
                    <table className="w-full text-xs font-mono">
                      <Head />
                      <tbody>
                        {a.pl.map((l) => (
                          <React.Fragment key={l.label}>
                            {l.label === 'Tax on profit' && <Row label="Profit/(loss) before tax" amount={a.profitBeforeTax.amount} prior={a.profitBeforeTax.prior} bold rule />}
                            <Row label={l.label} amount={l.amount} prior={l.prior} />
                            {l.label === 'Cost of sales' && a.grossProfit && <Row label="Gross profit" amount={a.grossProfit.amount} prior={a.grossProfit.prior} bold rule />}
                          </React.Fragment>
                        ))}
                        <Row label="Profit/(loss) for the period" amount={a.profit.amount} prior={a.profit.prior} bold rule />
                      </tbody>
                    </table>
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-2">Balance sheet as at {formatDate(engagement.period_end)}</p>
                  <table className="w-full text-xs font-mono">
                    <Head />
                    <tbody>
                      {a.bs.fixed.length > 0 && <><Row label="Fixed assets" amount={a.bs.fixed.reduce((t, l) => t + l.amount, 0n)} prior={a.hasPrior ? a.bs.fixed.reduce((t, l) => t + (l.prior ?? 0n), 0n) : null} bold /><Lines lines={a.bs.fixed} /></>}
                      <tr><td colSpan={3} className="pt-3 font-bold font-sans">Current assets</td></tr>
                      <Lines lines={a.bs.current} />
                      {a.bs.suspense.map((l) => (
                        <tr key={l.label} className="text-[#B42318]"><td className="py-1.5 pl-4 font-sans">{l.label}</td><td className="py-1.5 text-right">{fmt(l.amount)}</td>{a.hasPrior && <td className="py-1.5 text-right">{fmt(l.prior)}</td>}</tr>
                      ))}
                      {a.bs.creditorsShort.length > 0 && <><tr><td colSpan={3} className="pt-3 font-bold font-sans">Creditors: amounts falling due within one year</td></tr><Lines lines={a.bs.creditorsShort} negate /></>}
                      <Row label="Net current assets/(liabilities)" amount={a.netCurrentAssets.amount} prior={a.netCurrentAssets.prior} bold rule />
                      <Row label="Total assets less current liabilities" amount={a.totalLessCurrent.amount} prior={a.totalLessCurrent.prior} bold />
                      {a.bs.creditorsLong.length > 0 && <><tr><td colSpan={3} className="pt-3 font-bold font-sans">Creditors: amounts falling due after more than one year</td></tr><Lines lines={a.bs.creditorsLong} negate /></>}
                      <Lines lines={a.bs.provisions} negate />
                      <Row label="Net assets" amount={a.netAssets.amount} prior={a.netAssets.prior} bold rule />
                      <tr><td colSpan={3} className="pt-3 font-bold font-sans">{isCompany ? 'Capital and reserves' : 'Capital account'}</td></tr>
                      <Lines lines={a.bs.equity} />
                      <Row label="Profit/(loss) for the period" amount={a.profit.amount} prior={a.profit.prior} indent />
                      <Row label={isCompany ? 'Total capital and reserves' : 'Total capital'} amount={a.capitalAndReserves.amount} prior={a.capitalAndReserves.prior} bold rule />
                    </tbody>
                  </table>
                </div>

                {!filing && notes.map((n) => (
                  <div key={n.id} className="font-sans text-xs">
                    <p className="font-bold">{n.note_number}. {n.title}</p>
                    {n.narrative_html && <p className="mt-1 text-[#4A5878] leading-relaxed">{n.narrative_html}</p>}
                    {n.figures.length > 0 && <table className="w-full font-mono mt-1"><tbody>{n.figures.map((f) => <tr key={f.label}><td className="py-0.5 font-sans">{f.label}</td><td className="py-0.5 text-right">{fmt(BigInt(f.amount_p))}</td></tr>)}</tbody></table>}
                  </div>
                ))}
                {(brand?.footer || brand?.disclaimer) && <p className="pt-3 border-t border-gray-300 text-[10px] text-[#4A5878] font-sans">{[brand.footer, brand.disclaimer].filter(Boolean).join(' · ')}</p>}
                {structure === 'ltd' && (
                  <p className="pt-4 border-t border-gray-300 text-[11px] text-[#4A5878] leading-relaxed font-sans">
                    For the year ended {formatDate(engagement.period_end)} the company was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies. The members have not required the company to obtain an audit of its accounts.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#4A5878]">
            <button type="button" className={btnPrimary} disabled={locked || empty} onClick={() => act(void draftNotes(engagementId, actor))}>{notes.length ? 'Re-draft notes' : 'Draft notes'}</button>
            <span>Figures come from the balance sheet. Wording you have edited is kept when you re-draft.</span>
          </div>
          {notes.map((n) => {
            const stale = n.figures.some((f) => (lineAmount(f.label) ?? 0n).toString() !== f.amount_p);
            return (
              <div key={n.id} className="bg-white border border-[#E3E7EF] rounded-xl p-5 shadow-xs text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3E7EF] pb-2 mb-2">
                  <h3 className="text-sm font-bold text-[#122654]">{n.note_number}. {n.title}</h3>
                  {stale && <span className="px-2 py-0.5 rounded bg-[#FFF4DB] text-[#6B4700] font-bold">Figures updated – re-draft</span>}
                </div>
                <p className="text-[#4A5878] mb-2">Why included: {n.why_included} ({n.standard_ref})</p>
                <textarea
                  aria-label={`Wording for ${n.title}`}
                  defaultValue={n.narrative_html}
                  disabled={locked}
                  rows={3}
                  onBlur={(e) => {
                    if (e.target.value === n.narrative_html) return;
                    const before = n.narrative_html;
                    n.narrative_html = e.target.value;
                    n.is_custom_wording = true;
                    db.logAudit(engagement.firm_id, actor, 'EDIT_NOTE', 'statutory_notes', n.id, { narrative: before }, { narrative: n.narrative_html });
                    act(null);
                  }}
                  className="w-full p-2 border border-[#D3DCEE] rounded-lg text-[#122654]"
                />
                {n.is_custom_wording && <span className="text-[10px] font-bold uppercase text-[#4A5878]">Edited</span>}
                <table className="w-full mt-2">
                  <tbody>
                    {n.figures.map((f) => (
                      <tr key={f.label}><td className="py-1 text-[#122654]">{f.label}</td><td className="py-1 text-right font-mono underline">{fmt(BigInt(f.amount_p))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {notes.length === 0 && <p className="text-xs text-[#4A5878]">{empty ? 'No figures yet.' : 'No notes drafted yet.'}</p>}
        </div>
      )}

      {tab === 'checklist' && isCompany && (
        <div className="bg-white border border-[#E3E7EF] rounded-xl shadow-xs overflow-hidden">
          <p className="p-4 bg-[#F5F8FD] border-b border-[#E3E7EF] text-xs text-[#4A5878]">
            Confirm every answer before the accounts are approved. The suggestion comes from the figures in the file; a No needs a manager to accept it.
          </p>
          <ul className="divide-y divide-[#E3E7EF]">
            {checklist.map((c) => (
              <li key={c.id} className="p-4 text-xs space-y-2">
                <p><span className="text-[#4A5878]">{SECTION[c.section]}:</span> <span className="font-semibold text-[#122654]">{c.question}</span> <span className="font-mono text-[#1D4E89]">{c.standard_ref}</span></p>
                <p className="text-[#4A5878]">Suggested: <strong>{c.ai_suggested_answer}</strong>{c.ai_confidence < 90 ? ' (check)' : ''}. {c.ai_reason}</p>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Answer: ${c.question}`}>
                  {(['Yes', 'No', 'N/A'] as const).map((ans) => (
                    <button key={ans} type="button" disabled={locked} aria-pressed={c.confirmed_answer === ans} className={c.confirmed_answer === ans ? btnPrimary : btnSecondary} onClick={() => act(answerChecklist(c.id, ans, actor))}>{ans}</button>
                  ))}
                  {c.confirmed_answer ? <span className="text-[#0B6B52]">Confirmed by {c.confirmed_by}</span> : <span className="text-[#6B4700]">Not confirmed</span>}
                  {c.confirmed_answer === 'No' && (c.manager_override_reason
                    ? <span className="text-[#4A5878]">Accepted: {c.manager_override_reason}</span>
                    : <button type="button" disabled={locked} className={btnSecondary} onClick={async () => { const r = await ask.text({ title: 'Why is a No acceptable here?', label: 'Reason' }); if (r) act(answerChecklist(c.id, 'No', actor, r)); }}>Needs manager acceptance</button>)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'checks' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white border border-[#E3E7EF] rounded-xl divide-y divide-[#E3E7EF]">
            <h2 className="p-4 text-sm font-bold text-[#122654]">Accounts consistency</h2>
            {checks.map((c) => (
              <div key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-2">
                <span className={c.passed ? 'text-[#0B6B52]' : 'text-[#B42318] font-bold'}>{c.passed ? '✓' : '✗'} {c.title}. <span className="font-normal text-[#4A5878]">{c.detail}</span></span>
                {!c.passed && c.href && <Link href={c.href} className="font-bold text-[#B8432F] hover:underline">Open</Link>}
              </div>
            ))}
          </div>
          {isCompany && (
            <div className="bg-white border border-[#E3E7EF] rounded-xl divide-y divide-[#E3E7EF]">
              <h2 className="p-4 text-sm font-bold text-[#122654]">Standard check: {engagement.framework}</h2>
              {findings.length === 0 && <p className="p-4 text-[#0B6B52]">✓ Every schedule the standard requires is in the file.</p>}
              {findings.map((f) => (
                <div key={f.id} className="p-4 flex flex-wrap items-center justify-between gap-2">
                  <span><strong className={f.dismissed ? 'text-[#4A5878]' : 'text-[#B42318]'}>{f.title}.</strong> {f.why}{f.dismissed && <em> Not relevant: {f.dismissed}</em>}</span>
                  {!f.dismissed && <button type="button" disabled={locked} className={btnSecondary} onClick={async () => { const r = await ask.text({ title: 'Why is this not relevant?', text: 'A manager or partner must accept it.', label: 'Reason' }); if (r) act(dismissStandardFinding(engagementId, f.id, r, actor)); }}>Not relevant</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

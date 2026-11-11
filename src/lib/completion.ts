import { db } from './server/db';
import { asPence } from './money';
import { buildAccounts, type AccountsLine } from './workpapers/accounts';
import { evaluatePaper } from './workpapers/engine';
import { packForClient } from './workpapers/templates';
import { standardFor } from './standards';
import { bsAnalysis, postBalanceSheetEvents } from './analysis';
import { JOURNAL_IN_TB, type DisclosureChecklistItem, type StatutoryNoteItem, type UserRole } from './types/models';

/**
 * Step 14: standard completeness check (STD-02), disclosure checklist (STD-03), notes drafted
 * from the accounts (STD-04), final consistency check (AIX-09) and what blocks approval (REV-05).
 * Rules only; a person confirms every answer.
 */

type Actor = { id: string; name: string; role: UserRole };
const MANAGER_UP: UserRole[] = ['manager', 'partner', 'admin'];
const context = (engagementId: string) => {
  const eng = db.engagements.find((e) => e.id === engagementId);
  const client = db.clients.find((c) => c.id === eng?.client_id);
  return { eng, client, standard: eng ? standardFor(client?.company_type, eng.period_end) : null };
};

export interface StandardFinding {
  id: string;
  ref: string;
  title: string;
  why: string;
  dismissed: string | null; // the reason, once a manager has accepted it is not relevant
}

/** STD-02: a schedule the standard needs is missing, or ticked not applicable while the ledger has a balance on it. */
export function standardCheck(engagementId: string): StandardFinding[] {
  const { eng, client, standard } = context(engagementId);
  if (!eng || !client || !standard) return [];
  const papers = db.workpapers.filter((w) => w.engagement_id === engagementId);
  const out: StandardFinding[] = [];
  const add = (id: string, ref: string, title: string, why: string) => out.push({ id, ref, title, why, dismissed: eng.std_dismissed?.[id] ?? null });
  for (const ref of packForClient(client)) {
    const wp = papers.find((w) => w.ref === ref);
    if (!wp) add(`missing:${ref}`, ref, `Schedule ${ref} is required`, `${standard.code} (${standard.version}) requires it for this type of client and it is not in the file.`);
  }
  for (const wp of papers.filter((w) => w.applicable === false)) {
    const balance = (evaluatePaper(wp)?.leads ?? []).filter((l) => l.mapped && l.final !== 0n);
    if (balance.length) add(`na:${wp.ref}`, wp.ref, `Schedule ${wp.ref} is marked not applicable`, `The ledger has a balance on ${balance.map((l) => `${l.code} ${l.label}`).join(', ')}, so ${standard.code} needs this schedule and its note.`);
  }
  return out;
}

export function dismissStandardFinding(engagementId: string, id: string, reason: string, actor: Actor) {
  const { eng } = context(engagementId);
  if (!eng) return 'Engagement not found.';
  if (!MANAGER_UP.includes(actor.role)) return 'A manager or partner must accept that a required schedule is not relevant.';
  if (reason.trim().length < 5) return 'Give a reason.';
  eng.std_dismissed = { ...eng.std_dismissed, [id]: reason.trim() };
  db.logAudit(eng.firm_id, actor, 'DISMISS_STANDARD_FINDING', 'engagements', eng.id, null, { id }, reason.trim());
  return null;
}

type Suggest = (x: { lines: (re: RegExp) => boolean; engagementId: string }) => [DisclosureChecklistItem['ai_suggested_answer'], number, string];
// The questions an accountant confirms before approval. Content is a starting set; the standards library grows it.
const CHECKLIST: [DisclosureChecklistItem['section'], string, string, Suggest][] = [
  ['accounting_policies', 'Basis of preparation and the accounting framework are stated', 'FRS 102 1A.3 / FRS 105.3', () => ['Yes', 95, 'The framework is set on the engagement and printed on the accounts.']],
  ['accounting_policies', 'Depreciation methods and rates are disclosed for each class of asset', 'FRS 102 17.31', ({ lines }) => (lines(/tangible|fixed asset/i) ? ['Yes', 90, 'The balance sheet has tangible fixed assets.'] : ['N/A', 90, 'No tangible fixed assets on the balance sheet.'])],
  ['balance_sheet_notes', 'Creditors due after more than one year, and any security given, are disclosed', 'Companies Act 2006 Sch 1 para 55', ({ lines }) => (lines(/after one year/i) ? ['Yes', 90, 'There are creditors due after one year.'] : ['N/A', 90, 'No creditors due after one year.'])],
  ['pl_notes', 'Average number of employees during the year is disclosed', 'Companies Act 2006 s411', () => ['Yes', 80, 'Every company discloses the average number, including nil.']],
  ['directors', 'Advances and credits to directors, with interest and repayments, are disclosed', 'Companies Act 2006 s413', ({ lines }) => (lines(/director/i) ? ['Yes', 90, 'There is a balance with the directors.'] : ['N/A', 75, 'No directors’ loan balance in the ledger.'])],
  ['related_parties', 'Material related party transactions not concluded under normal market conditions are disclosed', 'FRS 102 1A.C.35', () => ['N/A', 50, 'The ledger cannot show this. Check with the client.']],
  ['commitments', 'Financial commitments, guarantees and contingencies not on the balance sheet are disclosed', 'FRS 102 1A.C.34', () => ['N/A', 50, 'The ledger cannot show this. Check leases and guarantees.']],
  ['post_balance_sheet', 'Material events after the reporting date are described', 'FRS 102 Section 32', ({ engagementId }) => (postBalanceSheetEvents(engagementId).length ? ['Yes', 70, 'There are large postings dated after the year end.'] : ['N/A', 70, 'No large postings after the year end.'])],
  ['going_concern', 'Material uncertainties about going concern are disclosed', 'FRS 102 3.9', ({ engagementId }) => { const g = bsAnalysis(engagementId).goingConcern; return g.length ? ['Yes', 85, g.join('; ')] : ['N/A', 85, 'No going concern indicators are triggered.']; }],
];

/** The engagement's checklist, created on first use with the rule-based suggestions. Companies only. */
export function checklistFor(engagementId: string): DisclosureChecklistItem[] {
  const { eng, standard } = context(engagementId);
  if (!eng || !standard) return [];
  const mine = () => db.checklist_items.filter((c) => c.engagement_id === engagementId);
  if (mine().length === 0 && eng.status !== 'locked') {
    const a = buildAccounts(engagementId);
    const all = Object.values(a.bs).flat();
    const lines = (re: RegExp) => all.some((l) => re.test(l.label) || l.accounts.some((x) => re.test(x.name)));
    CHECKLIST.forEach(([section, question, standard_ref, suggest], i) => {
      const [ai_suggested_answer, ai_confidence, ai_reason] = suggest({ lines, engagementId });
      db.checklist_items.push({ id: `chk_${engagementId}_${i}`, engagement_id: engagementId, section, question, standard_ref, ai_suggested_answer, ai_confidence, ai_reason, confirmed_answer: null });
    });
  }
  return mine();
}

export function answerChecklist(id: string, answer: DisclosureChecklistItem['confirmed_answer'], actor: Actor, overrideReason?: string) {
  const item = db.checklist_items.find((c) => c.id === id);
  const eng = db.engagements.find((e) => e.id === item?.engagement_id);
  if (!item || !eng || eng.status === 'locked') return 'This file is locked.';
  if (answer === 'No') {
    if (!MANAGER_UP.includes(actor.role)) return 'A manager or partner must accept a No answer.';
    if (!overrideReason || overrideReason.trim().length < 5) return 'Answering No requires a reason.';
  }
  const before = { ...item };
  item.confirmed_answer = answer;
  item.confirmed_by = actor.name;
  item.confirmed_at = new Date().toISOString();
  item.manager_override_reason = answer === 'No' ? overrideReason?.trim() || null : null;
  db.logAudit(eng.firm_id, actor, 'ANSWER_DISCLOSURE_CHECKLIST', 'checklist_items', item.id, before, item, overrideReason ?? null);
  return null;
}

const sumLines = (ls: AccountsLine[]) => ls.reduce((t, l) => t + l.amount, 0n);

/** STD-04: notes with figures taken from the accounts. Re-drafting refreshes the figures and keeps edited wording. */
export function draftNotes(engagementId: string, actor: Actor): StatutoryNoteItem[] {
  const { eng, client, standard } = context(engagementId);
  if (!eng || !client || eng.status === 'locked') return notesFor(engagementId);
  const a = buildAccounts(engagementId);
  const fig = (ls: AccountsLine[]) => ls.map((l) => ({ label: l.label, amount_p: l.amount.toString() }));
  const debtors = a.bs.current.filter((l) => /debtor|prepayment/i.test(l.label));
  const equity = a.bs.equity.filter((l) => /share|capital/i.test(l.label));
  const directors = Object.values(a.bs).flat().filter((l) => /director/i.test(l.label));
  const std = standard?.code ?? eng.framework;
  const wanted: [string, string, string, string, AccountsLine[]][] = [
    ['Accounting policies', `${std} basis of preparation`, 'Every set of accounts states its framework and policies.', `These accounts have been prepared under the historical cost convention in accordance with ${std} and the Companies Act 2006. Turnover is recognised when goods or services are supplied, net of VAT.`, []],
    ['Tangible fixed assets', 'FRS 102 17.31', 'The balance sheet has fixed assets.', 'Tangible fixed assets are stated at cost less depreciation, which is charged to write each asset off over its useful life.', a.bs.fixed],
    ['Debtors', 'Companies Act 2006 Sch 1', 'The balance sheet has debtors.', 'Amounts falling due within one year.', debtors],
    ['Creditors: amounts falling due within one year', 'Companies Act 2006 Sch 1', 'The balance sheet has creditors due within one year.', '', a.bs.creditorsShort],
    ['Creditors: amounts falling due after more than one year', 'Companies Act 2006 Sch 1 para 55', 'The balance sheet has creditors due after one year.', '', a.bs.creditorsLong],
    ['Directors’ advances, credits and guarantees', 'Companies Act 2006 s413', 'There is a balance with the directors.', 'Balances with the directors at the period end were as shown. They are interest free and repayable on demand unless stated.', directors],
    ['Called up share capital', 'Companies Act 2006 Sch 1', 'The company has share capital.', 'Allotted, called up and fully paid.', equity],
  ];
  // Notes the standard does not need (no figures behind them) are not suggested
  const keep = wanted.filter(([title, , , , lines]) => title === 'Accounting policies' || sumLines(lines) !== 0n);
  const existing = notesFor(engagementId);
  const next = keep.map(([title, standard_ref, why_included, narrative, lines], i): StatutoryNoteItem => {
    const old = existing.find((n) => n.title === title);
    const figures = fig(lines);
    const moved = old && JSON.stringify(old.figures) !== JSON.stringify(figures);
    return {
      id: old?.id ?? `note_${engagementId}_${Date.now()}_${i}`,
      engagement_id: engagementId,
      note_number: i + 1,
      title,
      standard_ref,
      why_included,
      narrative_html: old?.is_custom_wording ? old.narrative_html : narrative,
      figures,
      status: old?.status === 'reviewed' && moved ? 'updated_needs_review' : old?.status ?? 'draft',
      is_custom_wording: old?.is_custom_wording ?? false,
    };
  });
  db.statutory_notes = db.statutory_notes.filter((n) => n.engagement_id !== engagementId).concat(next);
  db.logAudit(eng.firm_id, actor, 'DRAFT_NOTES', 'engagements', eng.id, null, { notes: next.map((n) => n.title) });
  return next;
}

export const notesFor = (engagementId: string) => db.statutory_notes.filter((n) => n.engagement_id === engagementId).sort((x, y) => x.note_number - y.note_number);

export interface Check {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
  href?: string;
}

/** AIX-09: the accounts agree with themselves and with the file. */
export function consistencyChecks(engagementId: string): Check[] {
  const a = buildAccounts(engagementId);
  const tb = db.account_mappings.filter((m) => m.engagement_id === engagementId).reduce((t, m) => t + asPence(m.balance_p), 0n);
  const journals = db.adjustments.filter((j) => j.engagement_id === engagementId && JOURNAL_IN_TB.includes(j.status)).flatMap((j) => j.lines).reduce((t, l) => t + asPence(l.debit_p) - asPence(l.credit_p), 0n);
  const notes = notesFor(engagementId);
  const all = Object.values(a.bs).flat();
  const stale = notes.filter((n) => n.figures.some((f) => (all.find((l) => l.label === f.label)?.amount ?? 0n).toString() !== f.amount_p));
  const base = `/engagements/${engagementId}`;
  return [
    { id: 'bs_balances', title: 'The balance sheet balances', passed: a.netAssets.amount === a.capitalAndReserves.amount, detail: 'Net assets agree to capital and reserves.', href: `${base}/disclosures` },
    { id: 'tb_balances', title: 'The trial balance and journals balance', passed: tb + journals === 0n, detail: 'Debits equal credits after every journal in the file.', href: `${base}/trial-balance` },
    { id: 'all_mapped', title: 'Every account is mapped', passed: a.unmappedPence === 0n, detail: 'Nothing is left out of the accounts.', href: `${base}/mapping` },
    { id: 'suspense_nil', title: 'Suspense and clearing accounts are nil', passed: sumLines(a.bs.suspense) === 0n, detail: 'Nothing is parked in suspense.', href: `${base}/trial-balance` },
    { id: 'notes_agree', title: 'The notes agree to the balance sheet', passed: stale.length === 0, detail: stale.length ? `Re-draft: ${stale.map((n) => n.title).join(', ')}.` : 'Every note figure matches its balance sheet line.', href: `${base}/disclosures` },
  ];
}

/** REV-05: what stops the partner approving, beyond the sign-off checks in services.getEngagementBlockers. */
export function completionBlockers(engagementId: string): { id: string; title: string; category: string; passed: boolean; count?: number }[] {
  const { standard } = context(engagementId);
  const papers = new Set(db.workpapers.filter((w) => w.engagement_id === engagementId).map((w) => w.id));
  const warnings = db.ai_review_findings.filter((f) => papers.has(f.workpaper_id) && f.status === 'open' && f.severity !== 'info').length;
  const failed = consistencyChecks(engagementId).filter((c) => !c.passed);
  const out = [
    { id: 'ai_warnings', title: 'Review warnings are fixed or dismissed with a reason', category: 'Review', passed: warnings === 0, count: warnings },
    { id: 'consistency', title: `The accounts are consistent${failed.length ? `: ${failed.map((c) => c.title.toLowerCase()).join('; ')} (failed)` : ''}`, category: 'Accounts', passed: failed.length === 0, count: failed.length },
  ];
  if (!standard) return out;
  const open = standardCheck(engagementId).filter((f) => !f.dismissed).length;
  const list = checklistFor(engagementId);
  const unanswered = list.filter((c) => !c.confirmed_answer).length;
  const noes = list.filter((c) => c.confirmed_answer === 'No' && !c.manager_override_reason).length;
  return [
    ...out,
    { id: 'standard_check', title: 'Every schedule the standard requires is in the file', category: 'Standard', passed: open === 0, count: open },
    { id: 'checklist_complete', title: 'The disclosure checklist is confirmed', category: 'Disclosures', passed: unanswered === 0, count: unanswered },
    { id: 'checklist_no', title: 'Every No on the checklist is accepted by a manager', category: 'Disclosures', passed: noes === 0, count: noes },
  ];
}

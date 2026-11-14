import { db } from '../server/db';
import { asPence, formatPence } from '../money';
import { TemplateDef, blankPaperData, templateFor, templateOf } from './templates';
import { JOURNAL_IN_TB, type Workpaper } from '../types/models';
import { analyticalReview, analyticalRows } from './analytical';
import { debtorView, type DebtorLine } from './debtors';
import { PAPER_REVIEWS } from './reviews';
import { inLead, type PaperContext } from './common';

/**
 * Calculations for every working paper: lead figures from the Blynt chart,
 * schedule totals, checks and the Blynt Bot conclusion draft.
 * All money is integer pence (bigint). Trial balance figures are debit-positive.
 */

export interface LeadFigure {
  code: string;
  label: string;
  draft: bigint;
  adjustments: bigint;
  final: bigint;
  prior: bigint | null;
  mapped: boolean;
}

export interface PaperCheck {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  explanation?: string;
}

export interface Anchor {
  id: string;
  label: string;
}

export interface PaperResult {
  engagementId: string;
  template: TemplateDef;
  leads: LeadFigure[];
  checks: PaperCheck[];
  anchors: Anchor[];
  draftConclusion: string;
  /** Totals the page shows, keyed by name. */
  totals: Record<string, bigint>;
}

const matches = inLead;

function tbFor(engagementId: string, prefix: string) {
  const rows = db.account_mappings.filter(
    (m) => m.engagement_id === engagementId && m.status === 'confirmed' && matches(m.blynt_code, prefix)
  );
  const draft = rows.reduce((acc, m) => acc + asPence(m.balance_p), 0n);
  const adjustments = db.adjustments
    .filter((a) => a.engagement_id === engagementId && JOURNAL_IN_TB.includes(a.status))
    .flatMap((a) => a.lines)
    .filter((l) => matches(l.blynt_code, prefix))
    .reduce((acc, l) => acc + asPence(l.debit_p) - asPence(l.credit_p), 0n);
  return { draft, adjustments, final: draft + adjustments, mapped: rows.length > 0 };
}

export function leadFigures(engagementId: string, t: TemplateDef): LeadFigure[] {
  const prior = db.engagements.find((e) => e.id === engagementId)?.prior_engagement_id;
  return t.leads.map((l) => {
    const cur = tbFor(engagementId, l.code);
    const py = prior ? tbFor(prior, l.code) : null;
    return { code: l.code, label: l.label, ...cur, prior: py?.mapped ? py.final : null };
  });
}

/** The trial balance figure the schedule must agree to, shown positive for credit areas. */
function leadTotal(t: TemplateDef, leads: LeadFigure[]) {
  const total = leads.reduce((acc, l) => acc + l.final, 0n);
  return t.creditArea ? -total : total;
}

const tie = (id: string, label: string, schedule: bigint, tb: bigint | null, tbLabel: string): PaperCheck =>
  tb === null
    ? { id, label, detail: `No confirmed trial balance mapping for ${tbLabel} yet.`, passed: false }
    : {
        id,
        label,
        detail: `Schedule ${formatPence(schedule)} · ${tbLabel} ${formatPence(tb)} · difference ${formatPence(schedule - tb)}`,
        passed: schedule === tb,
      };

/** Attachments linked to a schedule row of this paper. */
export function linkedFiles(workpaperId: string, rowId: string) {
  return db.attachments.filter(
    (a) => a.workpaper_id === workpaperId && !a.deleted_at && !a.archived_at && (a.links ?? []).some((l: any) => l.anchor_json?.row === rowId)
  );
}

/* ---------- Bank and cash: one row per account ---------- */

export interface ReconItem {
  id: string;
  date?: string;
  desc: string;
  amount_p: string;
  older_than_30_days?: boolean;
}

export interface ReconAccount {
  id: string; // also the evidence anchor for the statement or count
  code: string; // Blynt lead code, or '*' for every lead no other row covers
  /** The client account this row reconciles, when several are mapped to the same code */
  client_code?: string;
  name: string;
  detail?: string;
  statement_p: string; // '' until a statement balance or cash count is entered
  /** Date of the statement balance used (YYYY-MM-DD) */
  statement_date?: string;
  /** Balances the AI read off the attached statement, best first, offered when the figure entered looks wrong */
  ai_balances?: { date: string; balance_p: string; label: string; page?: number }[];
  source?: 'manual' | 'upload' | 'open_banking';
  synced_at?: string;
  confirmation_p?: string;
  less: ReconItem[];
  add: ReconItem[];
}

/** A balance the AI read off a statement, offered for the row's statement figure. */
export type BalanceOption = NonNullable<ReconAccount['ai_balances']>[number];

export const accountKind = (code: string): 'bank' | 'cash' | 'card' => (code === '6200' || code === '6450' ? 'cash' : code === '6300' ? 'card' : 'bank');
/** The chart code a row shows: its client account's own code (a practice account sits under the lead it works like), else the lead's. */
export const rowCode = (a: ReconAccount, engagementId = '') =>
  (a.client_code && db.account_mappings.find((m) => m.engagement_id === engagementId && m.source_code === a.client_code)?.blynt_code) || a.code;
export const accountName = (a: ReconAccount, engagementId = '') => (a.code === '*' ? a.name : `${rowCode(a, engagementId)} ${a.name}`);
export const statementEntered = (a: ReconAccount) => a.statement_p !== '' && a.statement_p != null;

/**
 * The accounts on a bank and cash paper. Papers saved before accounts existed keep their
 * single statement as one row covering every account; untouched papers start with one row
 * per bank, card and cash account in the trial balance.
 */
/** One list of reconciling items: a deposit in transit is a negative unpresented payment, so older 'add' rows fold in with the sign flipped and the totals stay the same. */
function foldAdd(a: any): ReconAccount {
  if (!(a.add ?? []).length) return { ...a, add: [] };
  const flipped = a.add.map((r: any) => ({ ...r, amount_p: String(-asPence(r.amount_p)) }));
  return { ...a, less: [...(a.less ?? []), ...flipped], add: [] };
}

/** Confirmed client accounts mapped under a lead code. */
export const leadSources = (engagementId: string, code: string) =>
  db.account_mappings.filter((m) => m.engagement_id === engagementId && m.status === 'confirmed' && inLead(m.blynt_code, code));

export function reconAccounts(data: Record<string, any>, leads: LeadFigure[], engagementId = ''): ReconAccount[] {
  if (Array.isArray(data.accounts)) {
    const saved: ReconAccount[] = data.accounts.map(foldAdd);
    if (!engagementId || saved.some((a) => a.code === '*')) return saved;
    // A client account confirmed after the rows were saved gets its own row too (a nil one still needs its statement),
    // unless someone removed it, or the code is still reconciled as one combined row (split that from the row)
    const dismissed = new Set<string>(data.dismissed_accounts ?? []);
    const added = leads.flatMap((l) =>
      saved.some((a) => a.code === l.code && !a.client_code)
        ? []
        : leadSources(engagementId, l.code)
            .filter((m) => !dismissed.has(`${l.code}|${m.source_code}`) && !saved.some((a) => a.code === l.code && a.client_code === m.source_code))
            .map((m) => ({ id: `acc_${l.code}_${m.source_code}`, code: l.code, client_code: m.source_code, name: m.source_name || m.source_code, statement_p: '', less: [], add: [] }))
    );
    return [...saved, ...added];
  }
  const sections: any[] = data.sections ?? [];
  const rowsOf = (neg: boolean) => sections.filter((s) => Number(s.sign) < 0 === neg).flatMap((s) => s.rows ?? []);
  if (asPence(data.statement_p) !== 0n || sections.some((s) => s.rows?.length)) {
    return [foldAdd({ id: 'statement', code: '*', name: data.bank_name || 'Bank and cash', statement_p: data.statement_p ?? '0', confirmation_p: data.confirmation_p, less: rowsOf(true), add: rowsOf(false) })];
  }
  // Each client account is reconciled on its own row, named as the client names it
  return leads
    .filter((l) => l.mapped || l.final !== 0n)
    .flatMap((l) => {
      const src = engagementId ? leadSources(engagementId, l.code) : [];
      return src.length
        ? src.map((m) => ({ id: `acc_${l.code}_${m.source_code}`, code: l.code, client_code: m.source_code, name: m.source_name || m.source_code, statement_p: '', less: [], add: [] }))
        : [{ id: `acc_${l.code}`, code: l.code, name: l.label, statement_p: '', less: [], add: [] }];
    });
}

/**
 * Ledger balance for one row: its client account, else its lead, or for '*' every lead no other row covers.
 * A lead's client-account rows come out of the lead's own row, so the rows still add up to the trial balance.
 */
export function accountLedger(a: ReconAccount, accounts: ReconAccount[], leads: LeadFigure[], creditArea = false, engagementId = '') {
  const mappingOf = (x: ReconAccount) => db.account_mappings.find((m) => m.engagement_id === engagementId && m.status === 'confirmed' && m.source_code === x.client_code && inLead(m.blynt_code, x.code));
  const own = (x: ReconAccount) => asPence(mappingOf(x)?.balance_p ?? '0');
  const rest = (code: string) => (leads.find((l) => l.code === code)?.final ?? 0n) - accounts.filter((x) => x.client_code && x.code === code).reduce((acc, x) => acc + own(x), 0n);
  let final: bigint;
  let mapped: boolean;
  if (a.client_code) {
    const sameCode = accounts.filter((x) => x.code === a.code);
    // Journals post to the chart code, not a client account: they sit with the code's own row, else with its first account
    final = own(a) + (!sameCode.some((x) => !x.client_code) && sameCode[0] === a ? rest(a.code) : 0n);
    mapped = !!mappingOf(a);
  } else {
    const others = new Set(accounts.filter((x) => x !== a).map((x) => x.code));
    const ls = a.code === '*' ? leads.filter((l) => !others.has(l.code)) : leads.filter((l) => l.code === a.code);
    final = ls.reduce((acc, l) => acc + rest(l.code), 0n);
    mapped = ls.some((l) => l.mapped);
  }
  return { final: creditArea ? -final : final, mapped };
}

/* ---------- Trade debtors: recoverability decisions ---------- */

/** Revenue (credit-positive) and the debtors control for an engagement, for debtor days. */
function debtorDays(engagementId: string, adjusted: boolean): bigint | null {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) return null;
  const pick = (code: string) => (adjusted ? tbFor(engagementId, code).final : tbFor(engagementId, code).draft);
  const revenue = -db.blynt_accounts.filter((a) => a.type === 'Revenue').reduce((acc, a) => acc + pick(a.code), 0n);
  const control = pick('7100');
  const days = BigInt(Math.round((Date.parse(eng.period_end) - Date.parse(eng.period_start)) / 86_400_000) + 1);
  return revenue > 0n && control > 0n ? (control * days + revenue / 2n) / revenue : null;
}

/** The journal the debtors decisions need: the provision's movement and credit balances moved to creditors. */
export function debtorsJournal(totals: Record<string, bigint>) {
  return { provision: totals.movement ?? 0n, creditors: totals.moved ?? 0n };
}

/** C-10 checks and totals; returns the conclusion draft. */
function reviewDebtors(engagementId: string, data: Record<string, any>, leads: LeadFigure[], total: bigint, totals: Record<string, bigint>, checks: PaperCheck[]): string {
  const views = ((data.lines ?? []) as DebtorLine[]).map(debtorView);
  const control = leads.find((l) => l.code === '7100');
  // The aged report comes from the client's ledger, so it agrees to the control before any of our journals
  const controlDraft = control?.draft ?? 0n;
  const provisionInTb = -(leads.find((l) => l.code === '7110')?.draft ?? 0n);
  const sum = (f: (v: ReturnType<typeof debtorView>) => bigint) => views.reduce((acc, v) => acc + f(v), 0n);
  const positive = sum((v) => (v.total > 0n ? v.total : 0n));
  const collected = sum((v) => (v.total > 0n ? (v.after < v.total ? v.after : v.total) : 0n));
  const provision = sum((v) => v.provision);
  const moved = sum((v) => v.moved);
  const prior = db.engagements.find((e) => e.id === engagementId)?.prior_engagement_id;
  const days = debtorDays(engagementId, false);
  const daysPy = prior ? debtorDays(prior, true) : null;
  Object.assign(totals, {
    control: controlDraft,
    difference: total - controlDraft,
    positive,
    collected,
    over90: sum((v) => (v.d90 > 0n ? v.d90 : 0n)),
    over90_count: BigInt(views.filter((v) => v.d90 > 0n).length),
    provision,
    suggested: sum((v) => (v.suggestion?.kind === 'provide' ? v.suggestion.amount : 0n)),
    provision_in_tb: provisionInTb,
    movement: provision - provisionInTb,
    moved,
    ...(days !== null ? { debtor_days: days } : {}),
    ...(daysPy !== null ? { debtor_days_py: daysPy } : {}),
  });

  checks.push(tie('control_tb', 'Aged report agrees to control account', total, control?.mapped ? controlDraft : null, 'TB 7100 before adjustments'));
  const unchecked = views.filter((v) => v.total > 0n && v.after === 0n && !v.line.decision);
  checks.push({
    id: 'receipts',
    label: 'After-date receipts checked',
    detail: data.receipts_from_ledger
      ? 'Receipts after the period end were matched from the ledger for every customer.'
      : unchecked.length
        ? `Record receipts after the period end, or refresh from the ledger, for ${unchecked.map((v) => v.line.desc || 'a customer').join(', ')}.`
        : 'Every balance has receipts after the period end or a decision.',
    passed: !!data.receipts_from_ledger || !unchecked.length,
  });
  const old = views.filter((v) => v.d90 > 0n);
  const oldDone = old.filter((v) => !v.suggestion || v.line.decision);
  checks.push({
    id: 'over_90',
    label: `Balances over 90 days reviewed (${oldDone.length}/${old.length})`,
    detail: old.length === oldDone.length ? 'Every balance over 90 days is collected or has a decision.' : `Decide on ${old.filter((v) => !oldDone.includes(v)).map((v) => v.line.desc).join(', ')}.`,
    passed: old.length === oldDone.length,
  });
  const credits = views.filter((v) => v.total < 0n);
  const creditsDone = credits.filter((v) => v.line.decision === 'creditors' || (v.line.decision === 'no_provision' && v.line.reason?.trim()));
  if (credits.length) {
    checks.push({
      id: 'credit_balances',
      label: `Credit balances dealt with (${creditsDone.length}/${credits.length})`,
      detail: credits.length === creditsDone.length ? 'Every credit balance is moved to creditors or explained.' : `Move to creditors or explain: ${credits.filter((v) => !creditsDone.includes(v)).map((v) => v.line.desc).join(', ')}.`,
      passed: credits.length === creditsDone.length,
    });
  }
  const noReason = views.filter((v) => v.line.decision === 'no_provision' && !v.line.reason?.trim());
  checks.push({
    id: 'no_provision_reasons',
    label: 'Reasons given for no provision',
    detail: noReason.length ? `Give a reason for ${noReason.map((v) => v.line.desc).join(', ')}.` : 'Every "no provision" decision has a reason.',
    passed: !noReason.length,
  });
  const need = debtorsJournal(totals);
  const sent = data.journal;
  const needed = need.provision !== 0n || need.creditors !== 0n;
  const matches = sent && asPence(sent.provision_p) === need.provision && asPence(sent.creditors_p) === need.creditors;
  checks.push({
    id: 'journal_sent',
    label: 'Adjustments sent to journals',
    detail: !needed ? 'The decisions need no journal.' : matches ? `Sent as ${sent.ref}.` : sent ? `The decisions changed after ${sent.ref} was sent. Send the journal again and remove ${sent.ref}.` : 'Send the journal built from the decisions.',
    passed: !needed || !!matches,
  });

  const undecided = views.filter((v) => v.needsDecision).length;
  return !control?.mapped
    ? ''
    : `Trade debtors of ${formatPence(controlDraft)} ${total === controlDraft ? 'agree to the aged debtors report' : `differ from the aged debtors report by ${formatPence(total - controlDraft)}`}. ${formatPence(collected)} of ${formatPence(positive)} was received after the period end.${
        provision ? ` A specific provision of ${formatPence(provision)} is made against balances not expected to be recovered.` : ''
      }${moved ? ` Credit balances of ${formatPence(moved)} are shown in creditors.` : ''}${undecided ? ` ${undecided} balance(s) still need a decision.` : ''}`;
}

/** What a paper's own review works from: its data, the trial balance and its linked files. */
export function paperContext(
  wp: Workpaper,
  out: Pick<PaperContext, 'leads' | 'checks' | 'anchors' | 'totals'> = { leads: [], checks: [], anchors: [], totals: {} }
): PaperContext {
  const eng = db.engagements.find((e) => e.id === wp.engagement_id);
  return {
    wpId: wp.id,
    engagementId: wp.engagement_id,
    periodStart: eng?.period_start ?? '',
    periodEnd: eng?.period_end ?? '',
    priorId: eng?.prior_engagement_id ?? null,
    data: wp.data_json as Record<string, any>,
    ...out,
    files: (rowId) => linkedFiles(wp.id, rowId).length,
    tb: (prefix, engagementId = wp.engagement_id) => tbFor(engagementId, prefix),
  };
}

export function evaluatePaper(wp: Workpaper): PaperResult | null {
  const t = templateOf(wp);
  if (!t) return null;
  const data = wp.data_json as Record<string, any>;
  const leads = leadFigures(wp.engagement_id, t);
  const anyMapped = leads.some((l) => l.mapped);
  const tbShown = anyMapped ? leadTotal(t, leads) : null;
  const checks: PaperCheck[] = [];
  const anchors: Anchor[] = [];
  const totals: Record<string, bigint> = {};
  let draft = '';

  const review = PAPER_REVIEWS[t.ref];
  if (review) draft = review(paperContext(wp, { leads, checks, anchors, totals }));

  if (t.kind === 'reconciliation') {
    const accounts = reconAccounts(data, leads, wp.engagement_id);
    const tolerance = toleranceFor(wp.engagement_id);
    const periodEnd = db.engagements.find((e) => e.id === wp.engagement_id)?.period_end;
    const staleBefore = periodEnd ? new Date(Date.parse(periodEnd) - 30 * 86400000).toISOString().slice(0, 10) : null;
    const abs = (x: bigint) => (x < 0n ? -x : x);
    let ledger = 0n, statement = 0n, adjusted = 0n, difference = 0n, unexplained = 0n;
    const noStatement: string[] = [], unreconciled: string[] = [], noEvidence: string[] = [], noTb: string[] = [], old: string[] = [], cashCredit: string[] = [];
    for (const a of accounts) {
      const name = accountName(a, wp.engagement_id);
      const l = accountLedger(a, accounts, leads, t.creditArea, wp.engagement_id);
      const s = asPence(a.statement_p || '0');
      const less = (a.less ?? []).reduce((acc: bigint, r: any) => acc + asPence(r.amount_p), 0n);
      const add = (a.add ?? []).reduce((acc: bigint, r: any) => acc + asPence(r.amount_p), 0n);
      const adj = s - less + add;
      const diff = adj - l.final;
      Object.assign(totals, { [`${a.id}_ledger`]: l.final, [`${a.id}_less`]: less, [`${a.id}_add`]: add, [`${a.id}_adjusted`]: adj, [`${a.id}_diff`]: diff });
      ledger += l.final;
      statement += s;
      adjusted += adj;
      difference += diff;
      unexplained += abs(diff);
      if (!l.mapped) noTb.push(name);
      if (!statementEntered(a)) noStatement.push(name);
      else if (abs(diff) > tolerance) unreconciled.push(`${name} ${formatPence(diff)}`);
      if (!linkedFiles(wp.id, a.id).length) noEvidence.push(name);
      if (accountKind(a.code) === 'cash' && l.final < 0n) cashCredit.push(`${name} shows a credit balance of ${formatPence(l.final)}`);
      anchors.push({ id: a.id, label: `${name} · ${accountKind(a.code) === 'cash' ? 'cash count' : 'statement'}` });
      for (const [items, what] of [[a.less ?? [], 'Unpresented'], [a.add ?? [], 'In transit']] as const) {
        for (const r of items) {
          anchors.push({ id: r.id, label: `${name} · ${what} · ${r.desc || 'item'}` });
          if (r.older_than_30_days || (staleBefore && r.date && r.date < staleBefore)) old.push(`${name}: ${r.desc || 'item'} ${formatPence(asPence(r.amount_p))}`);
        }
      }
      const confirmation = asPence(a.confirmation_p);
      if (confirmation !== 0n) {
        checks.push({
          id: `${a.id}_confirmation`,
          label: `${name} statement agrees to bank confirmation`,
          detail: `Statement ${formatPence(s)} · confirmation ${formatPence(confirmation)} · difference ${formatPence(s - confirmation)}`,
          passed: s === confirmation,
        });
      }
    }
    // Accounts with a TB balance that no row on the schedule covers
    const covered = new Set(accounts.map((a) => a.code));
    const offSchedule = covered.has('*') ? [] : leads.filter((l) => l.mapped && l.final !== 0n && !covered.has(l.code)).map((l) => `${l.code} ${l.label}`);
    Object.assign(totals, { ledger, statement, adjusted, difference, unexplained, tolerance });
    const n = accounts.length;
    const list = (xs: string[]) => xs.join('; ');
    checks.push({
      id: 'ledger_tb',
      label: 'Ledger agrees to trial balance',
      detail: !anyMapped ? 'No confirmed trial balance mapping for bank and cash yet.' : noTb.length || offSchedule.length ? [noTb.length && `No TB balance for ${list(noTb)}.`, offSchedule.length && `In the TB but not on this schedule: ${list(offSchedule)}.`].filter(Boolean).join(' ') : `Every account's ledger balance is taken from the trial balance (${formatPence(ledger)}).`,
      passed: anyMapped && !noTb.length && !offSchedule.length,
    });
    checks.push({ id: 'statements', label: `Statement or count for every account (${n - noStatement.length}/${n})`, detail: noStatement.length ? `Still to enter: ${list(noStatement)}.` : 'Entered for every account.', passed: n > 0 && !noStatement.length });
    checks.push({ id: 'differences', label: 'No unexplained differences', detail: noStatement.length || unreconciled.length ? [unreconciled.length && `Unreconciled: ${list(unreconciled)}.`, noStatement.length && `${noStatement.length} account(s) still to do.`].filter(Boolean).join(' ') : 'Every account reconciles to its ledger balance.', passed: n > 0 && !noStatement.length && !unreconciled.length });
    checks.push({ id: 'evidence', label: `Evidence on every line (${n - noEvidence.length}/${n})`, detail: noEvidence.length ? `Attach a statement or count sheet for ${list(noEvidence)}.` : 'Every account has a statement or count sheet attached.', passed: n > 0 && !noEvidence.length });
    checks.push({ id: 'uncleared_30', label: 'No uncleared items over 30 days', detail: old.length ? `Follow up: ${list(old)}.` : 'No reconciling item is more than 30 days old at the period end.', passed: !old.length });
    if (cashCredit.length) checks.push({ id: 'cash_credit', label: 'Cash is not overdrawn', detail: `${list(cashCredit)}. Cash cannot be overdrawn: look for payments posted to cash in error.`, passed: false });
    draft = !anyMapped
      ? ''
      : `Bank and cash of ${formatPence(ledger)} across ${n} account(s) agrees to the trial balance${
          unreconciled.length || noStatement.length ? `. ${n - noStatement.length - unreconciled.length} of ${n} reconcile to statements or counts so far` : ' and reconciles to statements and cash counts'
        }.${accounts.some((a) => (a.less ?? []).length + (a.add ?? []).length) ? ' Reconciling items should be vouched to after-date statements.' : ' There are no reconciling items.'}`;
  }

  if (!review && t.kind === 'assets') {
    const movements: any[] = data.movements ?? [];
    let cost = 0n,
      dep = 0n,
      charge = 0n,
      expected = 0n,
      pl = 0n;
    for (const c of data.classes ?? []) {
      const adds = movements.filter((m) => m.type === 'addition' && m.class_id === c.id);
      const disp = movements.filter((m) => m.type === 'disposal' && m.class_id === c.id);
      const addCost = adds.reduce<bigint>((a, m) => a + asPence(m.cost_p), 0n);
      const dispCost = disp.reduce<bigint>((a, m) => a + asPence(m.cost_p), 0n);
      const dispDep = disp.reduce<bigint>((a, m) => a + asPence(m.deprec_p), 0n);
      const closingCost = asPence(c.cost_opening_p) + addCost - dispCost;
      const closingDep = asPence(c.deprec_opening_p) + asPence(c.charge_p) - dispDep;
      totals[`${c.id}_additions`] = addCost;
      totals[`${c.id}_disposals`] = dispCost;
      totals[`${c.id}_dep_disposals`] = dispDep;
      totals[`${c.id}_cost`] = closingCost;
      totals[`${c.id}_dep`] = closingDep;
      totals[`${c.id}_nbv`] = closingCost - closingDep;
      cost += closingCost;
      dep += closingDep;
      charge += asPence(c.charge_p);
      // Full year in the year of purchase, none in the year of sale: rate x closing cost
      const rateBp = BigInt(Math.round(Number(c.rate || 0) * 100));
      expected += (closingCost * rateBp + 5000n) / 10000n;
      anchors.push({ id: c.id, label: c.name });
    }
    for (const m of movements) {
      if (m.type === 'disposal') pl += asPence(m.proceeds_p) - (asPence(m.cost_p) - asPence(m.deprec_p));
      anchors.push({ id: m.id, label: `${m.type === 'addition' ? 'Addition' : 'Disposal'} · ${m.item || 'item'}` });
    }
    Object.assign(totals, { cost, dep, nbv: cost - dep, charge, expected, pl });
    const sumLeads = (codes: string[]) => {
      const ls = leads.filter((x) => codes.includes(x.code) && x.mapped);
      return ls.length ? ls.reduce((acc, x) => acc + x.final, 0n) : null;
    };
    const costTb = sumLeads(['6500', '6600', '6700', '6800', '6900']);
    checks.push(tie('cost_tb', 'Closing cost agrees to trial balance', cost, costTb, 'TB 6500-6900 cost'));
    const depTb = sumLeads(['6510', '6610', '6710', '6810', '6910', '6960']);
    checks.push(tie('dep_tb', 'Closing depreciation agrees to trial balance', dep, depTb === null ? null : -depTb, 'TB 6510-6960 depreciation'));
    checks.push(tie('charge_tb', 'Charge agrees to trial balance', charge, sumLeads(['4920']), 'TB 4920'));
    checks.push({
      id: 'proof',
      label: 'Proof in total of depreciation',
      detail: `Expected ${formatPence(expected)} · charged ${formatPence(charge)} · difference ${formatPence(charge - expected)}`,
      passed: (charge - expected <= 100n && expected - charge <= 100n),
    });
    const disposals = movements.filter((m) => m.type === 'disposal');
    if (disposals.length || sumLeads(['4930']) !== null) {
      const plTb = sumLeads(['4930']);
      checks.push(tie('pl_tb', 'Disposal loss or profit agrees to trial balance', -pl, plTb, 'TB 4930'));
    }
    const unvouched = movements.filter(
      (m) => (m.type === 'disposal' || asPence(m.cost_p) > 100000n) && linkedFiles(wp.id, m.id).length === 0
    );
    checks.push({
      id: 'movement_evidence',
      label: 'Additions over £1,000 and all disposals have evidence',
      detail: unvouched.length
        ? `${unvouched.length} item(s) need a file: ${unvouched.map((m) => m.item || 'item').join(', ')}`
        : movements.length
          ? 'Every addition over £1,000 and every disposal has a linked file.'
          : 'No additions or disposals in the year.',
      passed: unvouched.length === 0,
    });
    draft = `Fixed assets of ${formatPence(cost - dep)} net book value ${
      checks[0].passed && checks[1].passed ? 'agree to the trial balance' : 'do not yet agree to the trial balance'
    }. Depreciation of ${formatPence(charge)} ${checks[3].passed ? 'agrees to policy in total' : 'differs from the expected charge'}.${
      disposals.length ? ` The disposal ${pl < 0n ? 'loss' : 'profit'} is ${formatPence(pl < 0n ? -pl : pl)}.` : ''
    }${unvouched.length ? ' Some additions or disposals are still pending evidence.' : ''}`;
  }

  if (!review && t.kind === 'lines') {
    const cols = (t.columns ?? []).filter((c) => c.money !== false && c.inTotal !== false);
    let total = 0n;
    for (const line of data.lines ?? []) {
      for (const c of cols) total += asPence(line[`${c.key}_p`]);
      anchors.push({ id: line.id, label: line.desc || 'Line' });
    }
    totals.total = total;
    totals.difference = total - (tbShown ?? 0n);

    // REC-16: Suspense, clearing and control accounts must be zero with £0.01 tolerance
    if (wp.ref === 'S-10' || t.ref === 'S-10') {
      const isNil = total === 0n && (tbShown === null || tbShown === 0n);
      checks.push({
        id: 'suspense_zero',
        label: 'Suspense and clearing balance must be zero (£0.00)',
        detail: `Current balance ${formatPence(total)} · TB ${formatPence(tbShown ?? 0n)}. Suspense accounts must be nil at period end.`,
        passed: isNil,
      });
    } else if (t.ref === 'C-10') {
      draft = reviewDebtors(wp.engagement_id, data, leads, total, totals, checks);
    } else {
      checks.push(tie('total_tb', 'Schedule total agrees to trial balance', total, tbShown, `TB ${t.leads.map((l) => l.code).join(', ')}`));
    }

    const missing = (data.lines ?? []).filter((l: any) => !l.desc?.trim());
    if (missing.length) {
      checks.push({ id: 'descriptions', label: 'Every line has a description', detail: `${missing.length} line(s) have no description.`, passed: false });
    }
    if (t.ref !== 'C-10') draft =
      tbShown === null
        ? ''
        : `${t.areaName} of ${formatPence(tbShown)} ${total === tbShown ? 'agree to the supporting schedule' : `differ from the schedule by ${formatPence(total - tbShown)}`}.`;
  }

  if (t.kind === 'vat') {
    const returns: any[] = data.returns ?? [];
    let netVatDue = 0n;
    let paidAmount = 0n;
    returns.forEach((r) => {
      netVatDue += asPence(r.box5_net_vat ?? '0');
      if (r.matched) paidAmount += asPence(r.paid_amount_p ?? '0');
      anchors.push({ id: r.id, label: `${r.period_label || 'Return'} · Net VAT` });
    });
    const openPeriod = asPence(data.open_period_p ?? '0');
    const calculatedLiability = (netVatDue - paidAmount) + openPeriod;
    anchors.push({ id: 'open_period', label: 'Open Period Accrued VAT' });

    totals.net_vat_due = netVatDue;
    totals.paid_amount = paidAmount;
    totals.open_period = openPeriod;
    totals.liability = calculatedLiability;
    totals.difference = calculatedLiability - (tbShown ?? 0n);

    checks.push(tie('vat_tb', 'Calculated VAT liability agrees to VAT control account', calculatedLiability, tbShown, 'VAT control (TB 7800)'));
    const unmatched = returns.filter((r) => !r.matched && asPence(r.paid_amount_p ?? '0') > 0n);
    checks.push({
      id: 'vat_payments_matched',
      label: 'All HMRC payments matched to returns',
      detail: unmatched.length === 0 ? 'All VAT returns reconciled to payments.' : `${unmatched.length} return(s) have unverified payment records.`,
      passed: unmatched.length === 0,
    });

    draft = `VAT control account of ${formatPence(tbShown ?? 0n)} ${
      calculatedLiability === (tbShown ?? 0n)
        ? 'reconciles to VAT returns filed and open period liability'
        : `differs from calculated liability of ${formatPence(calculatedLiability)} by ${formatPence(calculatedLiability - (tbShown ?? 0n))}`
    }.`;
  }

  if (t.kind === 'payroll') {
    const months: any[] = data.months ?? [];
    let totalGross = 0n;
    let totalEmpNic = 0n;
    let totalEmpPension = 0n;
    let totalEeNic = 0n;
    let totalPaye = 0n;
    let totalEePension = 0n;
    let totalHmrcPaid = 0n;
    let totalPensionPaid = 0n;

    months.forEach((m) => {
      totalGross += asPence(m.gross_pay_p ?? '0');
      totalEmpNic += asPence(m.employer_nic_p ?? '0');
      totalEmpPension += asPence(m.employer_pension_p ?? '0');
      totalEeNic += asPence(m.employee_nic_p ?? '0');
      totalPaye += asPence(m.paye_tax_p ?? '0');
      totalEePension += asPence(m.employee_pension_p ?? '0');
      totalHmrcPaid += asPence(m.hmrc_paid_p ?? '0');
      totalPensionPaid += asPensionPence(m.pension_paid_p ?? '0');
      anchors.push({ id: `month_${m.month}`, label: `${m.label || `Month ${m.month}`} Payroll` });
    });

    function asPensionPence(v: any): bigint {
      return asPence(v);
    }

    const totalWagesCost = totalGross + totalEmpNic + totalEmpPension;
    const payeNicDue = totalEeNic + totalEmpNic + totalPaye;
    const payeNicLiability = payeNicDue - totalHmrcPaid;
    const pensionDue = totalEePension + totalEmpPension;
    const pensionLiability = pensionDue - totalPensionPaid;

    totals.total_gross = totalGross;
    totals.wages_cost = totalWagesCost;
    totals.paye_nic_liability = payeNicLiability;
    totals.pension_liability = pensionLiability;
    totals.difference = totalWagesCost - (tbShown ?? 0n);

    checks.push(tie('wages_tb', 'Wages expense agrees to P&L payroll accounts', totalWagesCost, tbShown, 'Wages expense (TB 7000)'));
    checks.push({
      id: 'months_complete',
      label: 'All 12 monthly payroll reports uploaded',
      detail: months.length === 12 ? '12 months payroll summaries accounted for.' : `${months.length} of 12 months recorded.`,
      passed: months.length === 12,
    });

    draft = `Payroll reconciliation completed for 12 months. Total gross wages and on-costs of ${formatPence(totalWagesCost)} ${
      totalWagesCost === (tbShown ?? 0n) ? 'agree to the trial balance' : 'differ from trial balance'
    }. Year-end PAYE/NIC liability is ${formatPence(payeNicLiability)} and pension liability is ${formatPence(pensionLiability)}.`;
  }

  if (t.kind === 'leases') {
    const leases: any[] = data.leases ?? [];
    let totalRouCost = 0n;
    let totalRouDep = 0n;
    let totalLiability = 0n;
    let comm1y = 0n, comm1to5y = 0n, commOver5y = 0n;

    leases.forEach((l) => {
      totalRouCost += asPence(l.rou_cost_p ?? '0');
      totalRouDep += asPence(l.rou_dep_p ?? '0');
      totalLiability += asPence(l.liability_cf_p ?? '0');
      comm1y += asPence(l.comm_1y_p ?? '0');
      comm1to5y += asPence(l.comm_1to5y_p ?? '0');
      commOver5y += asPence(l.comm_over5y_p ?? '0');
      anchors.push({ id: l.id, label: `Lease · ${l.property || l.lessor || 'Asset'}` });
    });

    totals.rou_cost = totalRouCost;
    totals.rou_dep = totalRouDep;
    totals.rou_nbv = totalRouCost - totalRouDep;
    totals.lease_liability = totalLiability;
    totals.difference = totalLiability - (tbShown ?? 0n);

    checks.push(tie('lease_tb', 'Lease liability agrees to trial balance', totalLiability, tbShown, 'Lease liabilities (TB 8200)'));
    checks.push({
      id: 'commitments_split',
      label: 'Commitments maturity split completed',
      detail: `Within 1y: ${formatPence(comm1y)} · 1-5y: ${formatPence(comm1to5y)} · >5y: ${formatPence(commOver5y)}`,
      passed: leases.length === 0 || (comm1y + comm1to5y + commOver5y > 0n),
    });

    draft = `Leases evaluated under ${data.model === 'right_of_use' ? 'FRS 102 Right-of-use model' : 'FRS 105 Operating lease commitments model'}. Total liability ${formatPence(totalLiability)} ${
      totalLiability === (tbShown ?? 0n) ? 'agrees to the trial balance.' : 'differs from the trial balance.'
    }`;
  }

  if (!review && t.kind === 'dla') {
    const directors: any[] = data.directors ?? [];
    let netDla = 0n;
    let anyOverdrawn = false;
    let totalS455 = 0n;

    directors.forEach((d) => {
      const op = asPence(d.opening_p ?? '0');
      const dr = asPence(d.drawings_p ?? '0');
      const sal = asPence(d.salary_credited_p ?? '0');
      const div = asPence(d.dividends_credited_p ?? '0');
      const rep = asPence(d.repaid_in_9m_p ?? '0');
      const cl = op + dr - sal - div;
      netDla += cl;
      if (cl < 0n) {
        anyOverdrawn = true;
        const s455Rate = BigInt(Math.round(Number(d.s455_rate_pct || 33.75) * 100));
        const s455 = (-cl * s455Rate) / 10000n;
        totalS455 += s455;
      }
      anchors.push({ id: d.id, label: `DLA · ${d.name || 'Director'}` });
    });

    totals.net_dla = netDla;
    totals.s455_tax = totalS455;
    totals.difference = netDla - (tbShown ?? 0n);

    checks.push(tie('dla_tb', "Directors' loan balance agrees to trial balance", netDla, tbShown, 'DLA (TB 7980)'));
    checks.push({
      id: 'dla_overdrawn_check',
      label: "s455 tax check on overdrawn loan accounts",
      detail: anyOverdrawn
        ? `Overdrawn account identified. Potential s455 tax liability: ${formatPence(totalS455)} if not repaid within 9 months.`
        : "No overdrawn director loan balances at period end.",
      passed: !anyOverdrawn || (directors.every((d) => asPence(d.repaid_in_9m_p ?? '0') >= -asPence(d.closing_p ?? '0'))),
    });

    draft = `Director loan accounts total ${formatPence(netDla)} ${
      netDla === (tbShown ?? 0n) ? 'and agree to the trial balance.' : 'and differ from the trial balance.'
    } ${anyOverdrawn ? `Caution: Overdrawn balance detected subject to s455 tax review (${formatPence(totalS455)}).` : 'All accounts in credit.'}`;
  }

  if (!review && t.kind === 'loans') {
    const principal = asPence(data.principal_p ?? '0');
    const within1y = asPence(data.maturity?.within_1y_p ?? '0');
    const within1to5y = asPence(data.maturity?.within_1_to_5y_p ?? '0');
    const over5y = asPence(data.maturity?.over_5y_p ?? '0');
    const maturitySum = within1y + within1to5y + over5y;

    totals.principal = principal;
    totals.within_1y = within1y;
    totals.within_1to5y = within1to5y;
    totals.over_5y = over5y;
    totals.difference = principal - (tbShown ?? 0n);

    anchors.push({ id: 'principal', label: `${data.lender || 'Loan'} · Principal` });
    anchors.push({ id: 'maturity', label: `${data.lender || 'Loan'} · Maturity Split` });

    checks.push(tie('loan_tb', 'Loan principal agrees to trial balance', principal, tbShown, 'Bank loans (TB 7990/8000)'));
    checks.push({
      id: 'loan_maturity_tie',
      label: 'Maturity analysis agrees to total principal',
      detail: `Maturity sum ${formatPence(maturitySum)} · Principal ${formatPence(principal)}`,
      passed: principal === 0n || maturitySum === principal,
    });

    draft = `Loan with ${data.lender || 'lender'} of ${formatPence(principal)} ${
      principal === (tbShown ?? 0n) ? 'agrees to ledger.' : 'differs from ledger.'
    } Maturity analysis: <1yr ${formatPence(within1y)}, 1-5yrs ${formatPence(within1to5y)}, >5yrs ${formatPence(over5y)}.`;
  }

  if (t.kind === 'tax') {
    if (wp.ref === 'T-30' || t.ref === 'T-30') {
      const nbv = asPence(data.fixed_asset_nbv_p ?? '0');
      const twdv = asPence(data.tax_written_down_value_p ?? '0');
      const timingDiff = nbv - twdv;
      const ratePct = Number(data.tax_rate_pct || 25);
      const rateBp = BigInt(Math.round(ratePct * 100));
      const provision = (timingDiff * rateBp) / 10000n;
      totals.nbv = nbv;
      totals.twdv = twdv;
      totals.timing_difference = timingDiff;
      totals.provision = provision;
      totals.difference = provision - (tbShown ?? 0n);

      anchors.push({ id: 'timing_diff', label: 'Timing differences on fixed assets' });
      anchors.push({ id: 'provision', label: 'Deferred tax provision c/f' });

      checks.push(tie('deferred_tax_tb', 'Deferred tax provision agrees to trial balance', provision, tbShown, 'Deferred tax (TB 8400)'));
      draft = `Deferred tax provision of ${formatPence(provision)} calculated at ${ratePct}% on net timing differences of ${formatPence(timingDiff)} ${
        provision === (tbShown ?? 0n) ? 'agrees to the trial balance.' : 'differs from the trial balance.'
      }`;
    } else {
      // T-10 Corporation Tax
      const pyLiab = asPence(data.prior_year_liability_p ?? '0');
      const paid = asPence(data.payments_made_p ?? '0');
      const overUnder = asPence(data.over_under_provision_p ?? '0');
      const cyCharge = asPence(data.current_year_charge_p ?? '0');
      const closingLiab = (pyLiab - paid - overUnder) + cyCharge;

      totals.prior_year_liability = pyLiab;
      totals.payments_made = paid;
      totals.over_under_provision = overUnder;
      totals.current_year_charge = cyCharge;
      totals.closing_liability = closingLiab;
      totals.difference = closingLiab - (tbShown ?? 0n);

      anchors.push({ id: 'current_year_charge', label: 'Corporation tax charge for year' });
      anchors.push({ id: 'closing_liability', label: 'Corporation tax liability c/f' });

      checks.push(tie('ct_liability_tb', 'Corporation tax liability agrees to trial balance', closingLiab, tbShown, 'CT liability (TB 7950)'));
      if (data.charge_source === 'estimate') {
        checks.push({
          id: 'ct_estimate',
          label: 'Current year charge is estimated',
          detail: 'Charge calculated from estimated profit and central rates. Replace with final computation once available.',
          passed: true,
          explanation: 'Estimated charge based on trial balance net profit.',
        });
      }
      draft = `Corporation tax liability of ${formatPence(closingLiab)} (including current year charge of ${formatPence(cyCharge)}) ${
        closingLiab === (tbShown ?? 0n) ? 'agrees to the trial balance.' : 'differs from the trial balance.'
      }`;
    }
  }

  if (t.kind === 'checklist') {
    const items: any[] = data.items ?? [];
    const unanswered = items.filter((i) => !i.answer);
    const noWithoutComment = items.filter((i) => i.answer === 'no' && !i.comment?.trim());
    items.forEach((i) => anchors.push({ id: i.id, label: i.question }));
    checks.push({
      id: 'answered',
      label: 'Every question answered',
      detail: unanswered.length ? `${unanswered.length} of ${items.length} still to answer.` : `All ${items.length} answered.`,
      passed: unanswered.length === 0,
    });
    checks.push({
      id: 'no_explained',
      label: 'Every “No” has an explanation',
      detail: noWithoutComment.length ? `${noWithoutComment.length} answer(s) need a comment.` : 'Nothing to explain.',
      passed: noWithoutComment.length === 0,
    });
    if (t.materiality) {
      const benchmark = asPence(data.benchmark_p);
      const pctBp = BigInt(Math.round(Number(data.percent || 0) * 100));
      const pmBp = BigInt(Math.round(Number(data.pm_percent || 0) * 100));
      const mat = (benchmark * pctBp) / 10000n;
      totals.materiality = mat;
      totals.performance = (mat * pmBp) / 10000n;
      totals.benchmark_tb = tbShown ?? 0n;
      checks.push({
        id: 'materiality',
        label: 'Materiality set',
        detail: benchmark > 0n ? `Materiality ${formatPence(mat)} · performance ${formatPence(totals.performance)}` : 'Enter the benchmark to set materiality.',
        passed: benchmark > 0n && mat > 0n,
      });
    }
    draft = unanswered.length
      ? ''
      : `All ${items.length} checklist questions are answered${
          items.some((i) => i.answer === 'no') ? ', and every exception is explained' : ' with no exceptions'
        }.${t.materiality && totals.materiality ? ` Materiality is set at ${formatPence(totals.materiality)}.` : ''}`;
  }

  if (!review && t.kind === 'analytical') {
    const review = analyticalReview(wp.engagement_id, t.analyticalView ?? 'pl', data);
    const comments: Record<string, string> = data.comments ?? {};
    const rows = analyticalRows(review);
    const significant = rows.filter((r) => r.significant);
    const missing = significant.filter((r) => !comments[r.key]?.trim());
    rows.forEach((r) => anchors.push({ id: r.key, label: r.name }));
    checks.push({ id: 'figures', label: 'There are confirmed figures to review', detail: rows.length ? `${rows.length} lines with figures.` : 'Import the trial balance and confirm the mappings.', passed: rows.length > 0 });
    checks.push({ id: 'all_mapped', label: 'Every balance is confirmed to an account', detail: review.unmappedPence === 0n ? 'Nothing unconfirmed.' : `${formatPence(review.unmappedPence)} is not confirmed yet, so these figures may change.`, passed: review.unmappedPence === 0n });
    checks.push({ id: 'explained', label: 'Flagged variances explained', detail: missing.length ? `${missing.length} of ${significant.length} still need an explanation.` : `${significant.length} flagged, all explained.`, passed: missing.length === 0 });
    draft = rows.length && review.hasPrior && !missing.length ? `Figures were compared with the prior year. ${significant.length ? `${significant.length} flagged variance(s) were explained.` : 'No variance reached the flag settings.'}` : '';
  }

  if (!review && t.kind === 'statutory') {
    const officers: any[] = data.officers ?? [];
    const directors = officers.filter((o) => o.is_director && !o.resigned);
    const holders = officers.filter((o) => o.is_shareholder);
    const noShares = holders.filter((o) => !(Number(o.shares) > 0));
    const badDates = officers.filter((o) => o.appointed && o.resigned && o.resigned < o.appointed);
    const unnamed = officers.filter((o) => !o.surname?.trim());
    const shares = holders.reduce((sum, o) => sum + BigInt(/^\d+$/.test(o.shares ?? '') ? o.shares : 0), 0n);
    totals.shares = shares;
    officers.forEach((o) => anchors.push({ id: o.id, label: [o.first_name, o.surname].filter(Boolean).join(' ') || 'Person' }));
    checks.push({ id: 'director', label: 'At least one director in office', detail: `${directors.length} director(s) in office.`, passed: directors.length > 0 });
    checks.push({ id: 'shareholder', label: 'At least one shareholder recorded', detail: `${holders.length} shareholder(s).`, passed: holders.length > 0 });
    checks.push({ id: 'shares', label: 'Every shareholder has a number of shares', detail: noShares.length ? `${noShares.length} shareholder(s) have no shares entered.` : 'All entered.', passed: noShares.length === 0 });
    checks.push({ id: 'names', label: 'Everyone has a surname', detail: unnamed.length ? `${unnamed.length} row(s) have no surname.` : 'All named.', passed: unnamed.length === 0 });
    checks.push({ id: 'dates', label: 'Resignation dates follow appointment dates', detail: badDates.length ? `${badDates.length} row(s) to correct.` : 'No conflicts.', passed: badDates.length === 0 });
    draft = directors.length && holders.length ? `${directors.length} director(s) in office and ${holders.length} shareholder(s) holding ${shares.toLocaleString('en-GB')} shares are recorded.` : '';
  }

  // Explanations entered by the preparer clear a failing check for sign-off purposes
  const explanations: Record<string, string> = data.explanations ?? {};
  for (const c of checks) if (!c.passed && explanations[c.id]?.trim()) c.explanation = explanations[c.id];

  return { engagementId: wp.engagement_id, template: t, leads, checks, anchors, draftConclusion: draft, totals };
}

// Statuses the engine works out; anything else (prepared, signed off, stale…) is set by people
const COMPUTED: Workpaper['status'][] = ['not_started', 'in_progress', 'unreconciled', 'reconciled'];

/** The practice's reconciliation tolerance in pence (ADM-02), £1 when not set. */
export function toleranceFor(engagementId: string): bigint {
  const firmId = db.engagements.find((e) => e.id === engagementId)?.firm_id;
  return asPence(db.firms.find((f) => f.id === firmId)?.settings?.defaults?.tolerance_p ?? '100');
}

/**
 * Status engine (WPS-04): Not started until something is entered, then Unreconciled or
 * Reconciled by whether the difference to the TB is within the practice tolerance. Papers
 * without a difference (checklists) are In progress once started.
 */
export function paperStatus(wp: Workpaper): Workpaper['status'] {
  if (!COMPUTED.includes(wp.status)) return wp.status;
  const t = templateOf(wp);
  if (!t) return wp.status;
  const started = JSON.stringify(wp.data_json) !== JSON.stringify(blankPaperData(t));
  if (!started) return 'not_started';
  const totals = evaluatePaper(wp)?.totals;
  // Bank and cash adds up each account's difference, so two accounts out by opposite amounts never pass
  const diff = totals?.unexplained ?? totals?.difference;
  if (diff === undefined) return 'in_progress';
  return (diff < 0n ? -diff : diff) <= toleranceFor(wp.engagement_id) ? 'reconciled' : 'unreconciled';
}

/** Effect of the journals in the TB on profit (credit-positive P&L lines) and net assets (assets less liabilities). */
export function registerTotals(engagementId: string) {
  const typeOf = new Map(db.blynt_accounts.map((a) => [a.code, a.type]));
  let profit = 0n;
  let netAssets = 0n;
  for (const j of db.adjustments.filter((a) => a.engagement_id === engagementId && JOURNAL_IN_TB.includes(a.status))) {
    for (const l of j.lines) {
      const move = BigInt(l.debit_p) - BigInt(l.credit_p);
      const t = typeOf.get(l.blynt_code);
      if (t === 'Revenue' || t === 'Cost of Sales' || t === 'Overhead') profit -= move;
      else if (t === 'Asset' || t === 'Liability') netAssets += move;
    }
  }
  return { profit_p: profit, net_assets_p: netAssets };
}

/** Sign-off levels for this paper: the client's own setting, else the practice's, else 3. */
export function levelsFor(wp: Workpaper): number {
  const eng = db.engagements.find((e) => e.id === wp.engagement_id);
  const client = db.clients.find((c) => c.id === eng?.client_id);
  const firm = db.firms.find((f) => f.id === eng?.firm_id);
  return client?.signoff_levels ?? firm?.settings?.defaults?.signoff_levels ?? 3;
}

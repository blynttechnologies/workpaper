import { db } from './server/db';
import { asPence, formatPence } from './money';
import { buildAccounts, type AccountsLine } from './workpapers/accounts';
import { evaluatePaper, paperStatus } from './workpapers/engine';
import { templateFor } from './workpapers/templates';
import { accountsDue } from './workpapers/statutory';
import { bsAnalysis, keyFigures, plAnalysis } from './analysis';
import { JOURNAL_IN_TB, type Budget, type ForecastAssumptions, type UserRole } from './types/models';

/**
 * Stage E (steps 15 to 18): report library, practice reports, budgets, cash flow statement,
 * cash forecast, quarterly insight pack and the ledger journal export. Every figure comes from
 * buildAccounts, so a number is the same wherever it appears (RPT-01).
 */

type Actor = { id: string; name: string; role: UserRole };
const abs = (n: bigint) => (n < 0n ? -n : n);
const sum = (ls: AccountsLine[]) => ls.reduce((t, l) => t + l.amount, 0n);
const sumPrior = (ls: AccountsLine[]) => ls.reduce((t, l) => t + (l.prior ?? 0n), 0n);
const pounds = (p: bigint) => (Number(p) / 100).toFixed(2);

// ---------- RPT-01: report library ----------

export type Cell = string | bigint;
export interface Report {
  title: string;
  columns: string[];
  rows: Cell[][];
}

export const REPORTS = [
  ['tb_unadjusted', 'Trial balance (as imported)'],
  ['tb_adjusted', 'Trial balance (adjusted)'],
  ['journals', 'Journal register'],
  ['review_status', 'Review status'],
  ['review_points', 'Open review points'],
  ['ai_findings', 'Review findings'],
] as const;
export type ReportKey = (typeof REPORTS)[number][0];

export function buildReport(engagementId: string, key: ReportKey): Report {
  const title = REPORTS.find((r) => r[0] === key)![1];
  const papers = db.workpapers.filter((w) => w.engagement_id === engagementId);
  const refOf = (wpId: string) => papers.find((w) => w.id === wpId)?.ref ?? '';
  const mine = (wpId: string) => papers.some((w) => w.id === wpId);
  const journals = db.adjustments.filter((j) => j.engagement_id === engagementId);
  switch (key) {
    case 'tb_unadjusted':
      return { title, columns: ['Code', 'Account', 'Balance'], rows: db.account_mappings.filter((m) => m.engagement_id === engagementId).map((m) => [m.source_code, m.source_name, asPence(m.balance_p)]) };
    case 'tb_adjusted': {
      const by = new Map<string, { imported: bigint; journals: bigint }>();
      const at = (code: string) => by.get(code) ?? by.set(code, { imported: 0n, journals: 0n }).get(code)!;
      for (const m of db.account_mappings.filter((x) => x.engagement_id === engagementId)) at(m.blynt_code ?? 'Unmapped').imported += asPence(m.balance_p);
      for (const l of journals.filter((j) => JOURNAL_IN_TB.includes(j.status)).flatMap((j) => j.lines)) at(l.blynt_code).journals += asPence(l.debit_p) - asPence(l.credit_p);
      const name = (code: string) => db.blynt_accounts.find((a) => a.code === code)?.name ?? code;
      return { title, columns: ['Code', 'Account', 'Imported', 'Journals', 'Adjusted'], rows: [...by].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([code, v]) => [code, name(code), v.imported, v.journals, v.imported + v.journals]) };
    }
    case 'journals':
      return { title, columns: ['Ref', 'Date', 'Status', 'Narrative', 'Account', 'Debit', 'Credit'], rows: journals.flatMap((j) => j.lines.map((l): Cell[] => [j.ref, j.date ?? '', j.status, j.narrative, l.blynt_code, asPence(l.debit_p), asPence(l.credit_p)])) };
    case 'review_status':
      return {
        title,
        columns: ['Ref', 'Schedule', 'Status', 'Prepared', 'Reviewed', 'Approved'],
        rows: papers.map((w) => {
          const by = (role: string) => db.signoffs.find((s) => s.workpaper_id === w.id && s.role === role && !s.stale_at)?.user_name ?? '';
          return [w.ref, w.custom_template?.title ?? templateFor(w.ref)?.title ?? '', w.applicable === false ? 'Not applicable' : paperStatus(w), by('preparer'), by('reviewer'), by('partner')];
        }),
      };
    case 'review_points':
      return { title, columns: ['Schedule', 'Raised by', 'Date', 'Point'], rows: db.comments.filter((c) => mine(c.workpaper_id) && c.type === 'review_note' && c.status === 'open').map((c) => [refOf(c.workpaper_id), c.created_by_name, c.created_at.slice(0, 10), c.body]) };
    case 'ai_findings':
      return { title, columns: ['Schedule', 'Severity', 'Finding', 'Status', 'Reason'], rows: db.ai_review_findings.filter((f) => mine(f.workpaper_id)).map((f) => [f.schedule_ref ?? refOf(f.workpaper_id), f.severity, f.title, f.status, f.dismiss_reason ?? '']) };
  }
}

const csvCell = (c: Cell) => (typeof c === 'bigint' ? pounds(c) : /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
/** Amounts are written as plain numbers so a spreadsheet reads them as numbers, not text. */
export const toCsv = (columns: string[], rows: Cell[][]) => [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

// ---------- RPT-03 and ENG-05: practice reports ----------

export function practiceReport(firmId: string, today = new Date().toISOString().slice(0, 10)) {
  const clients = new Map(db.clients.filter((c) => c.firm_id === firmId && !c.archived_at).map((c) => [c.id, c]));
  const work = db.engagements
    .filter((e) => e.firm_id === firmId && clients.has(e.client_id))
    .map((e) => {
      const papers = db.workpapers.filter((w) => w.engagement_id === e.id && w.applicable !== false);
      const share = (n: number) => (papers.length ? Math.round((n / papers.length) * 100) : 0);
      const reviewed = papers.filter((w) => db.signoffs.some((s) => s.workpaper_id === w.id && s.role !== 'preparer' && !s.stale_at)).length;
      const reconciled = papers.filter((w) => ['reconciled', 'prepared', 'signed_off'].includes(paperStatus(w))).length;
      const due = accountsDue(e.period_end);
      const daysLeft = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
      const openPoints = db.comments.filter((c) => c.type === 'review_note' && c.status === 'open' && papers.some((w) => w.id === c.workpaper_id)).length;
      return { id: e.id, client: clients.get(e.client_id)!.name, periodEnd: e.period_end, stage: e.status, reconciledPct: share(reconciled), reviewedPct: share(reviewed), unreconciled: papers.length - reconciled, openPoints, due, daysLeft, alert: e.status === 'locked' ? 'none' : daysLeft < 0 ? 'overdue' : daysLeft <= 30 ? 'soon' : 'none' };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // AI accuracy per output type per month: accepted without change over everything decided (DAT-08)
  const cells = new Map<string, { month: string; type: string; total: number; unchanged: number }>();
  for (const a of db.ai_action_logs.filter((x) => x.firm_id === firmId)) {
    const month = a.decided_at.slice(0, 7);
    const k = `${month}|${a.output_type}`;
    const c = cells.get(k) ?? cells.set(k, { month, type: a.output_type, total: 0, unchanged: 0 }).get(k)!;
    c.total += 1;
    if (a.outcome === 'accepted' || a.outcome === 'auto_accepted') c.unchanged += 1;
  }
  const ai = [...cells.values()].sort((a, b) => b.month.localeCompare(a.month) || a.type.localeCompare(b.type)).map((c) => ({ ...c, pct: Math.round((c.unchanged / c.total) * 100) }));
  return { work, ai };
}

// ---------- MGT-03: budgets ----------

const editable = (engagementId: string) => {
  const eng = db.engagements.find((e) => e.id === engagementId);
  return eng && eng.status !== 'locked' ? eng : null;
};

/** A new budget: last year's figures spread evenly over twelve months (or this year's when there is no last year), or blank. */
export function newBudget(engagementId: string, name: string, method: 'prior' | 'blank', actor: Actor, upliftPct = 0): Budget | null {
  const eng = editable(engagementId);
  if (!eng || !name.trim()) return null;
  const a = buildAccounts(engagementId);
  const lines: Budget['lines'] = {};
  for (const l of a.pl) {
    const base = method === 'blank' ? 0n : ((l.prior ?? l.amount) * BigInt(Math.round(100 + upliftPct))) / 100n;
    const month = base / 12n;
    // The rounding difference goes in the last month so the year still adds up
    lines[l.label] = Array.from({ length: 12 }, (_, i) => (i === 11 ? base - month * 11n : month).toString());
  }
  const budget: Budget = { id: `bud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), active: !(eng.budgets ?? []).length, lines };
  eng.budgets = [...(eng.budgets ?? []), budget];
  db.logAudit(eng.firm_id, actor, 'CREATE_BUDGET', 'engagements', eng.id, null, { id: budget.id, name: budget.name, method });
  return budget;
}

export function setBudgetCell(engagementId: string, budgetId: string, line: string, month: number, pence: bigint, actor: Actor) {
  const eng = editable(engagementId);
  const b = eng?.budgets?.find((x) => x.id === budgetId);
  if (!eng || !b || !b.lines[line] || month < 0 || month > 11) return;
  const before = b.lines[line][month];
  b.lines[line][month] = pence.toString();
  db.logAudit(eng.firm_id, actor, 'EDIT_BUDGET', 'engagements', eng.id, { line, month, amount_p: before }, { line, month, amount_p: pence.toString() });
}

export function setActiveBudget(engagementId: string, budgetId: string, actor: Actor) {
  const eng = editable(engagementId);
  if (!eng?.budgets?.some((b) => b.id === budgetId)) return;
  for (const b of eng.budgets) b.active = b.id === budgetId;
  db.logAudit(eng.firm_id, actor, 'SET_ACTIVE_BUDGET', 'engagements', eng.id, null, { id: budgetId });
}

export const activeBudget = (engagementId: string) => db.engagements.find((e) => e.id === engagementId)?.budgets?.find((b) => b.active) ?? null;
const yearTotal = (months: string[]) => months.reduce((t, m) => t + asPence(m), 0n);

export const budgetCsv = (b: Budget) => toCsv(['Line', ...Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`)], Object.entries(b.lines).map(([line, months]) => [line, ...months.map((m) => asPence(m))]));

/** Reads a budget back from the exported layout. Lines not in the budget are ignored; returns how many lines were read. */
export function importBudgetCsv(engagementId: string, budgetId: string, csv: string, actor: Actor): number {
  const eng = editable(engagementId);
  const b = eng?.budgets?.find((x) => x.id === budgetId);
  if (!eng || !b) return 0;
  let read = 0;
  for (const row of csv.split(/\r?\n/).slice(1)) {
    // The line name may be quoted and contain commas; the twelve amounts never do
    const cells = row.split(',');
    const amounts = cells.slice(-12);
    const line = cells.slice(0, -12).join(',').replace(/^"|"$/g, '').replace(/""/g, '"');
    if (!b.lines[line] || amounts.length !== 12 || amounts.some((x) => !/^-?\d+(\.\d{1,2})?$/.test(x.trim()))) continue;
    b.lines[line] = amounts.map((x) => BigInt(Math.round(Number(x) * 100)).toString());
    read += 1;
  }
  db.logAudit(eng.firm_id, actor, 'IMPORT_BUDGET', 'engagements', eng.id, null, { id: budgetId, lines: read });
  return read;
}

export function budgetVsActual(engagementId: string) {
  const b = activeBudget(engagementId);
  if (!b) return null;
  const rows = buildAccounts(engagementId).pl.map((l) => {
    const budget = yearTotal(b.lines[l.label] ?? []);
    const variance = l.amount - budget;
    return { label: l.label, actual: l.amount, budget, variance, percent: budget === 0n ? null : (Number(variance) / Number(abs(budget))) * 100 };
  });
  return { name: b.name, rows };
}

// ---------- MGT-04: cash flow statement (indirect method) ----------

const isCash = (l: AccountsLine) => /cash|bank/i.test(l.label);
const isLoan = (l: AccountsLine) => /loan|hire purchase|overdraft/i.test(l.label);

export function cashFlow(engagementId: string) {
  const a = buildAccounts(engagementId);
  if (!a.hasPrior) return null;
  const move = (ls: AccountsLine[]) => sum(ls) - sumPrior(ls);
  const depreciation = -a.pl.flatMap((l) => l.review).filter((x) => /depreciation|amortisation/i.test(x.name)).reduce((t, x) => t + x.amount, 0n);
  const current = [...a.bs.current, ...a.bs.suspense].filter((l) => !isCash(l));
  const stock = current.filter((l) => /stock|work in progress/i.test(l.label));
  const debtors = current.filter((l) => !stock.includes(l));
  const tradeCreditors = a.bs.creditorsShort.filter((l) => !isLoan(l));
  const loans = [...a.bs.creditorsShort.filter(isLoan), ...a.bs.creditorsLong];
  // Last year's profit moves into reserves, so it is taken out of the movement on capital
  const equity = move(a.bs.equity) - (a.profit.prior ?? 0n);
  const lines = [
    { group: 'Operating', label: 'Profit for the period', plain: 'Your profit', amount: a.profit.amount },
    { group: 'Operating', label: 'Depreciation and amortisation', plain: 'Add back wear and tear on equipment (not cash)', amount: depreciation },
    { group: 'Operating', label: '(Increase)/decrease in stock', plain: 'Cash tied up in stock', amount: -move(stock) },
    { group: 'Operating', label: '(Increase)/decrease in debtors', plain: 'Money owed to you that has not come in yet', amount: -move(debtors) },
    { group: 'Operating', label: 'Increase/(decrease) in creditors', plain: 'Bills and tax you have not paid yet', amount: move(tradeCreditors) + move(a.bs.provisions) },
    { group: 'Investing', label: 'Purchase of fixed assets, net of disposals', plain: 'Spent on equipment and other long-term assets', amount: -(move(a.bs.fixed) + depreciation) },
    { group: 'Financing', label: 'Loans received/(repaid)', plain: 'Loans taken out, less repayments', amount: move(loans) },
    { group: 'Financing', label: 'Shares issued, less dividends and drawings', plain: 'Money put in by the owners, less money taken out', amount: equity },
  ];
  const cash = [...a.bs.current, ...a.bs.suspense].filter(isCash);
  const change = lines.reduce((t, l) => t + l.amount, 0n);
  const opening = sumPrior(cash);
  const closing = sum(cash);
  // Closing cash only disagrees when one of the two balance sheets does not balance
  return { lines, change, opening, closing, difference: closing - (opening + change) };
}

// ---------- MGT-05: 12-month cash forecast ----------

export const DEFAULT_FORECAST: ForecastAssumptions = { debtor_days: 30, creditor_days: 30, minimum_cash_p: '0', capex_p: '0', dividends_p: '0' };

/** Receipts and payments follow the active budget, delayed by debtor and creditor days; months before the budget starts are taken as the first month. */
export function cashForecast(engagementId: string, assumptions?: ForecastAssumptions) {
  const b = activeBudget(engagementId);
  if (!b) return null;
  const s = assumptions ?? db.engagements.find((e) => e.id === engagementId)?.forecast ?? DEFAULT_FORECAST;
  const income = Array.from({ length: 12 }, () => 0n);
  const costs = Array.from({ length: 12 }, () => 0n);
  for (const [line, months] of Object.entries(b.lines)) {
    if (/depreciation|amortisation/i.test(line)) continue; // not cash
    months.forEach((m, i) => {
      const p = asPence(m);
      if (p >= 0n) income[i] += p;
      else costs[i] -= p;
    });
  }
  const lag = (days: number) => Math.max(0, Math.round(days / 30));
  const at = (series: bigint[], i: number) => series[Math.max(0, i)];
  const minimum = asPence(s.minimum_cash_p);
  let opening = keyFigures(buildAccounts(engagementId)).cash;
  return Array.from({ length: 12 }, (_, i) => {
    const receipts = at(income, i - lag(s.debtor_days));
    const payments = at(costs, i - lag(s.creditor_days)) + asPence(s.capex_p) + asPence(s.dividends_p);
    const closing = opening + receipts - payments;
    const row = { month: i + 1, opening, receipts, payments, closing, below: closing < minimum };
    opening = closing;
    return row;
  });
}

export function saveForecast(engagementId: string, assumptions: ForecastAssumptions, actor: Actor) {
  const eng = editable(engagementId);
  if (!eng) return;
  const before = eng.forecast ?? null;
  eng.forecast = assumptions;
  db.logAudit(eng.firm_id, actor, 'SAVE_FORECAST', 'engagements', eng.id, before, assumptions);
}

// ---------- QTR-01 and QTR-03: quarterly insight pack ----------

export function quarterlyPack(engagementId: string) {
  const eng = db.engagements.find((e) => e.id === engagementId);
  const a = buildAccounts(engagementId);
  const k = keyFigures(a);
  const reviewed = db.workpapers.filter((w) => w.engagement_id === engagementId && w.applicable !== false).every((w) => db.signoffs.some((s) => s.workpaper_id === w.id && s.role !== 'preparer' && !s.stale_at));
  const pl = plAnalysis(engagementId);
  // Only movements the rules can explain are offered; the rest are counted so the builder can say so (QTR-01 AC5)
  const flagged = pl.rows.filter((r) => r.flagged);
  const insights = [
    ...flagged.filter((r) => r.explanation).map((r) => `${r.label} ${r.movement! > 0n ? 'rose' : 'fell'} by ${formatPence(abs(r.movement!))} to ${formatPence(abs(r.amount))}. ${r.explanation}`),
    ...bsAnalysis(engagementId).goingConcern.map((c) => `${c}.`),
  ].filter((t) => !(eng?.quarterly?.removed ?? []).includes(t)).slice(0, 5);
  return {
    unadjusted: !reviewed,
    kpis: [
      { label: 'Revenue', value: k.turnover },
      { label: 'Gross profit', value: a.grossProfit?.amount ?? null },
      { label: 'Net profit', value: a.profit.amount },
      { label: 'Cash', value: k.cash },
      { label: 'Money owed to you', value: k.debtors },
      { label: 'Money you owe suppliers', value: k.tradeCreditors },
    ],
    insights,
    leftOut: flagged.filter((r) => !r.explanation).length,
    deadlines: eng ? [{ label: 'Accounts due at Companies House', date: accountsDue(eng.period_end) }] : [],
    state: eng?.quarterly ?? { comment: '', removed: [], status: 'draft' as const },
  };
}

/** Nothing is approved without an accountant's comment, and only a partner may approve a pack. */
export function setQuarterly(engagementId: string, actor: Actor, change: { comment?: string; remove?: string; status?: 'draft' | 'ready' | 'approved' }): string | null {
  const eng = editable(engagementId);
  if (!eng) return 'This file is locked.';
  const q = { comment: '', removed: [] as string[], status: 'draft' as const, ...eng.quarterly };
  const next = { ...q, comment: change.comment ?? q.comment, removed: change.remove ? [...q.removed, change.remove] : q.removed };
  if (change.status) {
    if (change.status !== 'draft' && !next.comment.trim()) return 'Add the accountant’s comment first.';
    if (change.status === 'approved' && !['partner', 'admin', 'manager'].includes(actor.role)) return 'Only a manager or partner can approve a pack.';
    Object.assign(next, { status: change.status, ...(change.status === 'approved' ? { approved_by: actor.name, approved_at: new Date().toISOString() } : {}) });
  }
  eng.quarterly = next;
  db.logAudit(eng.firm_id, actor, 'UPDATE_QUARTERLY_PACK', 'engagements', eng.id, q, next);
  return null;
}

// ---------- JNL-03: journals for the ledger ----------

/** Approved journals not yet in the ledger, in Xero's manual journal import layout (debit positive, credit negative). */
export function journalsLedgerCsv(engagementId: string) {
  const mappings = db.account_mappings.filter((m) => m.engagement_id === engagementId);
  // The ledger's own code where exactly one ledger account maps to the chart code
  const ledgerCode = (code: string) => {
    const hits = mappings.filter((m) => m.blynt_code === code);
    return hits.length === 1 ? hits[0].source_code : code;
  };
  const ukDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
  const journals = db.adjustments.filter((j) => j.engagement_id === engagementId && j.status === 'approved');
  const eng = db.engagements.find((e) => e.id === engagementId);
  const rows = journals.flatMap((j) =>
    j.lines.map((l): Cell[] => [`${j.ref} ${j.narrative}`, ukDate(j.date ?? eng?.period_end ?? ''), l.narrative ?? '', ledgerCode(l.blynt_code), 'No VAT', asPence(l.debit_p) - asPence(l.credit_p)])
  );
  return { count: journals.length, ids: journals.map((j) => j.id), csv: toCsv(['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount'], rows) };
}

// Kept here so the file export and reports share one definition of "applicable schedule with its totals"
export function fileIndex(engagementId: string) {
  return db.workpapers
    .filter((w) => w.engagement_id === engagementId && w.applicable !== false)
    .sort((a, b) => a.ref.localeCompare(b.ref))
    .map((w) => {
      const r = evaluatePaper(w);
      return {
        id: w.id,
        ref: w.ref,
        title: w.custom_template?.title ?? templateFor(w.ref)?.title ?? '',
        status: paperStatus(w),
        leads: r?.leads.filter((l) => l.mapped) ?? [],
        conclusion: (w.data_json?.conclusion as string) || r?.draftConclusion || '',
        signoffs: db.signoffs.filter((s) => s.workpaper_id === w.id && !s.stale_at),
        comments: db.comments.filter((c) => c.workpaper_id === w.id),
        evidence: db.attachments.filter((x) => (x as any).workpaper_id === w.id || db.attachment_links.some((l) => l.attachment_id === x.id && (l.anchor_json as any)?.workpaper_id === w.id)),
      };
    });
}

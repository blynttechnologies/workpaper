import { db } from './server/db';
import { asPence, formatPence } from './money';
import { buildAccounts, type Accounts, type AccountsLine } from './workpapers/accounts';
import { JOURNAL_IN_TB, type Commentary, type UserRole } from './types/models';

/**
 * Step 13 (ANL-01 to ANL-03, AIX-03, AIX-07): movement analysis, ratios, going concern
 * indicators, commentary and the client query list. Rules only, as the build order asks
 * ("rules first, AI second"): every explanation names the accounts and journals it used.
 */

type Actor = { id: string; name: string; role: UserRole };
const abs = (n: bigint) => (n < 0n ? -n : n);
const gbp = (p: bigint) => formatPence(abs(p));
const pct = (part: bigint, whole: bigint) => (whole === 0n ? null : (Number(part) / Number(whole)) * 100);

export interface MovementRow {
  key: string;
  label: string;
  amount: bigint;
  prior: bigint | null;
  movement: bigint | null;
  percent: number | null;
  flagged: boolean;
  /** null on a flagged row means the rules could not explain it: "Needs explanation" */
  explanation: string | null;
}

/** Movements over both thresholds are flagged; the amount comes from practice settings (default £1,000). */
function thresholds(engagementId: string) {
  const eng = db.engagements.find((e) => e.id === engagementId);
  const firm = db.firms.find((f) => f.id === eng?.firm_id);
  return { pct: 10, minimum: asPence(firm?.settings?.defaults?.review_threshold_p ?? '100000') };
}

function explain(engagementId: string, line: AccountsLine): string | null {
  const movers = line.review
    .map((r) => ({ ...r, move: r.amount - (r.prior ?? 0n) }))
    .filter((r) => r.move !== 0n)
    .sort((a, b) => Number(abs(b.move) - abs(a.move)));
  const codes = new Set(line.review.map((r) => r.code));
  const journals = db.adjustments.filter((j) => j.engagement_id === engagementId && JOURNAL_IN_TB.includes(j.status) && j.lines.some((l) => l.blynt_code && codes.has(l.blynt_code)));
  if (movers.length === 0 && journals.length === 0) return null;
  const parts = movers.slice(0, 3).map((m) => `${m.code} ${m.name} ${m.move > 0n ? 'up' : 'down'} ${gbp(m.move)}`);
  const js = journals.length ? ` Includes journal${journals.length > 1 ? 's' : ''} ${journals.map((j) => j.ref).join(', ')}.` : '';
  return `${parts.join('; ')}.${js}`;
}

function rows(engagementId: string, lines: AccountsLine[]): MovementRow[] {
  const t = thresholds(engagementId);
  return lines.map((l) => {
    const movement = l.prior === null ? null : l.amount - l.prior;
    const percent = movement === null || !l.prior ? null : pct(movement, abs(l.prior));
    const flagged = movement !== null && abs(movement) >= t.minimum && (percent === null || Math.abs(percent) >= t.pct);
    return { key: l.label, label: l.label, amount: l.amount, prior: l.prior, movement, percent, flagged, explanation: flagged ? explain(engagementId, l) : null };
  });
}

const total = (ls: AccountsLine[]) => ls.reduce((t, l) => t + l.amount, 0n);
const named = (ls: AccountsLine[], re: RegExp) => total(ls.filter((l) => re.test(l.label)));
const ratio = (a: bigint, b: bigint) => (b === 0n ? null : Number(a) / Number(b));

export function keyFigures(a: Accounts) {
  const turnover = named(a.pl, /^turnover$/i);
  // Costs show negative in the P&L, so they are flipped for the ratios
  const costOfSales = -named(a.pl, /cost of sales/i);
  const staff = -a.pl.flatMap((l) => l.accounts).filter((x) => /wage|salar|staff|pension|national insurance|payroll/i.test(x.name)).reduce((t, x) => t + x.amount, 0n);
  const interestAndTax = named(a.pl, /interest|tax on profit/i);
  const current = [...a.bs.current, ...a.bs.suspense];
  const cash = named(current, /cash|bank/i);
  const stock = named(current, /stock|work in progress/i);
  const debtors = named(current, /trade debtors/i) || named(current, /debtors/i);
  const tradeCreditors = named(a.bs.creditorsShort, /trade/i);
  const loansShort = named(a.bs.creditorsShort, /loan|hire purchase|overdraft/i);
  const borrowings = loansShort + named(a.bs.creditorsLong, /./);
  const taxOwed = named(a.bs.creditorsShort, /tax/i);
  return { turnover, costOfSales, staff, operatingProfit: a.profit.amount - interestAndTax, cash, stock, debtors, tradeCreditors, loansShort, borrowings, taxOwed, currentAssets: total(current), currentLiabilities: total(a.bs.creditorsShort) };
}

export function plAnalysis(engagementId: string) {
  const a = buildAccounts(engagementId);
  const k = keyFigures(a);
  return {
    hasPrior: a.hasPrior,
    rows: rows(engagementId, a.pl),
    ratios: [
      { label: 'Gross margin', value: a.grossProfit ? pct(a.grossProfit.amount, k.turnover) : null },
      { label: 'Operating margin', value: pct(k.operatingProfit, k.turnover) },
      { label: 'Net margin', value: pct(a.profit.amount, k.turnover) },
      { label: 'Staff cost to turnover', value: pct(k.staff, k.turnover) },
    ],
  };
}

export function bsAnalysis(engagementId: string) {
  const a = buildAccounts(engagementId);
  const k = keyFigures(a);
  const days = (balance: bigint, flow: bigint) => (flow <= 0n ? null : Math.round((Number(balance) / Number(flow)) * 365));
  const concerns: string[] = [];
  if (a.netAssets.amount < 0n) concerns.push(`Net liabilities of ${gbp(a.netAssets.amount)}`);
  if (a.netCurrentAssets.amount < 0n) concerns.push(`Net current liabilities of ${gbp(a.netCurrentAssets.amount)}`);
  if (a.profit.amount < 0n && (a.profit.prior ?? 0n) < 0n) concerns.push('Losses in two years running');
  if (k.loansShort > k.cash && k.loansShort > 0n) concerns.push(`Borrowing due within 12 months (${gbp(k.loansShort)}) is more than cash held (${gbp(k.cash)})`);
  // shortcut: there is no HMRC due-date data yet, so "overdue" is approximated as tax owed above cash; replace when FIL-04 lands
  if (k.taxOwed > k.cash && k.taxOwed > 0n) concerns.push(`Tax owed (${gbp(k.taxOwed)}) is more than cash held (${gbp(k.cash)})`);
  return {
    hasPrior: a.hasPrior,
    rows: rows(engagementId, [...a.bs.fixed, ...a.bs.current, ...a.bs.creditorsShort, ...a.bs.creditorsLong, ...a.bs.provisions, ...a.bs.equity]),
    ratios: [
      { label: 'Current ratio', value: ratio(k.currentAssets, k.currentLiabilities), unit: 'x' },
      { label: 'Quick ratio', value: ratio(k.currentAssets - k.stock, k.currentLiabilities), unit: 'x' },
      { label: 'Debtor days', value: days(k.debtors, k.turnover), unit: ' days' },
      { label: 'Creditor days', value: days(k.tradeCreditors, k.costOfSales), unit: ' days' },
      { label: 'Stock days', value: days(k.stock, k.costOfSales), unit: ' days' },
      { label: 'Gearing', value: a.netAssets.amount > 0n ? pct(k.borrowings, a.netAssets.amount) : null, unit: '%' },
    ],
    goingConcern: concerns,
  };
}

/** ANL-03: every edit is kept; new commentary is internal until someone makes it client-facing. */
export function setCommentary(engagementId: string, key: string, actor: Actor, change: { text?: string; visibility?: Commentary['visibility']; ai_text?: string }) {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng || eng.status === 'locked') return;
  const before = eng.commentary?.[key];
  const next: Commentary = { text: '', visibility: 'internal', history: [], ...before, ...(change.ai_text ? { ai_text: change.ai_text } : {}) };
  if (change.text !== undefined && change.text !== next.text) {
    next.text = change.text;
    next.history = [...next.history, { text: change.text, by: actor.name, at: new Date().toISOString() }];
  }
  if (change.visibility) next.visibility = change.visibility;
  // Nothing reaches a client until a person has written or confirmed the wording
  if (!next.text.trim()) next.visibility = 'internal';
  eng.commentary = { ...eng.commentary, [key]: next };
  db.logAudit(eng.firm_id, actor, 'UPDATE_COMMENTARY', 'engagements', eng.id, before ?? null, { key, ...next });
}

/** AIX-07: ledger postings dated after the period end, over the review threshold. */
export function postBalanceSheetEvents(engagementId: string) {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) return [];
  const { minimum } = thresholds(engagementId);
  return db.transactions
    .filter((t) => t.engagement_id === engagementId && t.date > eng.period_end && abs(asPence(t.amount_p)) >= minimum)
    .sort((a, b) => Number(abs(asPence(b.amount_p)) - abs(asPence(a.amount_p))));
}

export interface ClientQuery {
  id: string;
  text: string;
  source: string;
  href: string;
}

/** AIX-03: the questions for the client, built from the gaps in the file. */
export function clientQueries(engagementId: string): ClientQuery[] {
  const eng = db.engagements.find((e) => e.id === engagementId);
  if (!eng) return [];
  const base = `/engagements/${engagementId}`;
  const out: ClientQuery[] = [];
  const said = (key: string) => Boolean(eng.commentary?.[key]?.text.trim());
  for (const [tab, list] of [['Profit and loss', plAnalysis(engagementId).rows], ['Balance sheet', bsAnalysis(engagementId).rows]] as const) {
    for (const r of list) {
      if (r.flagged && !r.explanation && !said(r.key)) {
        out.push({ id: `move:${r.key}`, source: tab, href: `${base}/analysis`, text: `${r.label} ${r.movement! > 0n ? 'rose' : 'fell'} by ${gbp(r.movement!)} on last year. What changed?` });
      }
    }
  }
  const papers = new Map(db.workpapers.filter((w) => w.engagement_id === engagementId).map((w) => [w.id, w]));
  for (const c of db.comments) {
    const wp = papers.get(c.workpaper_id);
    if (wp && c.type === 'client_query' && c.status === 'open') out.push({ id: c.id, source: wp.ref, href: `${base}/workpapers/${wp.id}`, text: c.body });
  }
  for (const wp of papers.values()) {
    for (const k of ['additions', 'disposals'] as const) {
      for (const item of Array.isArray(wp.data_json?.[k]) ? wp.data_json[k] : []) {
        if (!item.attachment_id && item.has_evidence === false) {
          out.push({ id: `ev:${wp.id}:${item.id}`, source: wp.ref, href: `${base}/workpapers/${wp.id}`, text: `Please send the paperwork for: ${item.desc || item.description || k.slice(0, -1)}.` });
        }
      }
    }
  }
  for (const t of postBalanceSheetEvents(engagementId).slice(0, 5)) {
    out.push({ id: `pbse:${t.id}`, source: 'After the year end', href: `${base}/analysis`, text: `${t.contact || t.description}: ${gbp(asPence(t.amount_p))} on ${t.date.slice(0, 10)}, after the year end. What was this for?` });
  }
  return out;
}
